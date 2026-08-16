import { geminiAgentService } from './agent/gemini';

/**
 * Smoke test for the conversational agent. Deliberately stops before any order-confirmation
 * turn - if a real SWIGGY_ACCESS_TOKEN is configured, that would place a real, charged order.
 */
async function runConversationalTest() {
  const sessionId = '919845012345';
  console.log('🤖 ======================================================');
  console.log('🤖 TESTING CONVERSATIONAL AGENT & MCP HARNESS');
  console.log('======================================================\n');

  geminiAgentService.clearHistory(sessionId);

  const turns = [
    // Turn 1: Kanglish multi-item request
    'Namaskara, 1 packet halu, 6 motte, mathe 1 packet godhi bread beku',
    // Turn 2: Check cart & bill
    'Esthu aithu? Bill total helu',
    // Turn 3: Modify cart (remove bread, add kottambari)
    'Bread bedi, 1 bunch kottambari soppu add maadi'
  ];

  for (let i = 0; i < turns.length; i++) {
    const userMsg = turns[i];
    console.log(`\n💬 [Turn ${i + 1}] Amma: "${userMsg}"`);

    const response = await geminiAgentService.processMessage(sessionId, { type: 'text', text: userMsg });

    console.log(`\n🤖 [Turn ${i + 1}] Agent Reply:\n----------------------------------------`);
    console.log(response.reply);
    console.log(`----------------------------------------`);
    console.log(`🔧 Tool calls executed (${response.toolCallsExecuted.length}):`);
    response.toolCallsExecuted.forEach((t) => {
      console.log(`   - ${t.toolName}(${JSON.stringify(t.args)})`);
    });
  }

  console.log('\n🎉 ALL CONVERSATION TURNS COMPLETED SUCCESSFULLY!\n');
}

runConversationalTest().catch(console.error);
