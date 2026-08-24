import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { buildAgentSystemPrompt } from './prompts';
import {
  executeSwiggyTool,
  getSwiggyFunctionDeclarations,
  SwiggyToolExecutionContext,
  synchronizeSwiggyProfileRuntime
} from '../swiggy/gemini_tools';
import { SwiggySessionExpiredError } from '../swiggy/mcp_client';
import { profileStore } from '../profiles/store';
import { AgentProfile } from '../profiles/types';
import { PaymentAuthorization, SwiggyDomain } from '../swiggy/payment_safety';
import dotenv from 'dotenv';

dotenv.config();

export interface ToolCallLog {
  toolName: string;
  args: Record<string, any>;
  result: any;
  swiggyDomain: SwiggyDomain | null;
  timestamp: string;
}

export interface AgentResponse {
  reply: string;
  toolCallsExecuted: ToolCallLog[];
}

export type UserInput = { type: 'text'; text: string } | { type: 'audio'; data: Buffer; mimeType: string };

export interface AgentTurnContext {
  /** Issued only by the server payment state machine for this exact inbound turn. */
  paymentAuthorization?: PaymentAuthorization;
}

function serviceReply(profile: AgentProfile, kind: 'not-configured' | 'unavailable' | 'expired' | 'rate-limit'): string {
  const english = {
    'not-configured': `⚠️ Sorry ${profile.displayName}, your ordering agent is not fully configured yet. Please check the household desk.`,
    unavailable: `⚠️ Sorry ${profile.displayName}, I’m having trouble right now. Please try again in a moment.`,
    expired: `⚠️ Sorry ${profile.displayName}, this profile’s Swiggy session has expired. Please reconnect it from the household desk and try again.`,
    'rate-limit': `⚠️ Sorry ${profile.displayName}, I’m a bit overloaded right now. Please wait a minute and try again.`
  }[kind];

  if (profile.language.replyMode === 'kanglish-kannada') {
    const kannada = {
      'not-configured': `⚠️ ಕ್ಷಮಿಸಿ ${profile.displayName}, ನಿಮ್ಮ ಆರ್ಡರಿಂಗ್ ಏಜೆಂಟ್ ಇನ್ನೂ ಪೂರ್ಣವಾಗಿ ಸಿದ್ಧವಾಗಿಲ್ಲ. ಹೌಸ್‌ಹೋಲ್ಡ್ ಡೆಸ್ಕ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.`,
      unavailable: `⚠️ ಕ್ಷಮಿಸಿ ${profile.displayName}, ಈಗ ಸ್ವಲ್ಪ ತೊಂದರೆ ಆಗುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
      expired: `⚠️ ಕ್ಷಮಿಸಿ ${profile.displayName}, ಈ ಪ್ರೊಫೈಲ್‌ನ Swiggy ಸೆಷನ್ ಅವಧಿ ಮುಗಿದಿದೆ. ಹೌಸ್‌ಹೋಲ್ಡ್ ಡೆಸ್ಕ್‌ನಲ್ಲಿ ಮತ್ತೆ ಕನೆಕ್ಟ್ ಮಾಡಿ.`,
      'rate-limit': `⚠️ ಕ್ಷಮಿಸಿ ${profile.displayName}, ಈಗ ಹೆಚ್ಚು ವಿನಂತಿಗಳಿವೆ. ಒಂದು ನಿಮಿಷ ಬಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`
    }[kind];
    return `${english}\n\n${kannada}`;
  }
  return english;
}

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
  public async processMessage(
    sessionId: string,
    input: UserInput,
    turnContext: AgentTurnContext = {}
  ): Promise<AgentResponse> {
    const toolLogs: ToolCallLog[] = [];
    const profile = await profileStore.resolveProfile(sessionId);
    if (!profile) {
      return {
        reply: '⚠️ This WhatsApp number does not have an agent profile yet. Add it in the household desk first.',
        toolCallsExecuted: []
      };
    }
    synchronizeSwiggyProfileRuntime(profile);
    if (!profile.enabled) {
      return {
        reply: `⏸️ ${profile.assistantName} is paused for this number. You can turn it back on from the household desk.`,
        toolCallsExecuted: []
      };
    }

    const profileSessionId = profile.id;
    const history = this.getHistory(profileSessionId);

    if (!process.env.GEMINI_API_KEY) {
      return {
        reply: serviceReply(profile, 'not-configured'),
        toolCallsExecuted: []
      };
    }

    try {
      let functionDeclarations;
      try {
        functionDeclarations = await getSwiggyFunctionDeclarations(profileSessionId);
      } catch (declError: any) {
        // This step only ever talks to Swiggy's MCP servers, so a failure here is
        // overwhelmingly an expired/invalid session, not a Gemini problem - but it was falling
        // through to the generic UNAVAILABLE_REPLY below with zero tool calls logged, giving
        // nobody (not her, not the logs) any hint that a relink was the actual fix. Route it
        // through the existing, more actionable SwiggySessionExpiredError handling instead.
        console.error('❌ Failed to fetch Swiggy tool declarations (treating as an expired/invalid session):', declError.message);
        throw new SwiggySessionExpiredError();
      }

      const model = this.genAI.getGenerativeModel({
        model: this.primaryModelName,
        systemInstruction: buildAgentSystemPrompt(profile),
        tools: [{ functionDeclarations }]
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
          const executionContext: SwiggyToolExecutionContext = { domain: null };

          const result = await executeSwiggyTool(
            profileSessionId,
            toolName,
            args,
            turnContext.paymentAuthorization,
            executionContext
          );

          toolLogs.push({
            toolName,
            args,
            result,
            swiggyDomain: executionContext.domain,
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
          reply: serviceReply(profile, 'expired'),
          toolCallsExecuted: toolLogs
        };
      }
      if (isRateLimitError(error)) {
        console.error('❌ Gemini rate limit exhausted retries:', error.message);
        return {
          reply: serviceReply(profile, 'rate-limit'),
          toolCallsExecuted: toolLogs
        };
      }
      console.error('❌ Gemini agent error:', error.message);
      return {
        reply: serviceReply(profile, 'unavailable'),
        toolCallsExecuted: toolLogs
      };
    }
  }
}

export const geminiAgentService = new GeminiAgentService();
