import { FunctionDeclaration, Schema, SchemaType } from '@google/generative-ai';
import { swiggyMcpService, swiggyFoodMcpService } from './mcp_client';
import { profileStore } from '../profiles/store';
import { AgentProfile } from '../profiles/types';
import {
  clearPaymentSafetyState,
  consumePaymentAuthorization,
  invalidatePaymentAuthorization,
  PaymentAuthorization,
  SwiggyDomain
} from './payment_safety';

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
 * servers under the same names and are declared only once, from the Instamart connection below
 * (Gemini requires unique function names) - but each domain has its OWN cart, and these tools
 * operate on whichever cart lives on the server you actually call them through. Calling
 * get_payment_options against Instamart while the real cart is a Food cart legitimately returns
 * "no payment options" for Instamart's (empty) cart, not an error - confirmed the hard way after
 * a real food order came back with no payment options. See sessionDomain below for how execution
 * routes these to whichever domain is actually in play.
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

const ORDER_PLACING_TOOLS = ['checkout', 'place_food_order'];
const PAYMENT_AUTHORIZATION_INVALIDATING_TOOLS = [
  'update_cart',
  'clear_cart',
  'update_food_cart',
  'flush_food_cart',
  'apply_food_coupon',
  'get_payment_options'
];

/**
 * Which domain (grocery vs food) each session most recently touched - updated on every
 * domain-specific tool call, read whenever a SHARED_TOOLS call needs to know which server's cart
 * it should actually hit instead of assuming Instamart. A shared tool is refused if no
 * domain-specific cart action established this state first.
 */
const sessionDomain: Map<string, SwiggyDomain> = new Map();
const profileRuntimeFingerprint = new Map<string, string>();

function runtimeFingerprint(profile: AgentProfile): string {
  return [
    profile.updatedAt,
    profile.enabled,
    profile.capabilities.instamart,
    profile.capabilities.food,
    profile.address?.id ?? '',
    profile.address?.latitude ?? '',
    profile.address?.longitude ?? '',
    profile.swiggy.connected,
    profile.swiggy.expiresAt ?? ''
  ].join('|');
}

/** Invalidates cart/payment routing whenever dashboard or connection state changes. */
export function synchronizeSwiggyProfileRuntime(profile: AgentProfile): void {
  const fingerprint = runtimeFingerprint(profile);
  const previous = profileRuntimeFingerprint.get(profile.id);
  if (previous !== undefined && previous !== fingerprint) {
    sessionDomain.delete(profile.id);
    clearPaymentSafetyState(profile.id);
  }
  profileRuntimeFingerprint.set(profile.id, fingerprint);
}

export interface SwiggyToolExecutionContext {
  domain: SwiggyDomain | null;
}

/**
 * Params auto-filled server-side per tool, stripped from what the model sees. Covers the active
 * profile's selected delivery address, and lat/lng where a tool needs them but has no other source:
 * - track_order: despite get_orders's response promising "delivery address coordinates", they're
 *   not actually present (confirmed empirically), so lat/lng are injected from the known fixed
 *   address instead.
 * - get_payment_options / check_payment_status / confirm_order: each takes optional addressId/
 *   lat/lng fields documented as "Food only" / "REQUIRED for Food" - harmless to inject on an
 *   Instamart call, and removes a step where the model would otherwise have to correctly recall
 *   these from an earlier tool response.
 */
const AUTO_INJECTED_PARAM_NAMES_BY_TOOL: Record<string, string[]> = {
  search_products: ['addressId'],
  your_go_to_items: ['addressId'],
  update_cart: ['selectedAddressId'],
  checkout: ['addressId'],
  track_order: ['lat', 'lng'],
  // Instamart grocery orders are tagged orderType "DASH" (confirmed empirically), not
  // "INSTAMART" - despite that being the more obvious-looking example value in the tool's own
  // parameter description. Forced here so the model can't guess wrong and see zero orders.
  get_orders: ['orderType'],

  search_restaurants: ['addressId'],
  search_menu: ['addressId'],
  get_restaurant_menu: ['addressId'],
  get_food_cart: ['addressId'],
  update_food_cart: ['addressId'],
  place_food_order: ['addressId'],
  fetch_food_coupons: ['addressId'],
  apply_food_coupon: ['addressId'],
  get_food_orders: ['addressId'],

  get_payment_options: ['addressId'],
  check_payment_status: ['addressId', 'lat', 'lng'],
  confirm_order: ['addressId', 'lat', 'lng']
};

