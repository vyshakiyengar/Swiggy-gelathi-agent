import { Request, Response } from 'express';
import { geminiAgentService, UserInput } from '../agent/gemini';
import { whatsAppCloudApiService, WhatsAppButton } from './cloud_api';

// Payment method buttons - the only place in the flow that uses interactive buttons.
// Mapped to unambiguous instruction text rather than trusting the model to recall the exact
// intentApp id from a button title alone, since this step moves real money.
const PAYMENT_METHOD_BUTTONS: WhatsAppButton[] = [
  { id: 'pay_cod', title: '💵 Cash on Delivery' },
  { id: 'pay_gpay', title: '📱 Google Pay' },
  { id: 'pay_phonepe', title: '📱 PhonePe' }
];

const PAYMENT_BUTTON_ID_TO_INSTRUCTION: Record<string, string> = {
  pay_cod: 'Pay by Cash on Delivery',
  pay_gpay: 'Pay by UPI using Google Pay',
  pay_phonepe: 'Pay by UPI using PhonePe'
};

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
      // 4. Voice note - Gemini understands audio natively, no separate transcription needed
      else if (messageType === 'audio') {
        const mediaId = messageObj.audio?.id;
        if (mediaId) {
          console.log(`\n📱 [Incoming voice note from +${fromNumber}]`);
          const { data, mimeType } = await whatsAppCloudApiService.downloadMedia(mediaId);
          input = { type: 'audio', data, mimeType };
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

        const showedPaymentOptions = agentResponse.toolCallsExecuted.some(
          (t) => t.toolName === 'get_payment_options' && t.result?.success !== false
        );
        if (showedPaymentOptions) {
          await whatsAppCloudApiService.sendInteractiveButtons(
            fromNumber,
            'Tap to choose how you\'d like to pay:',
            PAYMENT_METHOD_BUTTONS
          );
        }
      }
    }
  } catch (error) {
    console.error('❌ Error processing WhatsApp incoming webhook:', error);
  }
};
