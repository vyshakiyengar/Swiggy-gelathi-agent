import { Request, Response } from 'express';
import { geminiAgentService, UserInput } from '../agent/gemini';
import { ProfileTurnQueue } from '../agent/profile_turn_queue';
import { whatsAppCloudApiService } from './cloud_api';
// --- Gnani trial integration (voice notes) - see src/gnani/ and README's "Removing Gnani"
// section for the one-command revert if the trial credits run out or it's turned off.
import { transcribeWithGnani } from '../gnani/stt';
import { sendKannadaVoiceReply } from '../gnani/tts';
import { profileStore } from '../profiles/store';
import { synchronizeSwiggyProfileRuntime } from '../swiggy/gemini_tools';
import {
  claimPaymentAuthorization,
  markPaymentOptionsDelivered,
  PaymentChoiceInput,
  preparePaymentOptionsPresentation
} from '../swiggy/payment_safety';

// Covers model processing plus outbound delivery. Payment state therefore cannot be advanced by a
// second message while the first profile turn is still sending its reply/options.
const inboundTurnQueue = new ProfileTurnQueue();

/**
 * Handles Meta WhatsApp Cloud API Webhook Verification (GET)
 * Meta will ping this during webhook setup in Meta Developer App Settings.
 */
export const verifyWhatsAppWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (expectedToken && mode === 'subscribe' && token === expectedToken) {
    console.log('✅ Meta WhatsApp Webhook verified successfully!');
    return res.status(200).send(challenge);
  } else {
    console.warn('❌ Meta WhatsApp Webhook verification failed.');
    return res.sendStatus(403);
  }
};

/**
 * Processes one already-profile-resolved inbound message while the profile queue is held.
 */
