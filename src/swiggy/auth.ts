import crypto from 'crypto';

const SWIGGY_AUTH_BASE = 'https://mcp.swiggy.com/auth';
const CLIENT_ID = 'swiggy-mcp';
const SCOPE = 'mcp:tools mcp:resources mcp:prompts offline_access';

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Handles the Swiggy Instamart MCP OAuth flow (authorization_code + PKCE).
 *
 * Swiggy's auth server does not issue refresh tokens (confirmed empirically, even when
 * requesting the offline_access scope) - access tokens are valid for ~5 days and then a
 * fresh interactive login (phone + OTP, or just a tap if the browser session is still live)
 * is required. Since the redirect_uri points back at this server rather than localhost,
 * that login can be completed from a phone by tapping a WhatsApp-delivered link - no laptop,
 * no code, required. See the relogin reminder cron in server.ts.
 */
class SwiggyAuthService {
  private redirectUri: string;
  private tokenState: TokenState | null = null;
  private pendingVerifiers: Map<string, { verifier: string; createdAt: number }> = new Map();

  constructor() {
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://zepto-agent-si1p.onrender.com';
    this.redirectUri = `${baseUrl}/swiggy/oauth/callback`;

    const bootstrapToken = process.env.SWIGGY_ACCESS_TOKEN;
    if (bootstrapToken) {
      const issuedAt = Number(process.env.SWIGGY_TOKEN_ISSUED_AT) || Date.now();
      this.tokenState = { accessToken: bootstrapToken, expiresAt: issuedAt + 5 * 24 * 60 * 60 * 1000 };
      console.log(`✅ Swiggy session bootstrapped from env, assumed valid until ${new Date(this.tokenState.expiresAt).toISOString()}`);
    } else {
      console.warn('⚠️ No SWIGGY_ACCESS_TOKEN set - Swiggy tools will be unavailable until a relogin link is used.');
    }
  }

  /** Generates a fresh PKCE authorization URL. The verifier is held in memory, keyed by state, until the callback arrives. */
  public generateAuthorizeUrl(): string {
    this.pruneStaleVerifiers();

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = crypto.randomUUID();
    this.pendingVerifiers.set(state, { verifier, createdAt: Date.now() });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: this.redirectUri,
      state,
      scope: SCOPE
    });

    return `${SWIGGY_AUTH_BASE}/authorize?${params.toString()}`;
  }

  private pruneStaleVerifiers() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [state, entry] of this.pendingVerifiers) {
      if (entry.createdAt < oneHourAgo) this.pendingVerifiers.delete(state);
    }
  }

  /** Exchanges an authorization code (from the OAuth callback) for an access token. */
  public async handleCallback(
    code: string,
    state: string
  ): Promise<{ success: boolean; error?: string; accessToken?: string; issuedAt?: number }> {
    const entry = this.pendingVerifiers.get(state);
    if (!entry) {
      return { success: false, error: 'Unknown or expired login attempt (state mismatch). Please request a new login link.' };
    }
    this.pendingVerifiers.delete(state);

    const res = await fetch(`${SWIGGY_AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: entry.verifier
      })
    });

    if (res.status !== 200) {
      const errBody = await res.text();
      console.error('❌ Swiggy token exchange failed:', errBody);
      return { success: false, error: 'Token exchange failed' };
    }

    const body = await res.json();
    const issuedAt = Date.now();
    this.tokenState = {
      accessToken: body.access_token,
      expiresAt: issuedAt + (body.expires_in || 5 * 24 * 60 * 60) * 1000
    };
    console.log(`✅ Swiggy session refreshed via relogin link, valid until ${new Date(this.tokenState.expiresAt).toISOString()}`);
    // Returned (not just stored in memory) so the callback route can surface it for copying into
    // Render's env vars - this in-memory session alone won't survive the next Render restart
    // (free-tier idle sleep, any deploy), which is exactly the gap that caused today's outage.
    return { success: true, accessToken: body.access_token, issuedAt };
  }

  public getAccessToken(): string | null {
    if (!this.tokenState) return null;
    if (Date.now() >= this.tokenState.expiresAt) return null;
    return this.tokenState.accessToken;
  }

  public isSessionValid(): boolean {
    return this.getAccessToken() !== null;
  }

  public getSessionStatus(): { valid: boolean; expiresAt: string | null } {
    return {
      valid: this.isSessionValid(),
      expiresAt: this.tokenState ? new Date(this.tokenState.expiresAt).toISOString() : null
    };
  }
}

export const swiggyAuthService = new SwiggyAuthService();
