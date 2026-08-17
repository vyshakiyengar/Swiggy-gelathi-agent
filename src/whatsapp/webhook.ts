import { Request, Response } from 'express';
import { geminiAgentService, UserInput } from '../agent/gemini';
import { whatsAppCloudApiService, WhatsAppButton } from './cloud_api';
// --- Gnani trial integration (voice notes) - see src/gnani/ and README's "Removing Gnani"
// section for the one-command revert if the trial credits run out or it's turned off.
import { transcribeWithGnani } from '../gnani/stt';
import { sendKannadaVoiceReply } from '../gnani/tts';

// Payment method buttons - the only place in the flow that uses interactive buttons. Mapped to
// unambiguous instruction text rather than trusting the model to recall the exact intentApp id
// from a button title alone, since this step moves real money. This full mapping is static and
// stateless (covers every UPI app Swiggy is known to offer) even though which of these actually
// get SHOWN as buttons is decided per-message from the real get_payment_options response (see
// buildPaymentButtons) - a cart with no Google Pay available, for example, must not show a
// Google Pay button just because that's the usual default.
const KNOWN_UPI_METHODS: { intentAppId: string; buttonId: string; title: string; label: string }[] = [
  { intentAppId: 'gpay://upi/', buttonId: 'pay_gpay', title: '📱 Google Pay', label: 'Google Pay' },
  { intentAppId: 'phonepe://', buttonId: 'pay_phonepe', title: '📱 PhonePe', label: 'PhonePe' },
  { intentAppId: 'paytmmp://', buttonId: 'pay_paytm', title: '📱 Paytm', label: 'Paytm' },
  { intentAppId: 'bhim://upi/', buttonId: 'pay_bhim', title: '📱 BHIM', label: 'BHIM' },
  { intentAppId: 'credpay://upi/', buttonId: 'pay_cred', title: '📱 CRED', label: 'CRED' },
  { intentAppId: 'super://', buttonId: 'pay_supermoney', title: '📱 super.money', label: 'super.money' }
];

const PAYMENT_BUTTON_ID_TO_INSTRUCTION: Record<string, string> = {
  pay_cod: 'Pay by Cash on Delivery',
  ...Object.fromEntries(KNOWN_UPI_METHODS.map((m) => [m.buttonId, `Pay by UPI using ${m.label}`]))
};

/**
 * Builds up to 3 payment buttons (Meta's cap) reflecting what's genuinely available for THIS
 * cart, from the real get_payment_options tool result - not an assumed fixed set. Prefers Cash
 * on Delivery + Google Pay + PhonePe when present (the common case), then fills any remaining
 * slots with whatever other UPI apps are actually offered.
 */
function buildPaymentButtons(paymentOptionsResult: any): WhatsAppButton[] {
  const data = paymentOptionsResult?.data ?? paymentOptionsResult ?? {};
  const availableIntentIds = new Set<string>((data.platforms?.mobile?.methods || []).map((m: any) => m.id));
  const codAvailable = data.cod?.available === true;

  const buttons: WhatsAppButton[] = [];
  if (codAvailable) buttons.push({ id: 'pay_cod', title: '💵 Cash on Delivery' });

  for (const method of KNOWN_UPI_METHODS) {
    if (buttons.length >= 3) break;
    if (availableIntentIds.has(method.intentAppId)) {
      buttons.push({ id: method.buttonId, title: method.title });
    }
  }

  return buttons;
}

/**
 * Handles Meta WhatsApp Cloud API Webhook Verification (GET)
 * Meta will ping this during webhook setup in Meta Developer App Settings.
 */
export const verifyWhatsAppWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || 'swiggy_amma_agent_secret_2026';

  console.log(`🔍 Received WhatsApp Webhook verification request: mode="${mode}", token="${token}"`);

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('✅ Meta WhatsApp Webhook verified successfully!');
    return res.status(200).send(challenge);
  } else {
    console.warn(`❌ Verification failed: expected "${expectedToken}", got "${token}"`);
    return res.sendStatus(403);
  }
};

/**
 * Handles incoming messages & events from Meta WhatsApp Cloud API (POST)
 */
