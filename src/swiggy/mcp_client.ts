import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { swiggyAuthService } from './auth';

const SWIGGY_MCP_URL = 'https://mcp.swiggy.com/im';

export class SwiggySessionExpiredError extends Error {
  constructor() {
    super('Swiggy session has expired or was never linked. Ask Vyshak to tap the relink link.');
    this.name = 'SwiggySessionExpiredError';
  }
}

/**
 * Thin wrapper around the official Swiggy Instamart MCP server. Opens a fresh connection per
 * call rather than holding a persistent one - this is a low-traffic personal bot, and a fresh
 * connection sidesteps any complexity around a long-lived session outliving a token refresh.
 */
class SwiggyMcpService {
  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const token = swiggyAuthService.getAccessToken();
    if (!token) {
      throw new SwiggySessionExpiredError();
    }

    const transport = new StreamableHTTPClientTransport(new URL(SWIGGY_MCP_URL), {
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

  /** Calls a Swiggy MCP tool and returns its parsed JSON payload (all this server's tools return a single text content block of JSON). */
  public async callTool(name: string, args: Record<string, any>): Promise<any> {
    const result = await this.withClient((client) => client.callTool({ name, arguments: args }));

    if (result.isError) {
      const message = (result.content as any[])?.[0]?.text || `Swiggy tool "${name}" returned an error`;
      return { success: false, error: message };
    }

    const textBlock = (result.content as any[])?.find((c) => c.type === 'text');
    if (!textBlock) return { success: true, data: result.content };

    try {
      return JSON.parse(textBlock.text);
    } catch {
      return { success: true, data: textBlock.text };
    }
  }

  public isConfigured(): boolean {
    return swiggyAuthService.isSessionValid();
  }
}

export const swiggyMcpService = new SwiggyMcpService();
