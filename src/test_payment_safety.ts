import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProfileTurnQueue } from './agent/profile_turn_queue';
import {
  claimPaymentAuthorization,
  clearPaymentSafetyState,
  consumePaymentAuthorization,
  markPaymentOptionsDelivered,
  PaymentAuthorization,
  PAYMENT_OFFER_TTL_MS,
  preparePaymentOptionsPresentation
} from './swiggy/payment_safety';

const PAYMENT_OPTIONS_RESULT = {
  success: true,
  data: {
    cod: { available: true },
    platforms: {
      mobile: {
        methods: [
          { id: 'gpay://upi/' },
          { id: 'phonepe://' },
          { id: 'paytmmp://' }
        ]
      }
    }
  }
};

function freshPresentation(profileId = 'mother', domain: 'food' | 'instamart' = 'food') {
  clearPaymentSafetyState(profileId);
  const presentation = preparePaymentOptionsPresentation(
    profileId,
    domain,
    PAYMENT_OPTIONS_RESULT
  );
  assert.ok(presentation);
  return presentation;
}

function deliver(profileId = 'mother', domain: 'food' | 'instamart' = 'food') {
  const presentation = freshPresentation(profileId, domain);
  assert.equal(markPaymentOptionsDelivered(presentation), true);
  return presentation;
}

async function testPaymentStateMachine(): Promise<void> {
  const notYetDelivered = freshPresentation();
  assert.equal(
    claimPaymentAuthorization('mother', {
      kind: 'interactive',
      buttonId: notYetDelivered.buttons[0].id
    }),
    null,
    'Preparing buttons must not open the order gate.'
  );

  assert.equal(markPaymentOptionsDelivered(notYetDelivered), true);
  assert.equal(
    markPaymentOptionsDelivered(notYetDelivered),
    false,
    'A presentation may only be committed once.'
  );

  const interactive = claimPaymentAuthorization('mother', {
    kind: 'interactive',
    buttonId: notYetDelivered.buttons[1].id
  });
  assert.ok(interactive);
  assert.equal(interactive.authorization.paymentMethod, 'UPI');
  assert.equal(interactive.authorization.intentApp, 'gpay://upi/');

  const wrongApp = consumePaymentAuthorization(
    interactive.authorization,
    'mother',
    'food',
    { paymentMethod: 'UPI', intentApp: 'phonepe://' }
  );
  assert.equal(wrongApp.ok, false, 'A different UPI app must be rejected.');
  assert.equal(
    consumePaymentAuthorization(
      interactive.authorization,
      'mother',
      'food',
      { paymentMethod: 'UPI', intentApp: 'gpay://upi/' }
    ).ok,
    false,
    'Even a rejected order attempt consumes the one-use authorization.'
  );

  deliver();
  const textChoice = claimPaymentAuthorization('mother', {
    kind: 'text',
    text: 'Google Pay'
  });
  assert.ok(textChoice);
  assert.deepEqual(
    consumePaymentAuthorization(
      textChoice.authorization,
      'mother',
      'food',
      { paymentMethod: 'UPI', intentApp: 'gpay://upi/' }
    ),
    {
      ok: true,
      paymentArgs: { paymentMethod: 'UPI', intentApp: 'gpay://upi/' }
    }
  );

  deliver();
  const codChoice = claimPaymentAuthorization('mother', {
    kind: 'text',
    text: 'COD'
  });
  assert.ok(codChoice);
  assert.deepEqual(
    consumePaymentAuthorization(
      codChoice.authorization,
      'mother',
      'food',
      { paymentMethod: 'COD' }
    ),
    { ok: true, paymentArgs: { paymentMethod: 'Cash' } }
  );

  deliver();
  assert.equal(
    claimPaymentAuthorization('self', { kind: 'text', text: 'COD' }),
    null,
    'One profile must not claim another profile\'s offer.'
  );
  assert.ok(
    claimPaymentAuthorization('mother', { kind: 'text', text: 'COD' }),
    'A cross-profile attempt must not consume the rightful profile\'s offer.'
  );

  deliver();
  assert.equal(
    claimPaymentAuthorization('mother', {
      kind: 'text',
      text: 'yes, please choose whatever is easiest'
    }),
    null,
    'Ambiguous text must not authorize a payment method.'
  );
  assert.equal(
    claimPaymentAuthorization('mother', { kind: 'text', text: 'COD' }),
    null,
    'An unrelated next reply expires the delivered offer.'
  );

  const expiredPresentation = freshPresentation();
  assert.equal(markPaymentOptionsDelivered(expiredPresentation, 1_000), true);
  assert.equal(
    claimPaymentAuthorization(
      'mother',
      { kind: 'text', text: 'COD' },
      1_000 + PAYMENT_OFFER_TTL_MS + 1
    ),
    null,
    'An old delivered offer must expire even if no intervening message arrived.'
  );

  const oldPresentation = deliver();
  const newPresentation = preparePaymentOptionsPresentation(
    'mother',
    'food',
    PAYMENT_OPTIONS_RESULT
  );
  assert.ok(newPresentation);
  assert.equal(markPaymentOptionsDelivered(newPresentation), true);
  assert.equal(
    claimPaymentAuthorization('mother', {
      kind: 'interactive',
      buttonId: oldPresentation.buttons[0].id
    }),
    null,
    'A nonce-bound button from an older offer must not authorize the latest cart.'
  );

  const fabricated = {
    profileId: 'mother',
    domain: 'food',
    paymentMethod: 'Cash'
  } as PaymentAuthorization;
  assert.equal(
    consumePaymentAuthorization(fabricated, 'mother', 'food', {
      paymentMethod: 'Cash'
    }).ok,
    false,
    'Callers cannot fabricate an authorization object.'
  );

  deliver();
  const wrongDomainChoice = claimPaymentAuthorization('mother', {
    kind: 'text',
    text: 'COD'
  });
  assert.ok(wrongDomainChoice);
  assert.equal(
    consumePaymentAuthorization(
      wrongDomainChoice.authorization,
      'mother',
      'instamart',
      { paymentMethod: 'Cash' }
    ).ok,
    false,
    'A Food offer must not authorize an Instamart order.'
  );

  deliver();
  const wrongProfileChoice = claimPaymentAuthorization('mother', {
    kind: 'text',
    text: 'COD'
  });
  assert.ok(wrongProfileChoice);
  assert.equal(
    consumePaymentAuthorization(
      wrongProfileChoice.authorization,
      'self',
      'food',
      { paymentMethod: 'Cash' }
    ).ok,
    false,
    'An authorization must not cross profiles at the order boundary.'
  );

  deliver();
  const cashWithIntentApp = claimPaymentAuthorization('mother', {
    kind: 'text',
    text: 'COD'
  });
  assert.ok(cashWithIntentApp);
  assert.equal(
    consumePaymentAuthorization(
      cashWithIntentApp.authorization,
      'mother',
      'food',
      { paymentMethod: 'Cash', intentApp: 'gpay://upi/' }
    ).ok,
    false,
    'Cash authorization must reject an injected intentApp.'
  );
}

