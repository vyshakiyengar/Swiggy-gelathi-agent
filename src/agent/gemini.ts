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

export type UserInput = { type: 'text'; text: string } | { type: 'audio'; data: Buffer; mimeType: string };

const NOT_CONFIGURED_REPLY =
  '⚠️ Sorry Amma, the grocery agent isn\'t fully set up right now. Please ask Vyshak to check the configuration.';

const UNAVAILABLE_REPLY =
  '⚠️ Sorry Amma, I\'m having trouble understanding right now. Please try again in a moment, or ask Vyshak to check.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for a Gemini free-tier rate-limit error (429), which is transient and worth a short retry. */
function isRateLimitError(error: any): boolean {
  return typeof error?.message === 'string' && /429|Too Many Requests|quota/i.test(error.message);
}

/** Parses the server-suggested retry delay (e.g. `"retryDelay":"26s"`) out of the error message, if present. */
function parseRetryDelayMs(error: any, fallbackMs: number): number {
  const match = typeof error?.message === 'string' ? error.message.match(/retryDelay":"(\d+)s"/) : null;
  const seconds = match ? parseInt(match[1], 10) : null;
  return seconds ? Math.min(seconds * 1000, 30000) : fallbackMs;
}

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

  /** Wraps model.generateContent() with a short retry on transient free-tier rate limits. */
  private async generateContentWithRetry(model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, contents: Content[]) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await model.generateContent({ contents });
      } catch (error: any) {
        if (!isRateLimitError(error) || attempt === MAX_ATTEMPTS) throw error;
        const delayMs = parseRetryDelayMs(error, 5000 * attempt);
        console.warn(`⚠️ Gemini rate limit hit (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${Math.round(delayMs / 1000)}s...`);
        await sleep(delayMs);
      }
    }
    throw new Error('unreachable');
  }

  /**
   * Main agent processing pipeline: Gemini function-calling against the real Swiggy Instamart
   * MCP tools, in Kannada, Kanglish, or English - accepts either typed text or a voice note
   * (Gemini understands audio natively, no separate transcription step needed).
   */
  public async processMessage(sessionId: string, input: UserInput): Promise<AgentResponse> {
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

      const userPart: Part =
        input.type === 'audio'
          ? { inlineData: { mimeType: input.mimeType, data: input.data.toString('base64') } }
          : { text: input.text };

      // NOTE: ChatSession.sendMessage() is unusable for tool-result turns - the SDK
      // (@google/generative-ai) hardcodes role:"function" for any functionResponse part
      // (see assignRoleToPartsAndValidateSendMessageRequest in its dist bundle), and the
      // live Gemini API now rejects that role entirely. We manage the turn contents
      // ourselves via generateContent() so function results can be sent as role:"user",
      // which is what the API actually accepts.
      const turnContents: Content[] = [...history, { role: 'user', parts: [userPart] }];

      let currentResponse = await this.generateContentWithRetry(model, turnContents);

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
        currentResponse = await this.generateContentWithRetry(model, turnContents);
      }

      const finalReplyText = currentResponse.response.text();

      // Persist a text placeholder for audio turns rather than the raw audio bytes - keeps
      // every later call in this session from re-sending the same audio as input tokens.
      history.push({
        role: 'user',
        parts: [{ text: input.type === 'audio' ? '[voice message]' : input.text }]
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
      if (isRateLimitError(error)) {
        console.error('❌ Gemini rate limit exhausted retries:', error.message);
        return {
          reply: '⚠️ Sorry Amma, I\'m a bit overloaded right now (too many requests). Please wait a minute and try again.',
          toolCallsExecuted: toolLogs
        };
      }
      console.error('❌ Gemini agent error:', error.message);
      return { reply: UNAVAILABLE_REPLY, toolCallsExecuted: toolLogs };
    }
  }
}

export const geminiAgentService = new GeminiAgentService();
