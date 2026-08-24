import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const APP_SECRET = 'offline-webhook-signature-test-secret';
const PAYLOAD = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: []
});

const CLEARED_ENV_KEYS = [
  'DASHBOARD_PASSWORD',
  'GEMINI_API_KEY',
  'GNANI_API_KEY',
  'PUBLIC_BASE_URL',
  'SWIGGY_ACCESS_TOKEN',
  'SWIGGY_TOKEN_ISSUED_AT',
  'SWIGGY_TOKEN_EXPIRES_AT',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_WEBHOOK_ALLOW_UNSIGNED_LOCAL'
] as const;

function sign(payload: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`;
}

async function run(): Promise<void> {
  const originalCwd = process.cwd();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'swiggy-webhook-signature-')
  );
  const savedEnvironment = new Map<string, string | undefined>();
  const originalFetch = globalThis.fetch;
  let server: ReturnType<ReturnType<typeof import('./app')['createApp']>['listen']> | undefined;
  let localOrigin: string | null = null;

  for (const key of [
    'NODE_ENV',
    'AGENT_PROFILE_STORE_PATH',
    'WHATSAPP_APP_SECRET',
    ...CLEARED_ENV_KEYS
  ]) {
    savedEnvironment.set(key, process.env[key]);
  }

  try {
    process.chdir(temporaryDirectory);
    for (const key of CLEARED_ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'test';
    process.env.AGENT_PROFILE_STORE_PATH = path.join(
      temporaryDirectory,
      'agent-profiles.json'
    );
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

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
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    localOrigin = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const postWebhook = (body: string, signature?: string) =>
      fetch(`${localOrigin}/webhook/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-Hub-Signature-256': signature } : {})
        },
        body
      });

    const missing = await postWebhook(PAYLOAD);
    assert.equal(missing.status, 401);

    const malformed = await postWebhook(PAYLOAD, 'sha256=not-hex');
    assert.equal(malformed.status, 401);

    const tampered = await postWebhook(
      `${PAYLOAD} `,
      sign(PAYLOAD)
    );
    assert.equal(tampered.status, 401);

    const accepted = await postWebhook(PAYLOAD, sign(PAYLOAD));
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { status: 'EVENT_RECEIVED' });

    delete process.env.WHATSAPP_APP_SECRET;
    const unconfigured = await postWebhook(PAYLOAD, sign(PAYLOAD));
    assert.equal(unconfigured.status, 503);

    process.env.WHATSAPP_WEBHOOK_ALLOW_UNSIGNED_LOCAL = 'true';
    const localBypass = await postWebhook(PAYLOAD);
    assert.equal(localBypass.status, 200);

    process.env.NODE_ENV = 'production';
    const productionStillClosed = await postWebhook(PAYLOAD);
    assert.equal(productionStillClosed.status, 503);

    console.log('WhatsApp webhook signature tests passed without external calls.');
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
