import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentProfileStore } from './profiles/store';
import {
  SwiggyAuthService,
  SWIGGY_OAUTH_STATE_MAX_AGE_MS
} from './swiggy/auth';

type PendingExchange = {
  code: string;
  resolve: (response: Response) => void;
};

function stateFrom(url: string): string {
  const state = new URL(url).searchParams.get('state');
  assert.ok(state);
  return state;
}

function tokenResponse(accessToken: string): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, expires_in: 3600 }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

async function run(): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'swiggy-oauth-state-')
  );
  const store = new AgentProfileStore(
    path.join(temporaryDirectory, 'agent-profiles.json')
  );
  const savedAccessToken = process.env.SWIGGY_ACCESS_TOKEN;
  const exchanges: PendingExchange[] = [];
  let now = Date.now();

  delete process.env.SWIGGY_ACCESS_TOKEN;

  try {
    await store.initialize();
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      const body = new URLSearchParams(String(init?.body ?? ''));
      return new Promise<Response>((resolve) => {
        exchanges.push({ code: body.get('code') ?? '', resolve });
      });
    };
    const auth = new SwiggyAuthService({
      store,
      fetchImpl,
      now: () => now,
      publicBaseUrl: 'http://127.0.0.1:3000'
    });

    const staleState = stateFrom(await auth.generateAuthorizeUrl('mother'));
    now += SWIGGY_OAUTH_STATE_MAX_AGE_MS;
    const staleResult = await auth.handleCallback('stale-code', staleState);
    assert.equal(staleResult.success, false);
    assert.equal(exchanges.length, 0, 'Expired state must fail before token exchange.');

    const firstOutstanding = stateFrom(
      await auth.generateAuthorizeUrl('mother')
    );
    const secondOutstanding = stateFrom(
      await auth.generateAuthorizeUrl('mother')
    );
    assert.notEqual(firstOutstanding, secondOutstanding);
    assert.equal(
      (await auth.handleCallback('invalidated-code', firstOutstanding)).success,
      false
    );
    assert.equal(
      exchanges.length,
      0,
      'Generating a new link must invalidate older outstanding profile states.'
    );

    // Start an old callback, then supersede it while its offline exchange is
    // deliberately held open. Complete the newer callback first, then prove
    // the late older response cannot overwrite its stored token.
    const oldCallback = auth.handleCallback('old-code', secondOutstanding);
    assert.equal(exchanges.length, 1);
    const newestState = stateFrom(await auth.generateAuthorizeUrl('mother'));
    const newestCallback = auth.handleCallback('new-code', newestState);
    assert.equal(exchanges.length, 2);
    exchanges[1]!.resolve(tokenResponse('newest-token'));
    assert.deepEqual(await newestCallback, {
      success: true,
      profileId: 'mother'
    });
    assert.equal(await store.getAccessToken('mother'), 'newest-token');

    exchanges[0]!.resolve(tokenResponse('older-token'));
    assert.equal((await oldCallback).success, false);
    assert.equal(await store.getAccessToken('mother'), 'newest-token');

    const callsBeforeReplay = exchanges.length;
    assert.equal(
      (await auth.handleCallback('replay-code', newestState)).success,
      false
    );
    assert.equal(
      exchanges.length,
      callsBeforeReplay,
      'A consumed OAuth state must never be exchanged twice.'
    );
    assert.equal(await store.getAccessToken('mother'), 'newest-token');

    console.log('Swiggy OAuth state tests passed without external calls.');
  } finally {
    if (savedAccessToken === undefined) {
      delete process.env.SWIGGY_ACCESS_TOKEN;
    } else {
      process.env.SWIGGY_ACCESS_TOKEN = savedAccessToken;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
