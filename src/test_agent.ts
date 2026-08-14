import { geminiAgentService } from './agent/gemini';
import { zeptoStoreService } from './mcp/zepto_catalog';

async function runConversationalTest() {
  const sessionId = '919845012345';
  console.log('🤖 ======================================================');
  console.log('🤖 TESTING CONVERSATIONAL AGENT & MCP HARNESS');
  console.log('======================================================\n');

  // Clear previous state
  zeptoStoreService.clearCart(sessionId);
  geminiAgentService.clearHistory(sessionId);

  const turns = [
    // Turn 1: Kanglish multi-item request
    'Namaskara, 1 packet halu, 6 motte, mathe 1 packet godhi bread beku',
    // Turn 2: Check cart & apply coupon
    'Apply coupon ZEPTO50',
    // Turn 3: Modify cart (remove bread, add kottambari)
    'Bread bedi, 1 bunch kottambari soppu add maadi',
    // Turn 4: Confirmation to place order with UPI
    'Theek ide, order maadi with UPI'
  ];

  for (let i = 0; i < turns.length; i++) {
    const userMsg = turns[i];
    console.log(`\n💬 [Turn ${i + 1}] Amma: "${userMsg}"`);

    const response = await geminiAgentService.processMessage(sessionId, userMsg);

    console.log(`\n🤖 [Turn ${i + 1}] Zepto Agent Reply:\n----------------------------------------`);
    console.log(response.reply);
    console.log(`----------------------------------------`);
    console.log(`🔧 Tool calls executed (${response.toolCallsExecuted.length}):`);
    response.toolCallsExecuted.forEach((t) => {
      console.log(`   - ${t.toolName}(${JSON.stringify(t.args)})`);
    });

    if (response.orderDetails) {
      console.log(`\n📦 Placed Order ID: ${response.orderDetails.orderId}`);
      console.log(`⚡ ETA: ${response.orderDetails.deliveryEtaMinutes} minutes`);
      console.log(`🛵 Rider: ${response.orderDetails.riderName}`);
      console.log(`💳 UPI Deep Link: ${response.orderDetails.upiDeepLink}`);
    }
  }

  console.log('\n🎉 ALL CONVERSATION TURNS COMPLETED SUCCESSFULLY!\n');
}

runConversationalTest().catch(console.error);
