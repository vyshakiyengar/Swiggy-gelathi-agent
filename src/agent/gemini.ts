import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { AGENT_SYSTEM_PROMPT } from './prompts';
import { getSwiggyFunctionDeclarations, executeSwiggyTool } from '../swiggy/gemini_tools';
import { SwiggySessionExpiredError } from '../swiggy/mcp_client';
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
}

const NOT_CONFIGURED_REPLY =
  '⚠️ Sorry Amma, the grocery agent isn\'t fully set up right now. Please ask Vyshak to check the configuration.';

const UNAVAILABLE_REPLY =
  '⚠️ Sorry Amma, I\'m having trouble understanding right now. Please try again in a moment, or ask Vyshak to check.';

export class GeminiAgentService {
  private genAI: GoogleGenerativeAI;
  private primaryModelName: string;
  private conversationMemory: Map<string, Content[]> = new Map();

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.primaryModelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
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
   * Main agent processing pipeline: Gemini function-calling against the real Swiggy Instamart
   * MCP tools, in Kannada, Kanglish, or English.
   */
  public async processMessage(sessionId: string, userMessage: string): Promise<AgentResponse> {
    const history = this.getHistory(sessionId);
    const toolLogs: ToolCallLog[] = [];

    if (!process.env.GEMINI_API_KEY) {
      return { reply: NOT_CONFIGURED_REPLY, toolCallsExecuted: [] };
    }

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.primaryModelName,
        systemInstruction: AGENT_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: await getSwiggyFunctionDeclarations() }]
      });

      // NOTE: ChatSession.sendMessage() is unusable for tool-result turns - the SDK
      // (@google/generative-ai) hardcodes role:"function" for any functionResponse part
      // (see assignRoleToPartsAndValidateSendMessageRequest in its dist bundle), and the
      // live Gemini API now rejects that role entirely. We manage the turn contents
      // ourselves via generateContent() so function results can be sent as role:"user",
      // which is what the API actually accepts.
      const turnContents: Content[] = [...history, { role: 'user', parts: [{ text: userMessage }] }];

      let currentResponse = await model.generateContent({ contents: turnContents });

      let iterations = 0;
      const MAX_ITERATIONS = 6;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        const functionCalls = currentResponse.response.functionCalls();

        if (!functionCalls || functionCalls.length === 0) {
          break;
        }

        const modelContent = currentResponse.response.candidates?.[0]?.content;
        if (modelContent) {
          turnContents.push({ role: 'model', parts: modelContent.parts });
        }

        const functionResponseParts: Part[] = [];

        for (const call of functionCalls) {
          const toolName = call.name;
          const args = call.args as Record<string, any>;

          const result = await executeSwiggyTool(toolName, args);

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

        turnContents.push({ role: 'user', parts: functionResponseParts });
        currentResponse = await model.generateContent({ contents: turnContents });
      }

      const finalReplyText = currentResponse.response.text();

      history.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });
      history.push({
        role: 'model',
        parts: [{ text: finalReplyText }]
      });

      return {
        reply: finalReplyText,
        toolCallsExecuted: toolLogs
      };
    } catch (error: any) {
      if (error instanceof SwiggySessionExpiredError) {
        console.warn('⚠️ Swiggy session expired mid-conversation.');
        return {
          reply: '⚠️ Sorry Amma, the grocery ordering session has expired. Please ask Vyshak to relink it (he gets a WhatsApp reminder automatically) and try again in a bit.',
          toolCallsExecuted: toolLogs
        };
      }
      console.error('❌ Gemini agent error:', error.message);
      return { reply: UNAVAILABLE_REPLY, toolCallsExecuted: toolLogs };
    }
  }
}

export const geminiAgentService = new GeminiAgentService();
