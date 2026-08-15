import { FunctionDeclaration, Schema, SchemaType } from '@google/generative-ai';
import { swiggyMcpService } from './mcp_client';

const DEFAULT_ADDRESS_ID = process.env.SWIGGY_DEFAULT_ADDRESS_ID || '112427323';
const DEFAULT_LAT = Number(process.env.SWIGGY_DEFAULT_LAT) || 12.907784;
const DEFAULT_LNG = Number(process.env.SWIGGY_DEFAULT_LNG) || 77.545805;

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

/**
 * Params auto-filled server-side per tool, stripped from what the model sees. Covers the fixed
 * delivery address, and - for track_order - lat/lng too: despite get_orders's own description
 * promising "delivery address coordinates" in its response, they're not actually present
 * (confirmed empirically), so the model has no real way to source them for the required
 * lat/lng on track_order. Since the address is fixed anyway, its known coordinates are injected
 * the same way as the address ID.
 */
const AUTO_INJECTED_PARAMS_BY_TOOL: Record<string, () => Record<string, any>> = {
  search_products: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  your_go_to_items: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  update_cart: () => ({ selectedAddressId: DEFAULT_ADDRESS_ID }),
  checkout: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  track_order: () => ({ lat: DEFAULT_LAT, lng: DEFAULT_LNG }),
  // Instamart grocery orders are tagged orderType "DASH" (confirmed empirically), not
  // "INSTAMART" - despite that being the more obvious-looking example value in the tool's own
  // parameter description. Forced here so the model can't guess wrong and see zero orders.
  get_orders: () => ({ orderType: 'DASH' })
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
    const injectedParams = AUTO_INJECTED_PARAMS_BY_TOOL[tool.name];
    if (injectedParams && schema.properties) {
      for (const paramName of Object.keys(injectedParams())) {
        delete schema.properties[paramName];
        schema.required = (schema.required || []).filter((r: string) => r !== paramName);
      }
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

/** Executes a Swiggy MCP tool call on behalf of the agent, auto-injecting fixed params (address, and lat/lng for tracking). */
export async function executeSwiggyTool(toolName: string, args: Record<string, any>): Promise<any> {
  const injectedParams = AUTO_INJECTED_PARAMS_BY_TOOL[toolName];
  const finalArgs = injectedParams ? { ...args, ...injectedParams() } : args;
  return swiggyMcpService.callTool(toolName, finalArgs);
}
