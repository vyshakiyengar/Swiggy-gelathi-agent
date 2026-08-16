import { FunctionDeclaration, Schema, SchemaType } from '@google/generative-ai';
import { swiggyMcpService, swiggyFoodMcpService } from './mcp_client';

const DEFAULT_ADDRESS_ID = process.env.SWIGGY_DEFAULT_ADDRESS_ID || '112427323';
const DEFAULT_LAT = Number(process.env.SWIGGY_DEFAULT_LAT) || 12.907784;
const DEFAULT_LNG = Number(process.env.SWIGGY_DEFAULT_LNG) || 77.545805;

/**
 * Instamart (grocery) tools exposed to the agent, via mcp.swiggy.com/im. get_addresses is
 * intentionally excluded - this bot always delivers to one fixed family address, injected
 * automatically (see AUTO_INJECTED_PARAMS_BY_TOOL). get_delivery_status ("Internal... not for
 * conversational use" per Swiggy's own description) and report_error (bug-reporting utility)
 * aren't relevant here.
 */
const EXPOSED_TOOLS = [
  'search_products',
  'your_go_to_items',
  'get_cart',
  'update_cart',
  'clear_cart',
  'checkout',
  'get_orders',
  'track_order'
];

/**
 * Food delivery tools, via mcp.swiggy.com/food - same account, separate MCP server. Excludes
 * get_food_delivery_status (internal) and report_error, same reasoning as Instamart above.
 * get_addresses, get_payment_options, check_payment_status, and confirm_order exist on BOTH
 * servers under the same names - only fetched once from the Instamart connection below (Gemini
 * requires unique function names; the underlying payment/address service is shared regardless
 * of which MCP surface you call it through, confirmed empirically).
 */
const EXPOSED_FOOD_TOOLS = [
  'search_restaurants',
  'search_menu',
  'get_restaurant_menu',
  'get_food_cart',
  'update_food_cart',
  'flush_food_cart',
  'place_food_order',
  'fetch_food_coupons',
  'apply_food_coupon',
  'get_food_orders',
  'get_food_order_details',
  'track_food_order'
];

/**
 * Tools shared by both MCP servers under the same name - fetched once via Instamart's
 * connection, but their execution isn't Instamart-specific (see AUTO_INJECTED_PARAMS_BY_TOOL
 * for how the Food-only fields on these get filled in regardless of which domain triggered them).
 */
const SHARED_TOOLS = ['get_payment_options', 'check_payment_status', 'confirm_order'];

/**
 * Params auto-filled server-side per tool, stripped from what the model sees. Covers the fixed
 * delivery address, and lat/lng where a tool needs them but has no real way to source them:
 * - track_order: despite get_orders's response promising "delivery address coordinates", they're
 *   not actually present (confirmed empirically), so lat/lng are injected from the known fixed
 *   address instead.
 * - get_payment_options / check_payment_status / confirm_order: each takes optional addressId/
 *   lat/lng fields documented as "Food only" / "REQUIRED for Food" - harmless to inject on an
 *   Instamart call, and removes a step where the model would otherwise have to correctly recall
 *   these from an earlier tool response.
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
  get_orders: () => ({ orderType: 'DASH' }),

  search_restaurants: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  search_menu: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  get_restaurant_menu: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  get_food_cart: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  update_food_cart: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  place_food_order: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  fetch_food_coupons: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  apply_food_coupon: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  get_food_orders: () => ({ addressId: DEFAULT_ADDRESS_ID }),

  get_payment_options: () => ({ addressId: DEFAULT_ADDRESS_ID }),
  check_payment_status: () => ({ addressId: DEFAULT_ADDRESS_ID, lat: DEFAULT_LAT, lng: DEFAULT_LNG }),
  confirm_order: () => ({ addressId: DEFAULT_ADDRESS_ID, lat: DEFAULT_LAT, lng: DEFAULT_LNG })
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

function buildDeclaration(tool: { name: string; description?: string; inputSchema: any }): FunctionDeclaration {
  const schema = JSON.parse(JSON.stringify(tool.inputSchema));
  const injectedParams = AUTO_INJECTED_PARAMS_BY_TOOL[tool.name];
  if (injectedParams && schema.properties) {
    for (const paramName of Object.keys(injectedParams())) {
      delete schema.properties[paramName];
      schema.required = (schema.required || []).filter((r: string) => r !== paramName);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: convertJsonSchemaToGemini(schema) as any
  };
}

let cachedDeclarations: FunctionDeclaration[] | null = null;

/**
 * Fetches the real tool schemas from Swiggy's Instamart and Food MCP servers and converts them
 * to Gemini's function-calling format. Pulled live rather than hand-transcribed so this stays
 * correct if Swiggy changes their tools; cached in-process after the first successful fetch.
 */
export async function getSwiggyFunctionDeclarations(): Promise<FunctionDeclaration[]> {
  if (cachedDeclarations) return cachedDeclarations;

  const [imTools, foodTools] = await Promise.all([swiggyMcpService.listTools(), swiggyFoodMcpService.listTools()]);

  const declarations: FunctionDeclaration[] = [];

  for (const tool of imTools.tools) {
    if (EXPOSED_TOOLS.includes(tool.name) || SHARED_TOOLS.includes(tool.name)) {
      declarations.push(buildDeclaration(tool));
    }
  }
  for (const tool of foodTools.tools) {
    if (EXPOSED_FOOD_TOOLS.includes(tool.name)) {
      declarations.push(buildDeclaration(tool));
    }
  }

  cachedDeclarations = declarations;
  return declarations;
}

/**
 * Executes a Swiggy MCP tool call on behalf of the agent, auto-injecting fixed params (address,
 * and lat/lng where needed) and routing to the correct MCP server (Instamart vs Food). Rejects
 * anything outside the declared tool set even if the model asks for it - LLMs occasionally call
 * a plausible-sounding function that was never actually declared to them (e.g. get_addresses,
 * despite the prompt explicitly saying not to), and since real tool names here are real, live
 * actions against a real account, that can't be trusted through on good faith alone.
 */
export async function executeSwiggyTool(toolName: string, args: Record<string, any>): Promise<any> {
  const isFoodTool = EXPOSED_FOOD_TOOLS.includes(toolName);
  const isKnownTool = isFoodTool || EXPOSED_TOOLS.includes(toolName) || SHARED_TOOLS.includes(toolName);

  if (!isKnownTool) {
    console.warn(`⚠️ Model attempted to call undeclared tool "${toolName}" - refused.`);
    return { success: false, error: `Tool "${toolName}" is not available.` };
  }

  const injectedParams = AUTO_INJECTED_PARAMS_BY_TOOL[toolName];
  const finalArgs = injectedParams ? { ...args, ...injectedParams() } : args;
  const service = isFoodTool ? swiggyFoodMcpService : swiggyMcpService;
  return service.callTool(toolName, finalArgs);
}
