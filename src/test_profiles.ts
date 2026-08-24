import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentProfileStore } from './profiles/store';
import type { AgentProfile } from './profiles/types';

const PROFILE_ENV_KEYS = [
  'AGENT_MOTHER_WHATSAPP_NUMBER',
  'MOTHER_WHATSAPP_NUMBER',
  'WHATSAPP_MOTHER_NUMBER',
  'SUDHA_WHATSAPP_NUMBER',
  'AGENT_SELF_WHATSAPP_NUMBER',
  'SELF_WHATSAPP_NUMBER',
  'WHATSAPP_SELF_NUMBER',
  'VYSHAK_WHATSAPP_NUMBER',
  'SWIGGY_ACCESS_TOKEN',
  'SWIGGY_TOKEN_ISSUED_AT',
  'SWIGGY_TOKEN_EXPIRES_AT',
  'SWIGGY_DEFAULT_ADDRESS_ID',
  'SWIGGY_DEFAULT_ADDRESS_LABEL',
  'SWIGGY_DEFAULT_FORMATTED_ADDRESS',
  'SWIGGY_DEFAULT_LAT',
  'SWIGGY_DEFAULT_LNG'
] as const;

function assertTokenRedacted(
  profile: AgentProfile,
  ...tokens: string[]
): void {
  const serialized = JSON.stringify(profile);
  assert.equal(
    Object.prototype.hasOwnProperty.call(profile.swiggy, 'accessToken'),
    false
  );
  for (const token of tokens) {
    assert.equal(
      serialized.includes(token),
      false,
      'Public profiles must never contain Swiggy access tokens.'
    );
  }
}

async function run(): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'swiggy-agent-profiles-')
  );
  const storePath = path.join(temporaryDirectory, 'agent-profiles.json');
  const savedEnvironment = new Map<string, string | undefined>();

  for (const key of PROFILE_ENV_KEYS) {
    savedEnvironment.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    const store = new AgentProfileStore(storePath);
    await store.initialize();

    const seeds = await store.listProfiles();
    assert.deepEqual(
      seeds.map((profile) => profile.id),
      ['mother', 'self']
    );
    assert.equal(seeds[0]?.displayName, 'Sudha');
    assert.equal(seeds[0]?.language.replyMode, 'kanglish-kannada');
    assert.equal(seeds[1]?.displayName, 'Vyshak');
    assert.equal(seeds[1]?.language.replyMode, 'english');
    assertTokenRedacted(seeds[0]!);
    assertTokenRedacted(seeds[1]!);

    // Routing is fail-closed even before either seeded profile has a number.
    // Exact ids remain available for trusted internal callers, but an unknown
    // phone must never inherit Mother's credentials or ordering context.
    assert.equal(await store.resolveProfile('919999999999'), undefined);
    assert.equal((await store.resolveProfile('mother'))?.id, 'mother');

    const mother = await store.updateProfile('mother', {
      whatsappNumber: '+91 98765-43210',
      language: { voiceReplies: false },
      preferences: {
        dietary: ['Vegetarian'],
        preferredBrands: ['Nandini'],
        spice: 'mild'
      },
      customInstructions: 'Prefer low-sugar options.'
    });
    assert.equal(mother.whatsappNumber, '919876543210');
    assert.deepEqual(mother.preferences.dietary, ['Vegetarian']);

    const selfBefore = await store.getProfile('self');
    assert.equal(selfBefore?.whatsappNumber, null);
    assert.deepEqual(selfBefore?.preferences.dietary, []);

    const self = await store.updateProfile('self', {
      whatsappNumber: '+91 (91234) 56789',
      preferences: {
        avoidItems: ['Peanuts'],
        maxOrderValueInr: 1500
      }
    });
    assert.equal(self.whatsappNumber, '919123456789');
    assert.deepEqual(self.preferences.avoidItems, ['Peanuts']);

    assert.equal(
      (await store.resolveProfile('+91 98765 43210'))?.id,
      'mother'
    );
    assert.equal(
      (await store.resolveProfile('91-91234-56789'))?.id,
      'self'
    );
    assert.equal(await store.resolveProfile('919999999999'), undefined);

    await assert.rejects(
      store.updateProfile('self', {
        whatsappNumber: '+91 98765 43210'
      }),
      /assigned to both/
    );
    assert.equal(
      (await store.getProfile('self'))?.whatsappNumber,
      '919123456789'
    );

    const motherToken = 'mother-secret-access-token';
    const selfToken = 'self-secret-access-token';
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();

    const motherWithSession = await store.setSwiggySession('mother', {
      accessToken: motherToken,
      expiresAt: futureExpiry
    });
    const selfWithSession = await store.setSwiggySession('self', {
      accessToken: selfToken,
      expiresAt: futureExpiry
    });
    assertTokenRedacted(motherWithSession, motherToken, selfToken);
    assertTokenRedacted(selfWithSession, motherToken, selfToken);
    assert.equal(await store.getAccessToken('mother'), motherToken);
    assert.equal(await store.getAccessToken('self'), selfToken);

    await store.setSwiggySession('self', {
      accessToken: selfToken,
      expiresAt: pastExpiry
    });
    assert.equal(await store.getAccessToken('self'), null);
    assert.equal((await store.getProfile('self'))?.swiggy.connected, false);
    assert.equal(await store.getAccessToken('mother'), motherToken);
    assert.equal((await store.getProfile('mother'))?.swiggy.connected, true);

    const reloaded = new AgentProfileStore(storePath);
    await reloaded.initialize();
    assert.equal(
      (await reloaded.getProfile('mother'))?.whatsappNumber,
      '919876543210'
    );
    assert.deepEqual(
      (await reloaded.getProfile('self'))?.preferences.avoidItems,
      ['Peanuts']
    );
    assert.equal(await reloaded.getAccessToken('mother'), motherToken);
    assert.equal(await reloaded.getAccessToken('self'), null);
    for (const profile of await reloaded.listProfiles()) {
      assertTokenRedacted(profile, motherToken, selfToken);
    }

    if (process.platform !== 'win32') {
      const fileMode = (await stat(storePath)).mode & 0o777;
      assert.equal(fileMode, 0o600);
    }

    console.log('Profile store tests passed.');
  } finally {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
