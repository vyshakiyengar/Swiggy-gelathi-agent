export type ReplyMode =
  | 'english'
  | 'kannada'
  | 'kanglish-kannada'
  | 'match-user';

export type SubstitutionPolicy =
  | 'ask-first'
  | 'allow-similar'
  | 'no-substitutions';

export type PackSizePreference = 'smallest' | 'regular' | 'value' | 'ask';

export type SpicePreference = 'mild' | 'medium' | 'hot' | 'ask';

export interface AgentLanguageSettings {
  replyMode: ReplyMode;
  voiceReplies: boolean;
}

export interface AgentCapabilities {
  instamart: boolean;
  food: boolean;
}

/** A saved Swiggy address selected by the profile owner. */
export interface SwiggyDeliveryAddress {
  id: string;
  label: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface AgentPreferences {
  dietary: string[];
  preferredBrands: string[];
  avoidItems: string[];
  substitutionPolicy: SubstitutionPolicy;
  packSize: PackSizePreference;
  spice: SpicePreference;
  maxOrderValueInr: number | null;
}

export interface SwiggyConnectionSummary {
  /** True only while a non-expired access token is available. */
  connected: boolean;
  expiresAt: string | null;
}

/**
 * Safe to return from an API. Swiggy credentials deliberately do not appear in
 * this type; callers that execute MCP tools must request the token separately.
 */
export interface AgentProfile {
  readonly id: string;
  displayName: string;
  whatsappNumber: string | null;
  assistantName: string;
  enabled: boolean;
  language: AgentLanguageSettings;
  capabilities: AgentCapabilities;
  address: SwiggyDeliveryAddress | null;
  preferences: AgentPreferences;
  customInstructions: string;
  readonly swiggy: SwiggyConnectionSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Editable profile fields. IDs, connection summaries, and timestamps are server-owned. */
export interface AgentProfilePatch {
  displayName?: string;
  whatsappNumber?: string | null;
  assistantName?: string;
  enabled?: boolean;
  language?: Partial<AgentLanguageSettings>;
  capabilities?: Partial<AgentCapabilities>;
  address?: SwiggyDeliveryAddress | null;
  preferences?: Partial<AgentPreferences>;
  customInstructions?: string;
}

/** Private credential material. Never embed this object in an AgentProfile response. */
export interface SwiggySession {
  accessToken: string;
  expiresAt: string | null;
}
