import crypto from 'crypto';
import { AgentProfileStore, profileStore } from '../profiles/store';

const SWIGGY_AUTH_BASE = 'https://mcp.swiggy.com/auth';
const CLIENT_ID = 'swiggy-mcp';
const SCOPE = 'mcp:tools mcp:resources mcp:prompts offline_access';
const DEFAULT_TOKEN_TTL_SECONDS = 5 * 24 * 60 * 60;
export const SWIGGY_OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

type PendingVerifier = {
  verifier: string;
  profileId: string;
  createdAt: number;
};

export type SwiggySessionStatus = {
  valid: boolean;
  connected: boolean;
  expiresAt: string | null;
};

export type SwiggyAuthServiceOptions = {
  store?: AgentProfileStore;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  publicBaseUrl?: string;
};

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Profile-scoped Swiggy OAuth (authorization_code + PKCE).
 *
 * Swiggy does not currently issue refresh tokens. Each household profile therefore owns an
 * independent short-lived access token and can relink from the dashboard without affecting the
 * other profile. Tokens are persisted by ProfileStore and are never returned to the browser.
 */
export class SwiggyAuthService {
  private readonly redirectUri: string;
  private readonly pendingVerifiers = new Map<string, PendingVerifier>();
  private readonly latestStateByProfile = new Map<string, string>();
  private readonly store: AgentProfileStore;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(options: SwiggyAuthServiceOptions = {}) {
    const baseUrl = (
      options.publicBaseUrl ||
      process.env.PUBLIC_BASE_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
    this.redirectUri = `${baseUrl}/swiggy/oauth/callback`;
    this.store = options.store ?? profileStore;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** Generates a one-use PKCE authorization URL bound to exactly one agent profile. */
  public async generateAuthorizeUrl(profileId: string): Promise<string> {
    const profile = await this.store.getProfile(profileId);
    if (!profile) {
      throw new Error('Agent profile not found.');
    }

    this.pruneStaleVerifiers();

    // A profile may have only one current login attempt. This invalidates old
    // links and also supersedes an older callback whose token exchange is still
    // in flight, preventing it from replacing a newer session.
    for (const [pendingState, entry] of this.pendingVerifiers) {
      if (entry.profileId === profile.id) {
        this.pendingVerifiers.delete(pendingState);
      }
    }

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = crypto.randomUUID();
    this.pendingVerifiers.set(state, {
      verifier,
      profileId: profile.id,
      createdAt: this.now()
    });
    this.latestStateByProfile.set(profile.id, state);

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

  private pruneStaleVerifiers(): void {
    for (const [state, entry] of this.pendingVerifiers) {
      if (this.isExpired(entry)) {
        this.pendingVerifiers.delete(state);
        this.releaseLatestState(entry.profileId, state);
      }
    }
  }

  private isExpired(entry: PendingVerifier): boolean {
    const age = this.now() - entry.createdAt;
    return age < 0 || age >= SWIGGY_OAUTH_STATE_MAX_AGE_MS;
  }

  private isCurrentState(state: string, entry: PendingVerifier): boolean {
    return (
      !this.isExpired(entry) &&
      this.latestStateByProfile.get(entry.profileId) === state
    );
  }

  private releaseLatestState(profileId: string, state: string): void {
    if (this.latestStateByProfile.get(profileId) === state) {
      this.latestStateByProfile.delete(profileId);
    }
  }

  private invalidStateResult(): { success: false; error: string } {
    return {
      success: false,
      error: 'Unknown or expired login attempt. Return to the dashboard and request a new link.'
    };
  }

  /** Exchanges an OAuth code and persists the resulting token against its bound profile. */
  public async handleCallback(
    code: string,
    state: string
  ): Promise<{ success: true; profileId: string } | { success: false; error: string }> {
    const entry = this.pendingVerifiers.get(state);
    if (!entry) {
      return this.invalidStateResult();
    }

    // Consume before any await so concurrent or replayed callbacks can never
    // exchange the same state twice.
    this.pendingVerifiers.delete(state);
    if (!this.isCurrentState(state, entry)) {
      this.releaseLatestState(entry.profileId, state);
      return this.invalidStateResult();
    }

    let response: globalThis.Response;
    try {
      response = await this.fetchImpl(`${SWIGGY_AUTH_BASE}/token`, {
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
    } catch (error: any) {
      this.releaseLatestState(entry.profileId, state);
      console.error('Swiggy token exchange could not be reached:', error?.message || error);
      return { success: false, error: 'Could not reach Swiggy. Please try linking again.' };
    }

    if (!response.ok) {
      this.releaseLatestState(entry.profileId, state);
      const errorBody = await response.text().catch(() => 'Unreadable response body');
      console.error(`Swiggy token exchange failed (${response.status}):`, errorBody.slice(0, 500));
      return { success: false, error: 'Swiggy did not accept this login. Please request a fresh link.' };
    }

    let body: { access_token?: string; expires_in?: number };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      this.releaseLatestState(entry.profileId, state);
      return { success: false, error: 'Swiggy completed login without returning a usable session.' };
    }
    if (!body.access_token) {
      this.releaseLatestState(entry.profileId, state);
      return { success: false, error: 'Swiggy completed login without returning a usable session.' };
    }

    // A newer link can be generated while this request is at Swiggy. Recheck
    // both recency and age immediately before touching the stored session.
    if (!this.isCurrentState(state, entry)) {
      return this.invalidStateResult();
    }

    const issuedAt = this.now();
    const expiresAt = issuedAt + (body.expires_in || DEFAULT_TOKEN_TTL_SECONDS) * 1000;
    try {
      await this.store.setSwiggySession(entry.profileId, {
        accessToken: body.access_token,
        expiresAt: new Date(expiresAt).toISOString()
      });
    } catch (error: any) {
      console.error('Swiggy session could not be stored:', error?.message || error);
      return { success: false, error: 'Swiggy linked, but the session could not be saved. Please try again.' };
    } finally {
      this.releaseLatestState(entry.profileId, state);
    }

    console.log(
      `Swiggy session linked for profile ${entry.profileId}, valid until ${new Date(expiresAt).toISOString()}`
    );
    return { success: true, profileId: entry.profileId };
  }

  /** Accepts either a profile id or its configured WhatsApp number. */
  public async getAccessToken(contextId: string): Promise<string | null> {
    const profile = await this.store.resolveProfile(contextId);
    return profile ? this.store.getAccessToken(profile.id) : null;
  }

  public async isSessionValid(contextId: string): Promise<boolean> {
    return (await this.getAccessToken(contextId)) !== null;
  }

  public async getSessionStatus(contextId: string): Promise<SwiggySessionStatus> {
    const profile = await this.store.resolveProfile(contextId);
    if (!profile) return { valid: false, connected: false, expiresAt: null };

    const publicSession = profile.swiggy;
    return {
      valid: publicSession.connected && (await this.isSessionValid(profile.id)),
      connected: publicSession.connected,
      expiresAt: publicSession.expiresAt
    };
  }

  public async disconnect(profileId: string): Promise<void> {
    await this.store.clearSwiggySession(profileId);
  }
}

export const swiggyAuthService = new SwiggyAuthService();
