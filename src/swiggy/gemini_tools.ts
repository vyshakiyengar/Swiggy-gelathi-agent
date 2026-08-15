import { FunctionDeclaration, Schema, SchemaType } from '@google/generative-ai';
import { swiggyMcpService } from './mcp_client';

const DEFAULT_ADDRESS_ID = process.env.SWIGGY_DEFAULT_ADDRESS_ID || '112427323';

/**
 * Tools exposed to the conversational agent. get_addresses is intentionally excluded - this
 * bot always delivers to one fixed family address, injected automatically (see
 * ADDRESS_PARAM_BY_TOOL). get_delivery_status ("Internal... not for conversational use" per
 * Swiggy's own description) and report_error (bug-reporting utility) aren't relevant here.
 */
const EXPOSED_TOOLS = [
  'search_products',
  'your_go_to_items',
  'get_cart',
  'update_cart',
  'clear_cart',
  'checkout',
  'get_orders',
  'track_order',
  'get_payment_options',
  'check_payment_status',
  'confirm_order'
];

/** Which parameter on each tool is the delivery address - stripped from what the model sees, and auto-filled server-side. */
const ADDRESS_PARAM_BY_TOOL: Record<string, string> = {
  search_products: 'addressId',
  your_go_to_items: 'addressId',
  update_cart: 'selectedAddressId',
  checkout: 'addressId'
};

function convertJsonSchemaToGemini(schema: any): Schema {
  const result: Schema = {};

  if (schema.type === 'object') {
    result.type = SchemaType.OBJECT;
    result.properties = {};
    for (const [key, value] of Object.entries<any>(schema.properties || {})) {
      result.properties[key] = convertJsonSchemaToGemini(value);
    }
    if (schema.required?.length) result.required = schema.required;
  } else if (schema.type === 'array') {
    result.type = SchemaType.ARRAY;
    result.items = convertJsonSchemaToGemini(schema.items || { type: 'string' });
  } else if (schema.type === 'number') {
    result.type = SchemaType.NUMBER;
  } else if (schema.type === 'boolean') {
    result.type = SchemaType.BOOLEAN;
  } else {
    result.type = SchemaType.STRING;
  }

  if (schema.description) result.description = schema.description;
  return result;
}

let cachedDeclarations: FunctionDeclaration[] | null = null;

/**
 * Fetches the real tool schemas from Swiggy's Instamart MCP server and converts them to
 * Gemini's function-calling format. Pulled live rather than hand-transcribed so this stays
 * correct if Swiggy changes their tools; cached in-process after the first successful fetch.
 */
export async function getSwiggyFunctionDeclarations(): Promise<FunctionDeclaration[]> {
  if (cachedDeclarations) return cachedDeclarations;

  const { tools } = await swiggyMcpService.listTools();
  const declarations: FunctionDeclaration[] = [];

  for (const tool of tools) {
    if (!EXPOSED_TOOLS.includes(tool.name)) continue;

    const schema = JSON.parse(JSON.stringify(tool.inputSchema));
    const addressParam = ADDRESS_PARAM_BY_TOOL[tool.name];
    if (addressParam && schema.properties) {
      delete schema.properties[addressParam];
      schema.required = (schema.required || []).filter((r: string) => r !== addressParam);
    }

    declarations.push({
      name: tool.name,
      description: tool.description,
      parameters: convertJsonSchemaToGemini(schema) as any
    });
  }

  cachedDeclarations = declarations;
  return declarations;
}

/** Executes a Swiggy MCP tool call on behalf of the agent, auto-injecting the fixed family delivery address. */
export async function executeSwiggyTool(toolName: string, args: Record<string, any>): Promise<any> {
  const addressParam = ADDRESS_PARAM_BY_TOOL[toolName];
  const finalArgs = addressParam ? { ...args, [addressParam]: DEFAULT_ADDRESS_ID } : args;
  return swiggyMcpService.callTool(toolName, finalArgs);
}