export const handleWhatsAppIncomingMessage = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Immediately acknowledge receipt to Meta (Meta requires 200 OK within 3 seconds)
    res.status(200).json({ status: 'EVENT_RECEIVED' });

    // Validate payload structure
    if (
      body.object === 'whatsapp_business_account' &&
      body.entry &&
      body.entry[0]?.changes &&
      body.entry[0].changes[0]?.value?.messages
    ) {
      const changeValue = body.entry[0].changes[0].value;
      const messageObj = changeValue.messages[0];
      const fromNumber = messageObj.from; // Sender phone number (e.g. "919876543210")
      const messageId = messageObj.id;
      const messageType = messageObj.type;

      // Mark message as read on WhatsApp (double blue tick)
      whatsAppCloudApiService.markMessageAsRead(messageId).catch(() => {});

      let incomingText = '';
      let input: UserInput | null = null;
      let wasVoiceNote = false;

      // 1. Text message
      if (messageType === 'text') {
        incomingText = messageObj.text?.body || '';
      }
      // 2. Interactive Button/List Click
      else if (messageType === 'interactive') {
        const interactiveType = messageObj.interactive?.type;
        if (interactiveType === 'button_reply') {
          const buttonId = messageObj.interactive.button_reply.id;
          incomingText =
            PAYMENT_BUTTON_ID_TO_INSTRUCTION[buttonId] ||
            messageObj.interactive.button_reply.title ||
            buttonId;
        } else if (interactiveType === 'list_reply') {
          incomingText = messageObj.interactive.list_reply.title || messageObj.interactive.list_reply.id;
        }
      }
      // 3. Quick reply button
      else if (messageType === 'button') {
        incomingText = messageObj.button?.text || messageObj.button?.payload || '';
      }
      // 4. Voice note - try Gnani STT first (fast, ~2.5s budget), fall back to Gemini's
      // native audio understanding if it's unavailable/slow/errors. Either way, this counts
      // as a voice-triggered turn, which also gets a spoken Kannada reply back (see below).
      else if (messageType === 'audio') {
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

      if (incomingText.trim()) {
        input = { type: 'text', text: incomingText };
      }

      if (input) {
        if (input.type === 'text') {
          console.log(`\n📱 [Incoming WhatsApp from +${fromNumber}]: "${input.text}"`);
        }

        const agentResponse = await geminiAgentService.processMessage(fromNumber, input);

        console.log(`🤖 [Agent Reply for +${fromNumber}]:\n${agentResponse.reply}`);

        await whatsAppCloudApiService.sendTextMessage(fromNumber, agentResponse.reply);

        const paymentOptionsCall = agentResponse.toolCallsExecuted.find(
          (t) => t.toolName === 'get_payment_options' && t.result?.success !== false
        );
        if (paymentOptionsCall) {
          const paymentButtons = buildPaymentButtons(paymentOptionsCall.result);
          if (paymentButtons.length > 0) {
            await whatsAppCloudApiService.sendInteractiveButtons(
              fromNumber,
              'Tap to choose how you\'d like to pay:',
              paymentButtons
            );
          } else {
            console.warn(`⚠️ get_payment_options succeeded but no COD/UPI methods were actually available for +${fromNumber} - no buttons sent.`);
          }
        }

        // UPI order-placing calls come back PENDING_PAYMENT with a real payment link
        // (result.bridgeUrl, from mcp_client.ts's structuredContent fallback) - sent here as its
        // own message instead of trusting the model to retype a ~300-character URL verbatim.
        // WhatsApp auto-linkifies plain https:// text, so this is tappable as-is.
        const orderPlacingCall = agentResponse.toolCallsExecuted.find(
          (t) => (t.toolName === 'checkout' || t.toolName === 'place_food_order') && t.result?.success !== false
        );
        if (orderPlacingCall?.result?.status === 'PENDING_PAYMENT' && orderPlacingCall.result?.bridgeUrl) {
          await whatsAppCloudApiService.sendTextMessage(
            fromNumber,
            `💳 Tap to complete payment: ${orderPlacingCall.result.bridgeUrl}`
          );
        }

        // Bonus spoken reply for voice-triggered turns - best-effort, never blocks/replaces
        // the text reply already sent above.
        if (wasVoiceNote) {
          try {
            await sendKannadaVoiceReply(fromNumber, agentResponse.reply);
          } catch (err: any) {
            console.warn('⚠️ Gnani voice reply failed (non-fatal, text reply already sent):', err.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error processing WhatsApp incoming webhook:', error);
  }
};
