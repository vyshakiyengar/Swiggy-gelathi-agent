import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { AGENT_SYSTEM_PROMPT } from './prompts';
import { ZeptoMcpTools } from '../mcp/zepto_server';
import { zeptoStoreService, Cart, PlacedOrder } from '../mcp/zepto_catalog';
import { WhatsAppFormatter } from '../whatsapp/formatter';
import dotenv from 'dotenv';

dotenv.config();

export interface ToolCallLog {
  toolName: string;
  args: Record<string, any>;
  result: any;
  timestamp: string;
}

export interface AgentResponse {
  reply: string;
  toolCallsExecuted: ToolCallLog[];
  orderDetails?: PlacedOrder;
}

export class GeminiAgentService {
  private genAI: GoogleGenerativeAI;
  private primaryModelName: string;
  private conversationMemory: Map<string, Content[]> = new Map();

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.primaryModelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }

  public getHistory(sessionId: string): Content[] {
    if (!this.conversationMemory.has(sessionId)) {
      this.conversationMemory.set(sessionId, []);
    }
    return this.conversationMemory.get(sessionId)!;
  }

  public clearHistory(sessionId: string): void {
    this.conversationMemory.delete(sessionId);
  }

  /**
   * Resilient Natural Language Parser for Kannada, Kanglish & English
   * Handles autonomous item extraction, quantity matching, removals, COD/UPI, and confirmations.
   */
  private async fallbackNlpEngine(sessionId: string, text: string): Promise<AgentResponse> {
    const lower = text.toLowerCase().trim();
    const toolLogs: ToolCallLog[] = [];
    let placedOrderDetails: PlacedOrder | undefined = undefined;

    // Check for Order Status / Tracking Query ("track order", "yelli ide", "where is my order", "status")
    if (/\b(track|tracking|status|yelli ide|where is|rider|delivery time)\b/i.test(lower)) {
      const orderMatch = lower.match(/\b(zp-\d{6})\b/i);
      if (orderMatch) {
        const orderId = orderMatch[1].toUpperCase();
        const trackRes = await ZeptoMcpTools.executeTool(sessionId, 'track_order', { orderId });
        toolLogs.push({
          toolName: 'track_order',
          args: { orderId },
          result: trackRes,
          timestamp: new Date().toLocaleTimeString('en-IN')
        });

        if (!trackRes.error) {
          const trackReply = trackRes.rider
            ? `📦 *Zepto Order Status:* \`${orderId}\`\n🛵 *Status:* ${trackRes.status}\n⚡ *Rider:* ${trackRes.rider?.name} (${trackRes.rider?.phone})\n⏳ *Arriving in:* ${trackRes.deliveryEtaMinutes} mins\n📍 *Live Map:* ${trackRes.trackingUrl}`
            : `📦 *Zepto Order Status:* \`${orderId}\`\n🛵 *Status:* ${trackRes.status}\n📍 *Live Map:* ${trackRes.trackingUrl}\n\nℹ️ ${trackRes.note || ''}`;
          return { reply: trackReply, toolCallsExecuted: toolLogs };
        }
      }
    }

    // Check for Coupon Application ("apply coupon ZEPTO50", "discount", "code")
    const couponMatch = lower.match(/\b(zepto50|amma50|freeship)\b/i);
    if (couponMatch) {
      const code = couponMatch[1].toUpperCase();
      const couponRes = await ZeptoMcpTools.executeTool(sessionId, 'apply_coupon', { code });
      toolLogs.push({
        toolName: 'apply_coupon',
        args: { code },
        result: couponRes,
        timestamp: new Date().toLocaleTimeString('en-IN')
      });

      const cart = zeptoStoreService.getOrCreateCart(sessionId);
      const summary = WhatsAppFormatter.formatCartSummary(cart, 'Amma');
      return {
        reply: `🎉 ${couponRes.message}\n\n${summary}`,
        toolCallsExecuted: toolLogs
      };
    }

    // Check for Clear Cart ("clear cart", "empty cart", "yenu beda")
    if (/\b(clear cart|empty cart|reset cart|yenu beda|delete all)\b/i.test(lower)) {
      zeptoStoreService.clearCart(sessionId);
      return {
        reply: '🛒 Amma, I have cleared your Zepto cart. (ನಿಮ್ಮ ಕಾರ್ಟ್ ಖಾಲಿಯಾಗಿದೆ). Let me know what you need!',
        toolCallsExecuted: []
      };
    }

    // Check for View Cart / Bill Query ("view cart", "show cart", "esthu aithu", "bill", "total")
    if (/\b(view cart|show cart|cart|bill|esthu aithu|total|how much)\b/i.test(lower) && !/\b(halu|milk|bread|motte|eggs|curd|mosaru|rice|akki|butter|benne|oil|atta|tomato|onion)\b/i.test(lower)) {
      const cart = zeptoStoreService.getOrCreateCart(sessionId);
      if (cart.items.length === 0) {
        return {
          reply: 'Namaskara Amma! Your cart is currently empty. What groceries should I add from Zepto? (ಹಾಲು, ಮೊಸರು, ತತ್ತಿ/ಮೊಟ್ಟೆ, ಈರುಳ್ಳಿ, ಟೊಮ್ಯಾಟೊ...)',
          toolCallsExecuted: []
        };
      }
      const summary = WhatsAppFormatter.formatCartSummary(cart, 'Amma');
      return {
        reply: `🛒 *Your Zepto Cart:*\n\n${summary}\n\n👉 *Reply "Yes" or "Order maadi" to confirm delivery!*`,
        toolCallsExecuted: []
      };
    }

    // Check for Cash on Delivery (COD) vs UPI preference
    const isCod = /\b(cod|cash|cash on delivery|doorstep|kaiyalli|dundu|pay on delivery)\b/i.test(lower);
    const isOrderConfirmation =
      isCod ||
      (/\b(order maadi|theek ide|theek|confirm|yes|haan|place order|order|kalsi|bega kalsi|proceed|upi|gpay|phonepe|whatsapp pay|pay)\b/i.test(
        lower
      ) &&
        !/\b(halu|milk|bread|motte|eggs|curd|mosaru|rice|akki|butter|benne|oil|atta|tomato|onion|dal)\b/i.test(lower));

    if (isOrderConfirmation) {
      const cart = zeptoStoreService.getOrCreateCart(sessionId);
      if (cart.items.length === 0) {
        return {
          reply:
            'Namaskara Amma! Your cart is currently empty. What groceries should I add from Zepto? (ಹಾಲು, ಮೊಸರು, ತತ್ತಿ/ಮೊಟ್ಟೆ, ತರಕಾರಿ...)',
          toolCallsExecuted: []
        };
      }

      const paymentMode: 'UPI_ONLINE' | 'CASH_ON_DELIVERY' = isCod ? 'CASH_ON_DELIVERY' : 'UPI_ONLINE';

      // Execute place_order tool
      const placeResult = await ZeptoMcpTools.executeTool(sessionId, 'place_order', {
        paymentMode
      });

      toolLogs.push({
        toolName: 'place_order',
        args: { paymentMode },
        result: placeResult,
        timestamp: new Date().toLocaleTimeString('en-IN')
      });

      if (placeResult.status === 'ORDER_PLACED_SUCCESSFULLY') {
        placedOrderDetails = placeResult.orderDetails;
        const confirmationReply = WhatsAppFormatter.formatOrderPlaced(placedOrderDetails);
        return {
          reply: confirmationReply,
          toolCallsExecuted: toolLogs,
          orderDetails: placedOrderDetails
        };
      }

      return {
        reply: `❌ Sorry Amma, I couldn't place the order: ${placeResult.error || 'unknown error'}. Please try again in a bit, or ask Vyshak to check.`,
        toolCallsExecuted: toolLogs
      };
    }

    // Check for Item Removal / Modification ("bedi", "remove", "thegedubidi", "bedave beda")
    if (/\b(bedi|remove|thegedubidi|bedave beda|delete|dont want)\b/i.test(lower)) {
      const currentCart = zeptoStoreService.getOrCreateCart(sessionId);

      for (const item of currentCart.items) {
        const itemKeywords = [
          item.product.name.toLowerCase(),
          ...item.product.kannadaAliases.map((a) => a.toLowerCase())
        ];

        if (itemKeywords.some((kw) => lower.includes(kw))) {
          await ZeptoMcpTools.executeTool(sessionId, 'remove_from_cart', {
            productId: item.product.id
          });
          toolLogs.push({
            toolName: 'remove_from_cart',
            args: { productId: item.product.id },
            result: { status: 'SUCCESS' },
            timestamp: new Date().toLocaleTimeString('en-IN')
          });
        }
      }

      // Handle any new additions in the same sentence (e.g. "Bread bedi, 2 packet halu maadi")
      await this.extractAndAddGroceryItems(sessionId, text, toolLogs);

      const updatedCart = zeptoStoreService.getOrCreateCart(sessionId);
      const reply = WhatsAppFormatter.formatCartSummary(updatedCart, 'Amma');
      return {
        reply: `Namaskara Amma! Updated your Zepto cart:\n\n${reply}`,
        toolCallsExecuted: toolLogs
      };
    }

    // Normal Grocery Item Extraction & Search
    await this.extractAndAddGroceryItems(sessionId, text, toolLogs);

    const currentCart = zeptoStoreService.getOrCreateCart(sessionId);
    const summary = WhatsAppFormatter.formatCartSummary(currentCart, 'Amma');

    const reply = `ನಮಸ್ಕಾರ ಅಮ್ಮ! (Namaskara Amma!)\nI have updated your Zepto grocery cart:\n\n${summary}`;

    return {
      reply,
      toolCallsExecuted: toolLogs,
      orderDetails: placedOrderDetails
    };
  }

  private async extractAndAddGroceryItems(
    sessionId: string,
    text: string,
    toolLogs: ToolCallLog[]
  ) {
    const chunks = text.split(/,|\band\b|\bmathe\b|\bhaagu\b|\+/i);

    for (const rawChunk of chunks) {
      const chunk = rawChunk.trim();
      if (!chunk) continue;

      let qty = 1;
      const numMatch = chunk.match(/\b(\d+)\b/);
      if (numMatch) {
        qty = parseInt(numMatch[1], 10);
      } else if (/\b(ondu|onne|one)\b/i.test(chunk)) qty = 1;
      else if (/\b(eradu|two)\b/i.test(chunk)) qty = 2;
      else if (/\b(muru|three)\b/i.test(chunk)) qty = 3;
      else if (/\b(nalku|four)\b/i.test(chunk)) qty = 4;
      else if (/\b(aidu|five)\b/i.test(chunk)) qty = 5;
      else if (/\b(aaru|six)\b/i.test(chunk)) qty = 6;

      // Strip numbers and units from query to find the cleanest product match
      const cleanSearchTerm = chunk
        .replace(/\b(\d+|ondu|onne|one|eradu|two|muru|three|nalku|four|aidu|five|aaru|six)\b/gi, '')
        .replace(/\b(packet|packets|pkt|box|bottle|can|cans|kg|g|gm|grams|litre|l|beku|kodi|thanni|haaki)\b/gi, '')
        .trim();

      const queryToUse = cleanSearchTerm.length > 0 ? cleanSearchTerm : chunk;

      const searchRes = await ZeptoMcpTools.executeTool(sessionId, 'search_zepto_products', {
        query: queryToUse
      });

      toolLogs.push({
        toolName: 'search_zepto_products',
        args: { query: queryToUse },
        result: searchRes,
        timestamp: new Date().toLocaleTimeString('en-IN')
      });

      if (searchRes.products && searchRes.products.length > 0) {
        const bestProduct = searchRes.products[0];
        const addRes = await ZeptoMcpTools.executeTool(sessionId, 'add_to_cart', {
          productId: bestProduct.id,
          quantity: qty
        });

        toolLogs.push({
          toolName: 'add_to_cart',
          args: { productId: bestProduct.id, quantity: qty },
          result: addRes,
          timestamp: new Date().toLocaleTimeString('en-IN')
        });
      }
    }
  }

  /**
   * Main Agent processing pipeline
   */
  public async processMessage(sessionId: string, userMessage: string): Promise<AgentResponse> {
    const history = this.getHistory(sessionId);
    const toolLogs: ToolCallLog[] = [];
    let placedOrderDetails: PlacedOrder | undefined = undefined;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return this.fallbackNlpEngine(sessionId, userMessage);
    }

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.primaryModelName,
        systemInstruction: AGENT_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: ZeptoMcpTools.declarations }]
      });

      history.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      const chat = model.startChat({
        history: history.slice(0, -1)
      });

      let currentResponse = await chat.sendMessage(userMessage);

      let iterations = 0;
      const MAX_ITERATIONS = 6;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        const functionCalls = currentResponse.response.functionCalls();

        if (!functionCalls || functionCalls.length === 0) {
          break;
        }

        const functionResponseParts: Part[] = [];

        for (const call of functionCalls) {
          const toolName = call.name;
          const args = call.args as Record<string, any>;

          const result = await ZeptoMcpTools.executeTool(sessionId, toolName, args);

          if (toolName === 'place_order' && result.status === 'ORDER_PLACED_SUCCESSFULLY') {
            placedOrderDetails = result.orderDetails;
          }

          toolLogs.push({
            toolName,
            args,
            result,
            timestamp: new Date().toLocaleTimeString('en-IN')
          });

          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: result
            }
          });
        }

        currentResponse = await chat.sendMessage(functionResponseParts);
      }

      const finalReplyText = currentResponse.response.text();

      history.push({
        role: 'model',
        parts: [{ text: finalReplyText }]
      });

      return {
        reply: finalReplyText,
        toolCallsExecuted: toolLogs,
        orderDetails: placedOrderDetails
      };
    } catch (error: any) {
      console.warn('⚠️ Gemini API error, falling back to local NLP engine:', error.message);
      return this.fallbackNlpEngine(sessionId, userMessage);
    }
  }
}

export const geminiAgentService = new GeminiAgentService();
