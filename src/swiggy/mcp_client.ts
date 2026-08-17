import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { swiggyAuthService } from './auth';

export class SwiggySessionExpiredError extends Error {
  constructor() {
    super('Swiggy session has expired or was never linked. Ask Vyshak to tap the relink link.');
    this.name = 'SwiggySessionExpiredError';
  }
}

/**
 * Thin wrapper around a Swiggy MCP server (Instamart or Food - same auth session works for
 * both, confirmed empirically). Opens a fresh connection per call rather than holding a
 * persistent one - this is a low-traffic personal bot, and a fresh connection sidesteps any
 * complexity around a long-lived session outliving a token refresh.
 */
class SwiggyMcpService {
  constructor(private readonly baseUrl: string) {}

  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const token = swiggyAuthService.getAccessToken();
    if (!token) {
      throw new SwiggySessionExpiredError();
    }

    const transport = new StreamableHTTPClientTransport(new URL(this.baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    });
    const client = new Client({ name: 'swiggy-instamart-whatsapp-bot', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    try {
      return await fn(client);
    } finally {
      await client.close().catch(() => {});
    }
  }

  public async listTools() {
    return this.withClient((client) => client.listTools());
  }

  /**
   * Calls a Swiggy MCP tool and returns its parsed JSON payload. Most tools return a single text
   * content block of JSON, but some (confirmed on get_payment_options via the Food server) return
   * TWO text blocks - a human-readable summary first, then the real structured JSON second
   * (presumably meant to pair with a rich UI widget on official clients, which we don't render).
   * Taking content[0] unconditionally silently fed the model a plain-text blob instead of the
   * real data on those tools - it read the summary as "success" but had no platforms/cod/
   * allMethods fields to work with, and reasonably concluded no payment options existed. Now
   * tries every text block and uses the first one that actually parses as JSON.
   */
  public async callTool(name: string, args: Record<string, any>): Promise<any> {
    const result = await this.withClient((client) => client.callTool({ name, arguments: args }));

    if (result.isError) {
      const message = (result.content as any[])?.[0]?.text || `Swiggy tool "${name}" returned an error`;
      return { success: false, error: message };
    }

    const textBlocks = ((result.content as any[]) || []).filter((c) => c.type === 'text');
    if (textBlocks.length === 0) return { success: true, data: result.content };

    for (const block of textBlocks) {
      try {
        return JSON.parse(block.text);
      } catch {
        continue;
      }
    }

    // No block was valid JSON - fall back to the first block as a plain-text summary.
    return { success: true, data: textBlocks[0].text };
  }

  public isConfigured(): boolean {
    return swiggyAuthService.isSessionValid();
  }
}

export const swiggyMcpService = new SwiggyMcpService('https://mcp.swiggy.com/im');
export const swiggyFoodMcpService = new SwiggyMcpService('https://mcp.swiggy.com/food');
