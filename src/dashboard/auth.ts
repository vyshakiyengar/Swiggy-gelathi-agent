import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export const DASHBOARD_SESSION_COOKIE = 'swiggy_dashboard_session';
export const DASHBOARD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FAILED_LOGIN_LIMIT = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

type StoredSession = {
  expiresAt: number;
};

type LoginAttemptState = {
  failedAt: number[];
  blockedUntil: number;
};

export type DashboardSessionState =
  | {
      authenticated: true;
      mode: 'development-bypass' | 'session';
      expiresAt: string | null;
    }
  | {
      authenticated: false;
      reason: 'missing' | 'invalid' | 'expired' | 'not_configured';
    };

export type DashboardLoginResult =
  | {
      ok: true;
      status: 200;
      session: Extract<DashboardSessionState, { authenticated: true }>;
    }
  | {
      ok: false;
      status: 401 | 429 | 503;
      reason: 'invalid_credentials' | 'rate_limited' | 'not_configured';
      retryAfterSeconds?: number;
    };

const sessions = new Map<string, StoredSession>();
const loginAttempts = new Map<string, LoginAttemptState>();

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function configuredPassword(): string | null {
  const password = process.env.DASHBOARD_PASSWORD;
  return password && password.length > 0 ? password : null;
}

function isLoopbackRequest(req: Request): boolean {
  // Use the peer socket, not forwarding headers or req.ip: an explicit local
  // bypass must not become remotely reachable through proxy configuration.
  const address = req.socket.remoteAddress?.toLowerCase().split('%')[0];
  return (
    address === '::1' ||
    address?.startsWith('127.') === true ||
    address?.startsWith('::ffff:127.') === true
  );
}

function developmentBypassEnabled(req: Request): boolean {
  return (
    !isProduction() &&
    process.env.DASHBOARD_ALLOW_LOCAL_AUTH_BYPASS === 'true' &&
    configuredPassword() === null &&
    isLoopbackRequest(req)
  );
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: DASHBOARD_SESSION_TTL_MS
  };
}

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!header) return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) continue;

    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // A malformed cookie is treated as absent instead of failing the request.
    }
  }

  return cookies;
}

function sessionToken(req: Request): string | null {
  return parseCookieHeader(req.headers.cookie).get(DASHBOARD_SESSION_COOKIE) ?? null;
}

function pruneExpiredSessions(now: number): void {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function requestIp(req: Request): string {
  // Express derives req.ip according to the application's `trust proxy` setting. Avoid reading
  // X-Forwarded-For directly here, since an untrusted client can spoof it to evade throttling.
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function currentRateLimit(ip: string, now: number): number | null {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return null;

  if (attempt.blockedUntil > now) {
    return Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
  }

  attempt.failedAt = attempt.failedAt.filter(
    (timestamp) => timestamp > now - FAILED_LOGIN_WINDOW_MS
  );

  if (attempt.failedAt.length === 0) {
    loginAttempts.delete(ip);
  } else {
    attempt.blockedUntil = 0;
  }

  return null;
}

function recordFailedLogin(ip: string, now: number): number | null {
  const existing = loginAttempts.get(ip);
  const failedAt = (existing?.failedAt ?? []).filter(
    (timestamp) => timestamp > now - FAILED_LOGIN_WINDOW_MS
  );
  failedAt.push(now);

  const blockedUntil =
    failedAt.length >= FAILED_LOGIN_LIMIT ? now + LOGIN_BLOCK_MS : 0;
  loginAttempts.set(ip, { failedAt, blockedUntil });

  return blockedUntil > now
    ? Math.max(1, Math.ceil((blockedUntil - now) / 1000))
    : null;
}

function passwordsMatch(supplied: string, expected: string): boolean {
  // Hashing first gives timingSafeEqual two fixed-length buffers, including when the supplied
  // and configured passwords have different byte lengths.
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function getSessionState(req: Request): DashboardSessionState {
  if (developmentBypassEnabled(req)) {
    return {
      authenticated: true,
      mode: 'development-bypass',
      expiresAt: null
    };
  }

  if (configuredPassword() === null) {
    return { authenticated: false, reason: 'not_configured' };
  }

  const token = sessionToken(req);
  if (!token) return { authenticated: false, reason: 'missing' };

  const now = Date.now();
  const session = sessions.get(token);
  if (!session) return { authenticated: false, reason: 'invalid' };

  if (session.expiresAt <= now) {
    sessions.delete(token);
    return { authenticated: false, reason: 'expired' };
  }

  pruneExpiredSessions(now);
  return {
    authenticated: true,
    mode: 'session',
    expiresAt: new Date(session.expiresAt).toISOString()
  };
}

export function login(
  req: Request,
  res: Response,
  password: unknown
): DashboardLoginResult {
  if (developmentBypassEnabled(req)) {
    return {
      ok: true,
      status: 200,
      session: {
        authenticated: true,
        mode: 'development-bypass',
        expiresAt: null
      }
    };
  }

  const expectedPassword = configuredPassword();
  if (!expectedPassword) {
    return { ok: false, status: 503, reason: 'not_configured' };
  }

  const now = Date.now();
  const ip = requestIp(req);
  const activeRateLimit = currentRateLimit(ip, now);

  if (activeRateLimit !== null) {
    res.setHeader('Retry-After', String(activeRateLimit));
    return {
      ok: false,
      status: 429,
      reason: 'rate_limited',
      retryAfterSeconds: activeRateLimit
    };
  }

  const suppliedPassword = typeof password === 'string' ? password : '';
  if (!passwordsMatch(suppliedPassword, expectedPassword)) {
    const retryAfterSeconds = recordFailedLogin(ip, now);
    if (retryAfterSeconds !== null) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return {
        ok: false,
        status: 429,
        reason: 'rate_limited',
        retryAfterSeconds
      };
    }

    return { ok: false, status: 401, reason: 'invalid_credentials' };
  }

  loginAttempts.delete(ip);
  pruneExpiredSessions(now);

  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + DASHBOARD_SESSION_TTL_MS;
  sessions.set(token, { expiresAt });
  res.cookie(DASHBOARD_SESSION_COOKIE, token, sessionCookieOptions());

  return {
    ok: true,
    status: 200,
    session: {
      authenticated: true,
      mode: 'session',
      expiresAt: new Date(expiresAt).toISOString()
    }
  };
}

export function logout(req: Request, res: Response): void {
  const token = sessionToken(req);
  if (token) sessions.delete(token);

  const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions();
  res.clearCookie(DASHBOARD_SESSION_COOKIE, clearOptions);
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const state = getSessionState(req);
  if (state.authenticated) {
    next();
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  if (state.reason === 'not_configured') {
    res.status(503).json({
      error: 'Dashboard authentication is not configured.',
      code: 'DASHBOARD_AUTH_NOT_CONFIGURED'
    });
    return;
  }

  res.status(401).json({
    error: 'Dashboard authentication required.',
    code: 'DASHBOARD_AUTH_REQUIRED'
  });
}