function buildAutoInjectedParams(
  toolName: string,
  profile: AgentProfile
): Record<string, any> | null {
  if (toolName === 'get_orders') return { orderType: 'DASH' };

  const names = AUTO_INJECTED_PARAM_NAMES_BY_TOOL[toolName];
  if (!names) return {};

  const address = profile.address;
  if (!address?.id) return null;

  const params: Record<string, any> = {};
  if (names.includes('addressId')) params.addressId = address.id;
  if (names.includes('selectedAddressId')) {
    params.selectedAddressId = address.id;
  }
  if (names.includes('lat') || names.includes('lng')) {
    if (
      address.latitude === null ||
      address.longitude === null ||
      !Number.isFinite(address.latitude) ||
      !Number.isFinite(address.longitude)
    ) {
      return null;
    }
    params.lat = address.latitude;
    params.lng = address.longitude;
  }
  return params;
}

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
  const injectedParamNames = AUTO_INJECTED_PARAM_NAMES_BY_TOOL[tool.name];
  if (injectedParamNames && schema.properties) {
    for (const paramName of injectedParamNames) {
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
export async function getSwiggyFunctionDeclarations(
  contextId: string
): Promise<FunctionDeclaration[]> {
  const profile = await profileStore.resolveProfile(contextId);
  if (!profile) throw new Error('No agent profile matches this WhatsApp number.');
  synchronizeSwiggyProfileRuntime(profile);

  if (cachedDeclarations) {
    return cachedDeclarations.filter((declaration) => {
      if (!profile.capabilities.food && EXPOSED_FOOD_TOOLS.includes(declaration.name)) return false;
      if (!profile.capabilities.instamart && EXPOSED_TOOLS.includes(declaration.name)) return false;
      if (
        !profile.capabilities.food &&
        !profile.capabilities.instamart &&
        SHARED_TOOLS.includes(declaration.name)
      ) return false;
      return true;
    });
  }

  const [imTools, foodTools] = await Promise.all([
    swiggyMcpService.listTools(profile.id),
    swiggyFoodMcpService.listTools(profile.id)
  ]);

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
  return declarations.filter((declaration) => {
    if (!profile.capabilities.food && EXPOSED_FOOD_TOOLS.includes(declaration.name)) return false;
    if (!profile.capabilities.instamart && EXPOSED_TOOLS.includes(declaration.name)) return false;
    if (
      !profile.capabilities.food &&
      !profile.capabilities.instamart &&
      SHARED_TOOLS.includes(declaration.name)
    ) return false;
    return true;
  });
}

/**
 * Executes a Swiggy MCP tool call on behalf of the agent, auto-injecting fixed params (address,
 * and lat/lng where needed) and routing to the correct MCP server (Instamart vs Food). Rejects
 * anything outside the declared tool set even if the model asks for it - LLMs occasionally call
 * a plausible-sounding function that was never actually declared to them (e.g. get_addresses,
 * despite the prompt explicitly saying not to), and since real tool names here are real, live
 * actions against a real account, that can't be trusted through on good faith alone.
 */
export async function executeSwiggyTool(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  paymentAuthorization?: PaymentAuthorization,
  executionContext?: SwiggyToolExecutionContext
): Promise<any> {
  const profile = await profileStore.resolveProfile(sessionId);
  if (profile) synchronizeSwiggyProfileRuntime(profile);
  if (!profile || !profile.enabled) {
    return { success: false, error: 'This WhatsApp number does not have an active agent profile.' };
  }

  const isExposedFoodTool = EXPOSED_FOOD_TOOLS.includes(toolName);
  const isExposedGroceryTool = EXPOSED_TOOLS.includes(toolName);
  const isSharedTool = SHARED_TOOLS.includes(toolName);
  const isKnownTool = isExposedFoodTool || isExposedGroceryTool || isSharedTool;

  if (!isKnownTool) {
    console.warn(`⚠️ Model attempted to call undeclared tool "${toolName}" - refused.`);
    return { success: false, error: `Tool "${toolName}" is not available.` };
  }

  if (isExposedFoodTool && !profile.capabilities.food) {
    return { success: false, error: 'Food ordering is turned off for this profile.' };
  }
  if (isExposedGroceryTool && !profile.capabilities.instamart) {
    return { success: false, error: 'Instamart ordering is turned off for this profile.' };
  }

  // Domain-specific tools set the session's active domain; shared tools read it back instead of
  // assuming Instamart. checkout/place_food_order aren't shared, so their domain is always known
  // directly from the tool name itself.
  if (isExposedFoodTool) sessionDomain.set(profile.id, 'food');
  else if (isExposedGroceryTool) sessionDomain.set(profile.id, 'instamart');
  const domain: SwiggyDomain | undefined = isSharedTool
    ? sessionDomain.get(profile.id)
    : isExposedFoodTool
      ? 'food'
      : 'instamart';

  if (!domain) {
    return {
      success: false,
      error:
        'No active Swiggy cart domain is available for this shared tool. Open the relevant Food or Instamart cart first.'
    };
  }
  if (executionContext) executionContext.domain = domain;

  if (
    (domain === 'food' && !profile.capabilities.food) ||
    (domain === 'instamart' && !profile.capabilities.instamart)
  ) {
    return {
      success: false,
      error: `${domain === 'food' ? 'Food ordering' : 'Instamart ordering'} is turned off for this profile.`
    };
  }

  if (
    !ORDER_PLACING_TOOLS.includes(toolName) &&
    PAYMENT_AUTHORIZATION_INVALIDATING_TOOLS.includes(toolName)
  ) {
    invalidatePaymentAuthorization(paymentAuthorization);
  }

  let authorizedPaymentArgs: Record<string, string> | null = null;
  if (ORDER_PLACING_TOOLS.includes(toolName)) {
    const authorizationResult = consumePaymentAuthorization(
      paymentAuthorization,
      profile.id,
      domain,
      args
    );
    if (!authorizationResult.ok) {
      console.warn(
        `⚠️ Refused ${toolName} for profile ${profile.id}: ${authorizationResult.error}`
      );
      return {
        success: false,
        error: authorizationResult.error
      };
    }
    authorizedPaymentArgs = authorizationResult.paymentArgs;
  }

  const injectedParams = buildAutoInjectedParams(toolName, profile);
  if (injectedParams === null) {
    return {
      success: false,
      error: 'No complete Swiggy delivery address is configured for this profile. Choose a saved address in the dashboard before ordering.'
    };
  }
  const finalArgs = {
    ...args,
    ...(authorizedPaymentArgs ?? {}),
    ...injectedParams
  };
  if (authorizedPaymentArgs?.paymentMethod === 'Cash') {
    delete finalArgs.intentApp;
  }
  const service = domain === 'food' ? swiggyFoodMcpService : swiggyMcpService;
  const result = await service.callTool(profile.id, toolName, finalArgs);

  if (ORDER_PLACING_TOOLS.includes(toolName) && result?.success !== false) {
    clearPaymentSafetyState(profile.id);
  }

  return result;
}
