import { Request, Response } from 'express';
import { whatsAppCloudApiService } from './whatsapp/cloud_api';
import { handleWhatsAppIncomingMessage } from './whatsapp/webhook';

function mockResponse(): Response {
  return {
    status(code: number) {
      console.log(`   (webhook responded ${code} to Meta)`);
      return this;
    },
    json() {
      return this;
    }
  } as unknown as Response;
}

async function testMetaCloudWebhookSimulation() {
  console.log('📲 ======================================================');
  console.log('📲 TESTING META WHATSAPP CLOUD API INTEGRATION & WEBHOOKS');
  console.log('======================================================\n');

  const testPhone = '919845012345';

  const status = whatsAppCloudApiService.getStatus();
  console.log('1️⃣ WhatsApp Cloud API Status:', status);

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

  await handleWhatsAppIncomingMessage({ body: sampleMetaPayload } as Request, mockResponse());

  console.log('\n🎉 META WHATSAPP CLOUD API SIMULATION TEST COMPLETED!\n');
}

testMetaCloudWebhookSimulation().catch(console.error);
