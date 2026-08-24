import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ISOLATED_ENV_KEYS = [
  'AGENT_MOTHER_WHATSAPP_NUMBER',
  'MOTHER_WHATSAPP_NUMBER',
  'WHATSAPP_MOTHER_NUMBER',
  'SUDHA_WHATSAPP_NUMBER',
  'AGENT_SELF_WHATSAPP_NUMBER',
  'SELF_WHATSAPP_NUMBER',
  'WHATSAPP_SELF_NUMBER',
  'VYSHAK_WHATSAPP_NUMBER',
  'DASHBOARD_ALLOW_LOCAL_AUTH_BYPASS',
  'DASHBOARD_PASSWORD',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GNANI_API_KEY',
  'PUBLIC_BASE_URL',
  'SWIGGY_ACCESS_TOKEN',
  'SWIGGY_TOKEN_ISSUED_AT',
  'SWIGGY_TOKEN_EXPIRES_AT',
  'SWIGGY_DEFAULT_ADDRESS_ID',
  'SWIGGY_DEFAULT_ADDRESS_LABEL',
  'SWIGGY_DEFAULT_FORMATTED_ADDRESS',
  'SWIGGY_DEFAULT_LAT',
  'SWIGGY_DEFAULT_LNG',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_API_VERSION'
] as const;

type DashboardProfile = {
  id: string;
  displayName: string;
  whatsappNumber: string | null;
  customInstructions: string;
  language: {
    replyMode: string;
    voiceReplies: boolean;
  };
  [key: string]: unknown;
};

type ProfilesResponse = {
  profiles: DashboardProfile[];
};

function assertNoAccessToken(value: unknown): void {
  assert.equal(
    JSON.stringify(value).includes('accessToken'),
    false,
    'Dashboard responses must never expose a Swiggy access token.'
  );
}

