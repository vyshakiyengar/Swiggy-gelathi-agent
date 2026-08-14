import { whatsAppCloudApiService } from './whatsapp/cloud_api';
import { geminiAgentService } from './agent/gemini';
import { zeptoStoreService } from './mcp/zepto_catalog';

async function testMetaCloudWebhookSimulation() {
  console.log('📲 ======================================================');
  console.log('📲 TESTING META WHATSAPP CLOUD API INTEGRATION & WEBHOOKS');
  console.log('======================================================\n');

  const testPhone = '919845012345';

  // 1. Check Configuration status
  const status = whatsAppCloudApiService.getStatus();
  console.log('1️⃣ WhatsApp Cloud API Status:', status);

  // 2. Simulate Meta Webhook Payload (Incoming Text Message from Mom on WhatsApp)
  console.log('\n2️⃣ Simulating Incoming Meta Webhook Event (Text: "2 packet halu, 1 dahi"):');
  const sampleMetaPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456789012345',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550234567',
                phone_number_id: '987654321012345'
              },
              contacts: [{ profile: { name: 'Amma' }, wa_id: testPhone }],
              messages: [
                {
                  from: testPhone,
                  id: 'wamid.HBgMOTE5ODQ1MDEyMzQ1FQIAEhgg...',
                  timestamp: '1723654000',
                  text: { body: '2 packet halu, 1 dahi' },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  const incomingText = sampleMetaPayload.entry[0].changes[0].value.messages[0].text.body;
  const agentResponse = await geminiAgentService.processMessage(testPhone, incomingText);
  const cart = zeptoStoreService.getOrCreateCart(testPhone);

  console.log(`🤖 Agent Response to WhatsApp:\n${agentResponse.reply}`);

  // 3. Test sending interactive buttons back to user
  console.log('\n3️⃣ Outgoing Meta Cloud API Message (with Interactive Quick Checkout Buttons):');
  await whatsAppCloudApiService.sendCartSummaryWithActions(testPhone, agentResponse.reply, cart);

  // 4. Simulate Meta Webhook Payload (Button Click: "⚡ Pay with UPI")
  console.log('\n4️⃣ Simulating Incoming Button Click (Interactive Reply: "btn_confirm_upi"):');
  const sampleButtonClickPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456789012345',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [
                {
                  from: testPhone,
                  id: 'wamid.HBgMOTE5ODQ1MDEyMzQ1FQIAEhggBTN...',
                  timestamp: '1723654010',
                  type: 'interactive',
                  interactive: {
                    type: 'button_reply',
                    button_reply: {
                      id: 'btn_confirm_upi',
                      title: '⚡ Pay with UPI'
                    }
                  }
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  const buttonReplyText = 'Confirm order with UPI';
  const orderResponse = await geminiAgentService.processMessage(testPhone, buttonReplyText);

  console.log(`\n🤖 Agent Order Response:\n${orderResponse.reply}`);
  if (orderResponse.orderDetails) {
    await whatsAppCloudApiService.sendOrderConfirmation(testPhone, orderResponse.orderDetails);
  }

  console.log('\n🎉 META WHATSAPP CLOUD API SIMULATION TEST COMPLETED!\n');
}

testMetaCloudWebhookSimulation().catch(console.error);