async function processKnownProfileMessage(
  expectedProfileId: string,
  fromNumber: string,
  messageObj: any
): Promise<void> {
  const activeProfile = await profileStore.resolveProfile(fromNumber);
  const normalizedFrom = fromNumber.replace(/\D/g, '');
  if (
    !activeProfile ||
    activeProfile.id !== expectedProfileId ||
    activeProfile.whatsappNumber !== normalizedFrom
  ) return;
  synchronizeSwiggyProfileRuntime(activeProfile);

  const messageId = messageObj.id;
  const messageType = messageObj.type;
  whatsAppCloudApiService.markMessageAsRead(messageId).catch(() => {});

  // A paused profile needs no media download, speech service, Gemini, or payment-state work.
  if (!activeProfile.enabled) {
    await whatsAppCloudApiService.sendTextMessage(
      fromNumber,
      `⏸️ ${activeProfile.assistantName} is paused for this number. You can turn it back on from the household desk.`
    );
    return;
  }

  let incomingText = '';
  let input: UserInput | null = null;
  let wasVoiceNote = false;
  let paymentChoiceInput: PaymentChoiceInput = { kind: 'unsupported' };

  if (messageType === 'text') {
    incomingText = messageObj.text?.body || '';
    paymentChoiceInput = { kind: 'text', text: incomingText };
  } else if (messageType === 'interactive') {
    const interactiveType = messageObj.interactive?.type;
    if (interactiveType === 'button_reply') {
      const buttonId = messageObj.interactive.button_reply.id;
      incomingText = messageObj.interactive.button_reply.title || buttonId;
      paymentChoiceInput = { kind: 'interactive', buttonId };
    } else if (interactiveType === 'list_reply') {
      incomingText =
        messageObj.interactive.list_reply.title ||
        messageObj.interactive.list_reply.id;
    }
  } else if (messageType === 'button') {
    incomingText = messageObj.button?.text || messageObj.button?.payload || '';
  } else if (messageType === 'audio') {
    const mediaId = messageObj.audio?.id;
    if (mediaId) {
      console.log(`\n📱 [Incoming voice note from +${fromNumber}]`);
      wasVoiceNote = true;
      const { data, mimeType } = await whatsAppCloudApiService.downloadMedia(mediaId);
      const gnaniTranscript = await transcribeWithGnani(data, mimeType);
      if (gnaniTranscript) {
        console.log(`🎙️ [Gnani transcript]: "${gnaniTranscript}"`);
        input = { type: 'text', text: gnaniTranscript };
      } else {
        input = { type: 'audio', data, mimeType };
      }
    }
  }

  if (incomingText.trim()) input = { type: 'text', text: incomingText };

  // Every inbound message consumes the previous offer. Unsupported/empty messages cannot
  // authorize payment but still prevent a much-later stale button from being accepted.
  const claimedPayment = claimPaymentAuthorization(
    activeProfile.id,
    paymentChoiceInput
  );
  if (!input) return;

  const turnInput: UserInput = claimedPayment
    ? { type: 'text', text: claimedPayment.instruction }
    : input;
  if (turnInput.type === 'text') {
    console.log(`\n📱 [Incoming WhatsApp from +${fromNumber}]: "${turnInput.text}"`);
  }

  const agentResponse = await geminiAgentService.processMessage(
    fromNumber,
    turnInput,
    { paymentAuthorization: claimedPayment?.authorization }
  );

  console.log(`🤖 [Agent Reply for +${fromNumber}]:\n${agentResponse.reply}`);
  await whatsAppCloudApiService.sendTextMessage(fromNumber, agentResponse.reply);

  const paymentOptionsCall = agentResponse.toolCallsExecuted.find(
    (toolCall) =>
      toolCall.toolName === 'get_payment_options' &&
      toolCall.result?.success !== false &&
      toolCall.swiggyDomain !== null
  );
  if (paymentOptionsCall?.swiggyDomain) {
    const presentation = preparePaymentOptionsPresentation(
      activeProfile.id,
      paymentOptionsCall.swiggyDomain,
      paymentOptionsCall.result
    );
    if (presentation) {
      await whatsAppCloudApiService.sendInteractiveButtons(
        fromNumber,
        'Tap to choose how you\'d like to pay:',
        presentation.buttons
      );
      // Deliberately after the await: a failed send never opens the order gate.
      markPaymentOptionsDelivered(presentation);
    } else {
      console.warn(
        `⚠️ get_payment_options succeeded but no supported COD/UPI methods were available for +${fromNumber} - no payment offer was activated.`
      );
    }
  }

  const orderPlacingCall = agentResponse.toolCallsExecuted.find(
    (toolCall) =>
      (toolCall.toolName === 'checkout' ||
        toolCall.toolName === 'place_food_order') &&
      toolCall.result?.success !== false
  );
  if (
    orderPlacingCall?.result?.status === 'PENDING_PAYMENT' &&
    orderPlacingCall.result?.bridgeUrl
  ) {
    await whatsAppCloudApiService.sendTextMessage(
      fromNumber,
      `💳 Tap to complete payment: ${orderPlacingCall.result.bridgeUrl}`
    );
  }

  if (wasVoiceNote && activeProfile.language.voiceReplies) {
    try {
      await sendKannadaVoiceReply(fromNumber, agentResponse.reply);
    } catch (err: any) {
      console.warn(
        '⚠️ Gnani voice reply failed (non-fatal, text reply already sent):',
        err.message
      );
    }
  }
}

/** Handles incoming Meta events. The HTTP acknowledgement remains immediate. */
export const handleWhatsAppIncomingMessage = async (req: Request, res: Response) => {
  res.status(200).json({ status: 'EVENT_RECEIVED' });

  try {
    const body = req.body;
    const messageObj =
      body?.object === 'whatsapp_business_account'
        ? body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
        : null;
    const fromNumber = messageObj?.from;
    if (!messageObj || typeof fromNumber !== 'string') return;

    // Fail closed before media, read receipts, speech, Gemini, sends, or payment state.
    const profile = await profileStore.resolveProfile(fromNumber);
    if (!profile || profile.whatsappNumber !== fromNumber.replace(/\D/g, '')) {
      console.warn(`Ignored WhatsApp message from an unconfigured sender ending ${fromNumber.slice(-4)}.`);
      return;
    }

    await inboundTurnQueue.run(profile.id, () =>
      processKnownProfileMessage(profile.id, fromNumber, messageObj)
    );
  } catch (error) {
    console.error('❌ Error processing WhatsApp incoming webhook:', error);
  }
};