async function run(): Promise<void> {
  const originalCwd = process.cwd();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'swiggy-dashboard-smoke-')
  );
  const savedEnvironment = new Map<string, string | undefined>();
  const originalFetch = globalThis.fetch;
  let server: ReturnType<ReturnType<typeof import('./app')['createApp']>['listen']> | undefined;
  let localOrigin: string | null = null;

  for (const key of ['NODE_ENV', 'AGENT_PROFILE_STORE_PATH', ...ISOLATED_ENV_KEYS]) {
    savedEnvironment.set(key, process.env[key]);
  }

  try {
    process.chdir(temporaryDirectory);
    for (const key of ISOLATED_ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'development';
    process.env.AGENT_PROFILE_STORE_PATH = path.join(
      temporaryDirectory,
      'agent-profiles.json'
    );

    // Application code must not reach an external fetch endpoint during this smoke test. The
    // wrapper is installed before importing the app, while still allowing this test's own
    // loopback HTTP requests after the ephemeral server has started.
    globalThis.fetch = (async (input, init) => {
      const requestUrl = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      );
      assert.equal(
        requestUrl.origin,
        localOrigin,
        `Blocked unexpected external request to ${requestUrl.origin}.`
      );
      return originalFetch(input, init);
    }) as typeof fetch;

    const { createApp } = await import('./app');
    const { getSessionState } = await import('./dashboard/auth');
    const app = createApp();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    localOrigin = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const fetchLocal = (pathname: string, init?: RequestInit) =>
      fetch(`${localOrigin}${pathname}`, init);
    const fetchJson = async <T>(pathname: string, init?: RequestInit) => {
      const response = await fetchLocal(pathname, init);
      const body = (await response.json()) as T;
      return { response, body };
    };
    const putJson = <T>(pathname: string, body: unknown) =>
      fetchJson<T>(pathname, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

    const home = await fetchLocal('/');
    assert.equal(home.status, 200);
    assert.match(
      home.headers.get('content-security-policy') || '',
      /default-src 'self'/
    );
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    const homeHtml = await home.text();
    assert.match(homeHtml, /<title>Sahayaka Household Desk<\/title>/);
    assert.match(homeHtml, /id="dashboard"/);
    assert.match(
      homeHtml,
      /<details id="person-section"[^>]*\sopen>/,
      'The essential person step should be open by default.'
    );
    assert.match(homeHtml, /<details id="swiggy-section"/);
    assert.match(homeHtml, /<details id="address-section"/);
    assert.match(homeHtml, /<details id="language-section"/);
    assert.match(
      homeHtml,
      /<details id="triage-panel"/,
      'Troubleshooting should remain available as an on-demand disclosure.'
    );
    assert.match(
      homeHtml,
      /Every real order needs a fresh payment choice after the full bill\./
    );

    const closedSession = await fetchJson<{
      authenticated: boolean;
      reason: string;
    }>('/api/dashboard/session');
    assert.equal(closedSession.response.status, 200);
    assert.deepEqual(closedSession.body, {
      authenticated: false,
      reason: 'not_configured'
    });

    const closedProfiles = await fetchJson<{ code: string }>(
      '/api/dashboard/profiles'
    );
    assert.equal(closedProfiles.response.status, 503);
    assert.equal(closedProfiles.body.code, 'DASHBOARD_AUTH_NOT_CONFIGURED');

    process.env.DASHBOARD_ALLOW_LOCAL_AUTH_BYPASS = 'true';
    const remoteRequest = {
      headers: {},
      socket: { remoteAddress: '203.0.113.10' }
    } as unknown as Parameters<typeof getSessionState>[0];
    assert.deepEqual(getSessionState(remoteRequest), {
      authenticated: false,
      reason: 'not_configured'
    });

    process.env.NODE_ENV = 'production';
    const productionSession = await fetchJson<{
      authenticated: boolean;
      reason: string;
    }>('/api/dashboard/session');
    assert.deepEqual(productionSession.body, {
      authenticated: false,
      reason: 'not_configured'
    });
    process.env.NODE_ENV = 'development';

    const session = await fetchJson<{
      authenticated: boolean;
      mode: string;
      expiresAt: string | null;
    }>('/api/dashboard/session');
    assert.equal(session.response.status, 200);
    assert.deepEqual(session.body, {
      authenticated: true,
      mode: 'development-bypass',
      expiresAt: null
    });

    const initial = await fetchJson<ProfilesResponse>(
      '/api/dashboard/profiles'
    );
    assert.equal(initial.response.status, 200);
    assert.deepEqual(
      initial.body.profiles.map((profile) => profile.id),
      ['mother', 'self']
    );
    assertNoAccessToken(initial.body);

    const initialSelf = structuredClone(
      initial.body.profiles.find((profile) => profile.id === 'self')
    );
    assert.ok(initialSelf);

    const update = await putJson<{ profile: DashboardProfile }>(
      '/api/dashboard/profiles/mother',
      {
        displayName: 'Dashboard Test Mother',
        whatsappNumber: '+91 98765 43210',
        language: { replyMode: 'kannada', voiceReplies: false },
        customInstructions: 'Prefer low-sugar alternatives.'
      }
    );
    assert.equal(update.response.status, 200);
    assert.equal(update.body.profile.displayName, 'Dashboard Test Mother');
    assert.equal(update.body.profile.whatsappNumber, '919876543210');
    assert.equal(update.body.profile.language.replyMode, 'kannada');
    assertNoAccessToken(update.body);

    const afterUpdate = await fetchJson<ProfilesResponse>(
      '/api/dashboard/profiles'
    );
    assert.equal(afterUpdate.response.status, 200);
    const updatedMother = afterUpdate.body.profiles.find(
      (profile) => profile.id === 'mother'
    );
    const unchangedSelf = afterUpdate.body.profiles.find(
      (profile) => profile.id === 'self'
    );
    assert.equal(updatedMother?.displayName, 'Dashboard Test Mother');
    assert.deepEqual(unchangedSelf, initialSelf);
    assertNoAccessToken(afterUpdate.body);

    const invalid = await putJson<{ error: string }>(
      '/api/dashboard/profiles/mother',
      { whatsappNumber: 'not-a-phone-number' }
    );
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.body.error, /WhatsApp number/i);

    const missing = await putJson<{ error: string }>(
      '/api/dashboard/profiles/missing-profile',
      { displayName: 'Nobody' }
    );
    assert.equal(missing.response.status, 404);
    assert.match(missing.body.error, /not found/i);

    const diagnostics = await fetchJson<{
      status: string;
      readiness: number;
      checks: Array<{ id: string; status: string }>;
    }>('/api/dashboard/profiles/mother/diagnostics');
    assert.equal(diagnostics.response.status, 200);
    assert.ok(Number.isFinite(diagnostics.body.readiness));
    assert.equal(
      diagnostics.body.checks.find((check) => check.id === 'whatsapp-api')
        ?.status,
      'blocked'
    );
    assert.equal(
      diagnostics.body.checks.find((check) => check.id === 'gemini')?.status,
      'blocked'
    );
    assert.equal(
      diagnostics.body.checks.find((check) => check.id === 'swiggy')?.status,
      'blocked'
    );
    assertNoAccessToken(diagnostics.body);

    console.log('Dashboard route smoke test passed without external calls.');
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
