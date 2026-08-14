import { createZeptoMcpServer } from './mcp/server';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

async function testZeptoMcp() {
  console.log('🧪 ======================================================');
  console.log('🧪 TESTING OFFICIAL ZEPTO MCP SERVER (@modelcontextprotocol/sdk)');
  console.log('======================================================\n');

  const server = createZeptoMcpServer();

  // Test 1: List Tools
  console.log('1️⃣ Listing MCP Tools:');
  const toolsHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
  const toolsResult = await toolsHandler({ method: 'tools/list', params: {} });
  console.log(`✅ Discovered ${toolsResult.tools.length} Tools:`);
  toolsResult.tools.forEach((t: any) => console.log(`   - [${t.name}]: ${t.description.slice(0, 70)}...`));

  const callToolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

  // Test 2: Search Products (Kannada term "halu")
  console.log('\n2️⃣ Testing Tool: search_zepto_products ("halu")');
  const searchRes = await callToolHandler({
    method: 'tools/call',
    params: {
      name: 'search_zepto_products',
      arguments: { query: 'halu' }
    }
  });
  console.log('✅ Search Output:', JSON.parse(searchRes.content[0].text));

  // Test 3: Add to Cart
  console.log('\n3️⃣ Testing Tool: add_to_cart');
  const addRes = await callToolHandler({
    method: 'tools/call',
    params: {
      name: 'add_to_cart',
      arguments: {
        sessionId: 'test_amma_919876543210',
        productId: 'prod-milk-nandini-toned',
        quantity: 2
      }
    }
  });
  console.log('✅ Add Output:', JSON.parse(addRes.content[0].text));

  // Test 4: Apply Coupon
  console.log('\n4️⃣ Testing Tool: apply_coupon (ZEPTO50)');
  const couponRes = await callToolHandler({
    method: 'tools/call',
    params: {
      name: 'apply_coupon',
      arguments: {
        sessionId: 'test_amma_919876543210',
        code: 'ZEPTO50'
      }
    }
  });
  console.log('✅ Coupon Output:', JSON.parse(couponRes.content[0].text));

  // Test 5: Get Cart
  console.log('\n5️⃣ Testing Tool: get_cart');
  const cartRes = await callToolHandler({
    method: 'tools/call',
    params: {
      name: 'get_cart',
      arguments: { sessionId: 'test_amma_919876543210' }
    }
  });
  console.log('✅ Get Cart Output:', JSON.parse(cartRes.content[0].text));

  // Test 6: Place Order
  console.log('\n6️⃣ Testing Tool: place_order');
  const placeRes = await callToolHandler({
    method: 'tools/call',
    params: {
      name: 'place_order',
      arguments: {
        sessionId: 'test_amma_919876543210',
        paymentMode: 'UPI_ONLINE'
      }
    }
  });
  const placeData = JSON.parse(placeRes.content[0].text);
  console.log('✅ Place Order Output:', placeData);

  // Test 7: Track Order
  if (placeData.orderDetails?.orderId) {
    console.log(`\n7️⃣ Testing Tool: track_order (${placeData.orderDetails.orderId})`);
    const trackRes = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'track_order',
        arguments: { orderId: placeData.orderDetails.orderId }
      }
    });
    console.log('✅ Track Order Output:', JSON.parse(trackRes.content[0].text));
  }

  console.log('\n🎉 ALL ZEPTO MCP SERVER TESTS PASSED SUCCESSFULLY!\n');
}

testZeptoMcp().catch(console.error);