async function testProfileTurnQueue(): Promise<void> {
  const queue = new ProfileTurnQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run('mother', async () => {
    events.push('mother:first:start');
    await firstGate;
    events.push('mother:first:end');
  });
  const second = queue.run('mother', async () => {
    events.push('mother:second');
  });
  const independent = queue.run('self', async () => {
    events.push('self');
  });

  await independent;
  assert.deepEqual(events, ['mother:first:start', 'self']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    'mother:first:start',
    'self',
    'mother:first:end',
    'mother:second'
  ]);
}

async function testOfflineToolBoundary(): Promise<void> {
  const originalCwd = process.cwd();
  const originalStorePath = process.env.AGENT_PROFILE_STORE_PATH;
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'swiggy-payment-boundary-')
  );

  try {
    process.chdir(temporaryDirectory);
    process.env.AGENT_PROFILE_STORE_PATH = path.join(
      temporaryDirectory,
      'profiles.json'
    );

    const [{ profileStore }, toolModule, mcpModule] = await Promise.all([
      import('./profiles/store'),
      import('./swiggy/gemini_tools'),
      import('./swiggy/mcp_client')
    ]);
    await profileStore.initialize();
    await profileStore.updateProfile('mother', {
      capabilities: { food: true, instamart: true },
      address: {
        id: 'test-address',
        label: 'Test home',
        formattedAddress: 'Offline test address',
        latitude: 12.9,
        longitude: 77.5
      }
    });

    const originalFoodCall = mcpModule.swiggyFoodMcpService.callTool;
    const originalInstamartCall = mcpModule.swiggyMcpService.callTool;
    const calls: Array<{
      service: 'food' | 'instamart';
      profileId: string;
      toolName: string;
      args: Record<string, any>;
    }> = [];
    mcpModule.swiggyFoodMcpService.callTool = async (
      profileId: string,
      toolName: string,
      args: Record<string, any>
    ) => {
      calls.push({ service: 'food', profileId, toolName, args });
      return { success: true, status: 'TEST_ONLY' };
    };
    mcpModule.swiggyMcpService.callTool = async (
      profileId: string,
      toolName: string,
      args: Record<string, any>
    ) => {
      calls.push({ service: 'instamart', profileId, toolName, args });
      return { success: true, status: 'TEST_ONLY' };
    };

    try {
      await toolModule.executeSwiggyTool('mother', 'get_food_cart', {});
      const presentation = deliver('mother', 'food');
      const choice = claimPaymentAuthorization('mother', {
        kind: 'interactive',
        buttonId: presentation.buttons[1].id
      });
      assert.ok(choice);

      const orderResult = await toolModule.executeSwiggyTool(
        'mother',
        'place_food_order',
        { paymentMethod: 'UPI', intentApp: 'gpay://upi/' },
        choice.authorization
      );
      assert.equal(orderResult.success, true);
      assert.deepEqual(calls.at(-1), {
        service: 'food',
        profileId: 'mother',
        toolName: 'place_food_order',
        args: {
          paymentMethod: 'UPI',
          intentApp: 'gpay://upi/',
          addressId: 'test-address'
        }
      });

      const mutationPresentation = deliver('mother', 'food');
      const mutationChoice = claimPaymentAuthorization('mother', {
        kind: 'interactive',
        buttonId: mutationPresentation.buttons[0].id
      });
      assert.ok(mutationChoice);
      await toolModule.executeSwiggyTool(
        'mother',
        'update_food_cart',
        {},
        mutationChoice.authorization
      );
      const callsAfterCartMutation = calls.length;
      const postMutationOrder = await toolModule.executeSwiggyTool(
        'mother',
        'place_food_order',
        { paymentMethod: 'Cash' },
        mutationChoice.authorization
      );
      assert.equal(postMutationOrder.success, false);
      assert.equal(
        calls.length,
        callsAfterCartMutation,
        'Changing the cart after payment selection must revoke authorization before MCP checkout.'
      );

      await toolModule.executeSwiggyTool('mother', 'get_food_cart', {});
      deliver('mother', 'food');
      const changedProfile = await profileStore.updateProfile('mother', {
        capabilities: { food: false }
      });
      toolModule.synchronizeSwiggyProfileRuntime(changedProfile);
      assert.equal(
        claimPaymentAuthorization('mother', { kind: 'text', text: 'COD' }),
        null,
        'Changing profile capabilities must clear delivered payment state.'
      );

      const callsBeforeSharedTool = calls.length;
      const sharedResult = await toolModule.executeSwiggyTool(
        'mother',
        'confirm_order',
        {}
      );
      assert.equal(sharedResult.success, false);
      assert.equal(
        calls.length,
        callsBeforeSharedTool,
        'A shared tool for a disabled/stale domain must never reach MCP.'
      );

      await profileStore.updateProfile('mother', {
        capabilities: { food: true }
      });
      await toolModule.executeSwiggyTool('mother', 'get_food_cart', {});
      const callsBeforeUnauthorizedOrder = calls.length;
      const unauthorizedOrder = await toolModule.executeSwiggyTool(
        'mother',
        'place_food_order',
        { paymentMethod: 'Cash' }
      );
      assert.equal(unauthorizedOrder.success, false);
      assert.equal(
        calls.length,
        callsBeforeUnauthorizedOrder,
        'A model-supplied payment method without inbound authorization must not reach MCP.'
      );
    } finally {
      mcpModule.swiggyFoodMcpService.callTool = originalFoodCall;
      mcpModule.swiggyMcpService.callTool = originalInstamartCall;
    }
  } finally {
    process.chdir(originalCwd);
    if (originalStorePath === undefined) {
      delete process.env.AGENT_PROFILE_STORE_PATH;
    } else {
      process.env.AGENT_PROFILE_STORE_PATH = originalStorePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await testPaymentStateMachine();
  await testProfileTurnQueue();
  await testOfflineToolBoundary();
  console.log('Payment safety state-machine tests passed (offline).');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
