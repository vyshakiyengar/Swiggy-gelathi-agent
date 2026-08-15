import { Request, Response } from 'express';
import { geminiAgentService } from '../agent/gemini';
import { whatsAppCloudApiService } from './cloud_api';

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

      // 1. Text message
      if (messageType === 'text') {
        incomingText = messageObj.text?.body || '';
      }
      // 2. Interactive Button/List Click
      else if (messageType === 'interactive') {
        const interactiveType = messageObj.interactive?.type;
        if (interactiveType === 'button_reply') {
          incomingText = messageObj.interactive.button_reply.title || messageObj.interactive.button_reply.id;
        } else if (interactiveType === 'list_reply') {
          incomingText = messageObj.interactive.list_reply.title || messageObj.interactive.list_reply.id;
        }
      }
      // 3. Quick reply button
      else if (messageType === 'button') {
        incomingText = messageObj.button?.text || messageObj.button?.payload || '';
      }

      if (incomingText.trim()) {
        console.log(`\n📱 [Incoming WhatsApp from +${fromNumber}]: "${incomingText}"`);

        const agentResponse = await geminiAgentService.processMessage(fromNumber, incomingText);

        console.log(`🤖 [Agent Reply for +${fromNumber}]:\n${agentResponse.reply}`);

        await whatsAppCloudApiService.sendTextMessage(fromNumber, agentResponse.reply);
      }
    }
  } catch (error) {
    console.error('❌ Error processing WhatsApp incoming webhook:', error);
  }
};
