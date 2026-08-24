import { randomUUID } from 'crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from 'fs/promises';
import path from 'path';
import type {
  AgentCapabilities,
  AgentLanguageSettings,
  AgentPreferences,
  AgentProfile,
  AgentProfilePatch,
  PackSizePreference,
  ReplyMode,
  SpicePreference,
  SubstitutionPolicy,
  SwiggyDeliveryAddress,
  SwiggySession
} from './types';

const STORE_VERSION = 1;
const DEFAULT_STORE_PATH = '.agent-data/agent-profiles.json';
const ASSUMED_TOKEN_LIFETIME_MS = 5 * 24 * 60 * 60 * 1000;

const REPLY_MODES = new Set<ReplyMode>([
  'english',
  'kannada',
  'kanglish-kannada',
  'match-user'
]);
const SUBSTITUTION_POLICIES = new Set<SubstitutionPolicy>([
  'ask-first',
  'allow-similar',
  'no-substitutions'
]);
const PACK_SIZES = new Set<PackSizePreference>([
  'smallest',
  'regular',
  'value',
  'ask'
]);
const SPICE_LEVELS = new Set<SpicePreference>([
  'mild',
  'medium',
  'hot',
  'ask'
]);

interface StoredAgentProfile {
  id: string;
  displayName: string;
  whatsappNumber: string | null;
  assistantName: string;
  enabled: boolean;
  language: AgentLanguageSettings;
  capabilities: AgentCapabilities;
  address: SwiggyDeliveryAddress | null;
  preferences: AgentPreferences;
  customInstructions: string;
  swiggySession: SwiggySession | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredProfileDocument {
  version: 1;
  profiles: StoredAgentProfile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new Error(field + ' must be a string.');
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(field + ' cannot be empty.');
  }
  if (normalized.length > maxLength) {
    throw new Error(field + ' cannot exceed ' + maxLength + ' characters.');
  }
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new Error(field + ' must be a string.');
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(field + ' cannot exceed ' + maxLength + ' characters.');
  }
  return normalized;
}

/**
 * Normalizes a WhatsApp/E.164-style number to digits only. Country codes are
 * never guessed: profile setup must provide one explicitly.
 */
export function normalizeWhatsAppNumber(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('WhatsApp number must be a string.');
  }
  const trimmed = value.trim();
  if (!trimmed || !/^\+?[0-9\s().-]+$/.test(trimmed)) {
    throw new Error('WhatsApp number contains invalid characters.');
  }
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error(
      'WhatsApp number must include its country code and contain 8 to 15 digits.'
    );
  }
  return digits;
}

function optionalPhone(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(field + ' must be a string or null.');
  }
  return normalizeWhatsAppNumber(value);
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(field + ' must be a valid ISO date string.');
  }
  return new Date(value).toISOString();
}

function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return isoDate(value, field);
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(field + ' must be an array.');
  }
  if (value.length > 50) {
    throw new Error(field + ' cannot contain more than 50 entries.');
  }
  const unique = new Map<string, string>();
  for (const entry of value) {
    const normalized = requiredText(entry, field + ' entry', 100);
    const key = normalized.toLocaleLowerCase('en-IN');
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function nullableNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      field + ' must be a number between ' + minimum + ' and ' + maximum + '.'
    );
  }
  return value;
}

function languageSettings(value: unknown): AgentLanguageSettings {
  if (!isRecord(value)) throw new Error('language must be an object.');
  if (
    typeof value.replyMode !== 'string' ||
    !REPLY_MODES.has(value.replyMode as ReplyMode)
  ) {
    throw new Error('language.replyMode is invalid.');
  }
  if (typeof value.voiceReplies !== 'boolean') {
    throw new Error('language.voiceReplies must be a boolean.');
  }
  return {
    replyMode: value.replyMode as ReplyMode,
    voiceReplies: value.voiceReplies
  };
}

function capabilitySettings(value: unknown): AgentCapabilities {
  if (!isRecord(value)) throw new Error('capabilities must be an object.');
  if (typeof value.instamart !== 'boolean' || typeof value.food !== 'boolean') {
    throw new Error(
      'capabilities.instamart and capabilities.food must be booleans.'
    );
  }
  return { instamart: value.instamart, food: value.food };
}

function deliveryAddress(value: unknown): SwiggyDeliveryAddress | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error('address must be an object or null.');
  return {
    id: requiredText(value.id, 'address.id', 200),
    label: requiredText(value.label, 'address.label', 120),
    formattedAddress:
      value.formattedAddress === null || value.formattedAddress === undefined
        ? null
        : optionalText(
            value.formattedAddress,
            'address.formattedAddress',
            500
          ),
    latitude: nullableNumber(value.latitude, 'address.latitude', -90, 90),
    longitude: nullableNumber(value.longitude, 'address.longitude', -180, 180)
  };
}

function preferenceSettings(value: unknown): AgentPreferences {
  if (!isRecord(value)) throw new Error('preferences must be an object.');
  if (
    typeof value.substitutionPolicy !== 'string' ||
    !SUBSTITUTION_POLICIES.has(
      value.substitutionPolicy as SubstitutionPolicy
    )
  ) {
    throw new Error('preferences.substitutionPolicy is invalid.');
  }
  if (
    typeof value.packSize !== 'string' ||
    !PACK_SIZES.has(value.packSize as PackSizePreference)
  ) {
    throw new Error('preferences.packSize is invalid.');
  }
  if (
    typeof value.spice !== 'string' ||
    !SPICE_LEVELS.has(value.spice as SpicePreference)
  ) {
    throw new Error('preferences.spice is invalid.');
  }
  return {
    dietary: stringList(value.dietary, 'preferences.dietary'),
    preferredBrands: stringList(
      value.preferredBrands,
      'preferences.preferredBrands'
    ),
    avoidItems: stringList(value.avoidItems, 'preferences.avoidItems'),
    substitutionPolicy: value.substitutionPolicy as SubstitutionPolicy,
    packSize: value.packSize as PackSizePreference,
    spice: value.spice as SpicePreference,
    maxOrderValueInr: nullableNumber(
      value.maxOrderValueInr,
      'preferences.maxOrderValueInr',
      1,
      1_000_000
    )
  };
}

function privateSession(value: unknown): SwiggySession | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new Error('Swiggy session must be an object or null.');
  }
  return {
    accessToken: requiredText(
      value.accessToken,
      'Swiggy access token',
      20_000
    ),
    expiresAt: optionalIsoDate(value.expiresAt, 'Swiggy session expiry')
  };
}

function storedProfile(
  value: unknown,
  field = 'profile'
): StoredAgentProfile {
  if (!isRecord(value)) throw new Error(field + ' must be an object.');
  const id = requiredText(value.id, field + '.id', 64);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(
      field +
        '.id may contain only letters, numbers, underscores, and hyphens.'
    );
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error(field + '.enabled must be a boolean.');
  }
  return {
    id,
    displayName: requiredText(value.displayName, field + '.displayName', 120),
    whatsappNumber: optionalPhone(
      value.whatsappNumber,
      field + '.whatsappNumber'
    ),
    assistantName: requiredText(
      value.assistantName,
      field + '.assistantName',
      120
    ),
    enabled: value.enabled,
    language: languageSettings(value.language),
    capabilities: capabilitySettings(value.capabilities),
    address: deliveryAddress(value.address),
    preferences: preferenceSettings(value.preferences),
    customInstructions: optionalText(
      value.customInstructions,
      field + '.customInstructions',
      4_000
    ),
    swiggySession: privateSession(value.swiggySession),
    createdAt: isoDate(value.createdAt, field + '.createdAt'),
    updatedAt: isoDate(value.updatedAt, field + '.updatedAt')
  };
}

function assertUniqueProfiles(profiles: StoredAgentProfile[]): void {
  const ids = new Set<string>();
  const phoneOwners = new Map<string, string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new Error('Duplicate profile id: ' + profile.id + '.');
    }
    ids.add(profile.id);
    if (!profile.whatsappNumber) continue;
    const existingOwner = phoneOwners.get(profile.whatsappNumber);
    if (existingOwner) {
      throw new Error(
        'WhatsApp number ' +
          profile.whatsappNumber +
          ' is assigned to both ' +
          existingOwner +
          ' and ' +
          profile.id +
          '.'
      );
    }
    phoneOwners.set(profile.whatsappNumber, profile.id);
  }
}

function parseDocument(value: unknown): StoredProfileDocument {
  if (!isRecord(value) || value.version !== STORE_VERSION) {
    throw new Error('Agent profile store has an unsupported version.');
  }
  if (!Array.isArray(value.profiles)) {
    throw new Error('Agent profile store profiles must be an array.');
  }
  const profiles = value.profiles.map((profile, index) =>
    storedProfile(profile, 'profiles[' + index + ']')
  );
  assertUniqueProfiles(profiles);
  return { version: STORE_VERSION, profiles };
}

function firstEnvironmentValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function environmentNumber(
  name: string,
  minimum: number,
  maximum: number
): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(
      name + ' must be a number between ' + minimum + ' and ' + maximum + '.'
    );
  }
  return value;
}

function legacyAddress(): SwiggyDeliveryAddress | null {
  const id = process.env.SWIGGY_DEFAULT_ADDRESS_ID?.trim();
  if (!id) return null;
  return deliveryAddress({
    id,
    label: process.env.SWIGGY_DEFAULT_ADDRESS_LABEL?.trim() || 'Home',
    formattedAddress:
      process.env.SWIGGY_DEFAULT_FORMATTED_ADDRESS?.trim() || null,
    latitude: environmentNumber('SWIGGY_DEFAULT_LAT', -90, 90),
    longitude: environmentNumber('SWIGGY_DEFAULT_LNG', -180, 180)
  });
}

function legacySession(): SwiggySession | null {
  const accessToken = process.env.SWIGGY_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;

  let expiresAt: string | null = null;
  const explicitExpiry = process.env.SWIGGY_TOKEN_EXPIRES_AT?.trim();
  if (explicitExpiry) {
    expiresAt = isoDate(explicitExpiry, 'SWIGGY_TOKEN_EXPIRES_AT');
  } else {
    const issuedAt = Number(process.env.SWIGGY_TOKEN_ISSUED_AT);
    if (Number.isFinite(issuedAt) && issuedAt > 0) {
      expiresAt = new Date(issuedAt + ASSUMED_TOKEN_LIFETIME_MS).toISOString();
    }
  }
  return privateSession({ accessToken, expiresAt });
}

function seedPhone(kind: 'mother' | 'self'): string | null {
  const value =
    kind === 'mother'
      ? firstEnvironmentValue(
          'AGENT_MOTHER_WHATSAPP_NUMBER',
          'MOTHER_WHATSAPP_NUMBER',
          'WHATSAPP_MOTHER_NUMBER',
          'SUDHA_WHATSAPP_NUMBER'
        )
      : firstEnvironmentValue(
          'AGENT_SELF_WHATSAPP_NUMBER',
          'SELF_WHATSAPP_NUMBER',
          'WHATSAPP_SELF_NUMBER',
          'VYSHAK_WHATSAPP_NUMBER'
        );
  return value ? normalizeWhatsAppNumber(value) : null;
}

function seededProfiles(): StoredAgentProfile[] {
  const now = new Date().toISOString();
  const profiles: StoredAgentProfile[] = [
    {
      id: 'mother',
      displayName: 'Sudha',
      whatsappNumber: seedPhone('mother'),
      assistantName: 'Sahayaka',
      enabled: true,
      language: {
        replyMode: 'kanglish-kannada',
        voiceReplies: true
      },
      capabilities: { instamart: true, food: true },
      address: legacyAddress(),
      preferences: {
        dietary: [],
        preferredBrands: [
          'Nandini',
          'Amul',
          'iD Fresh',
          'Cothas',
          'Red Label',
          'Fortune',
          'Aashirvaad',
          'Tata Sampann',
          'MTR'
        ],
        avoidItems: [],
        substitutionPolicy: 'ask-first',
        packSize: 'smallest',
        spice: 'medium',
        maxOrderValueInr: null
      },
      customInstructions: '',
      swiggySession: legacySession(),
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'self',
      displayName: 'Vyshak',
      whatsappNumber: seedPhone('self'),
      assistantName: 'Sahayaka',
      enabled: true,
      language: { replyMode: 'english', voiceReplies: false },
      capabilities: { instamart: true, food: true },
      address: null,
      preferences: {
        dietary: [],
        preferredBrands: [],
        avoidItems: [],
        substitutionPolicy: 'ask-first',
        packSize: 'regular',
        spice: 'medium',
        maxOrderValueInr: null
      },
      customInstructions: '',
      swiggySession: null,
      createdAt: now,
      updatedAt: now
    }
  ];
  assertUniqueProfiles(profiles);
  return profiles;
}

function sessionIsUsable(session: SwiggySession | null): boolean {
  if (!session?.accessToken) return false;
  return session.expiresAt === null || Date.parse(session.expiresAt) > Date.now();
}

function publicProfile(profile: StoredAgentProfile): AgentProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    whatsappNumber: profile.whatsappNumber,
    assistantName: profile.assistantName,
    enabled: profile.enabled,
    language: { ...profile.language },
    capabilities: { ...profile.capabilities },
    address: profile.address ? { ...profile.address } : null,
    preferences: {
      ...profile.preferences,
      dietary: [...profile.preferences.dietary],
      preferredBrands: [...profile.preferences.preferredBrands],
      avoidItems: [...profile.preferences.avoidItems]
    },
    customInstructions: profile.customInstructions,
    swiggy: {
      connected: sessionIsUsable(profile.swiggySession),
      expiresAt: profile.swiggySession?.expiresAt ?? null
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

async function chmodWherePossible(
  target: string,
  mode: number
): Promise<void> {
  try {
    await chmod(target, mode);
  } catch (error) {
    if (
      !['EPERM', 'EACCES', 'ENOSYS', 'EINVAL', 'EROFS'].includes(
        errorCode(error) || ''
      )
    ) {
      throw error;
    }
  }
}

export class AgentProfileStore {
  private readonly explicitStorePath?: string;
  private profiles: StoredAgentProfile[] = [];
  private initialization: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(storePath?: string) {
    this.explicitStorePath = storePath;
  }

  private get storePath(): string {
    return path.resolve(
      process.cwd(),
      this.explicitStorePath ||
        process.env.AGENT_PROFILE_STORE_PATH ||
        DEFAULT_STORE_PATH
    );
  }

  public async initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.load();
    await this.initialization;
  }

  private async load(): Promise<void> {
    let document: StoredProfileDocument;
    let changed = false;
    try {
      const contents = await readFile(this.storePath, 'utf8');
      document = parseDocument(JSON.parse(contents) as unknown);
      await chmodWherePossible(this.storePath, 0o600);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        if (error instanceof SyntaxError) {
          throw new Error(
            'Agent profile store is not valid JSON at ' + this.storePath + '.'
          );
        }
        throw error;
      }
      document = { version: STORE_VERSION, profiles: seededProfiles() };
      changed = true;
    }

    for (const seed of seededProfiles()) {
      if (!document.profiles.some((profile) => profile.id === seed.id)) {
        document.profiles.push(seed);
        changed = true;
      }
    }
    assertUniqueProfiles(document.profiles);
    if (changed) await this.persist(document.profiles);
    this.profiles = document.profiles;
  }

  private async persist(profiles: StoredAgentProfile[]): Promise<void> {
    const directory = path.dirname(this.storePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmodWherePossible(directory, 0o700);

    const temporaryPath = path.join(
      directory,
      '.' +
        path.basename(this.storePath) +
        '.' +
        process.pid +
        '.' +
        randomUUID() +
        '.tmp'
    );
    const document: StoredProfileDocument = {
      version: STORE_VERSION,
      profiles
    };
    try {
      await writeFile(
        temporaryPath,
        JSON.stringify(document, null, 2) + '\n',
        { encoding: 'utf8', flag: 'wx', mode: 0o600 }
      );
      await chmodWherePossible(temporaryPath, 0o600);
      await rename(temporaryPath, this.storePath);
      await chmodWherePossible(this.storePath, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  private runMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(async () => {
      await this.initialize();
      return mutation();
    });
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  public async listProfiles(): Promise<AgentProfile[]> {
    await this.initialize();
    return this.profiles.map(publicProfile);
  }

  public async getProfile(id: string): Promise<AgentProfile | undefined> {
    await this.initialize();
    const profile = this.profiles.find((candidate) => candidate.id === id);
    return profile ? publicProfile(profile) : undefined;
  }

  /**
   * Resolves a runtime profile by exact id or normalized WhatsApp
   * number. Unknown and malformed numbers always fail closed; they must never
   * inherit another person's profile, credentials, cart, or ordering context.
   */
  public async resolveProfile(
    idOrPhone: string
  ): Promise<AgentProfile | undefined> {
    await this.initialize();
    const key = String(idOrPhone ?? '').trim();
    const byId = this.profiles.find((profile) => profile.id === key);
    if (byId) return publicProfile(byId);

    let phone: string | null = null;
    if (key) {
      try {
        phone = normalizeWhatsAppNumber(key);
      } catch {
        phone = null;
      }
    }
    if (phone) {
      const byPhone = this.profiles.find(
        (profile) => profile.whatsappNumber === phone
      );
      if (byPhone) {
        return publicProfile(byPhone);
      }
    }

    return undefined;
  }

  public async updateProfile(
    id: string,
    patch: AgentProfilePatch
  ): Promise<AgentProfile> {
    return this.runMutation(async () => {
      const index = this.profiles.findIndex((profile) => profile.id === id);
      if (index < 0) throw new Error('Agent profile not found: ' + id + '.');
      const current = this.profiles[index];
      const updated = storedProfile({
        ...current,
        displayName:
          patch.displayName === undefined
            ? current.displayName
            : patch.displayName,
        whatsappNumber:
          patch.whatsappNumber === undefined
            ? current.whatsappNumber
            : patch.whatsappNumber,
        assistantName:
          patch.assistantName === undefined
            ? current.assistantName
            : patch.assistantName,
        enabled:
          patch.enabled === undefined ? current.enabled : patch.enabled,
        language: { ...current.language, ...(patch.language || {}) },
        capabilities: {
          ...current.capabilities,
          ...(patch.capabilities || {})
        },
        address:
          patch.address === undefined ? current.address : patch.address,
        preferences: {
          ...current.preferences,
          ...(patch.preferences || {})
        },
        customInstructions:
          patch.customInstructions === undefined
            ? current.customInstructions
            : patch.customInstructions,
        updatedAt: new Date().toISOString()
      });
      const next = [...this.profiles];
      next[index] = updated;
      assertUniqueProfiles(next);
      await this.persist(next);
      this.profiles = next;
      return publicProfile(updated);
    });
  }

  public async getAccessToken(id: string): Promise<string | null> {
    await this.initialize();
    const session = this.profiles.find(
      (profile) => profile.id === id
    )?.swiggySession;
    return sessionIsUsable(session || null) ? session!.accessToken : null;
  }

  public async setSwiggySession(
    id: string,
    session: SwiggySession
  ): Promise<AgentProfile> {
    const normalizedSession = privateSession(session);
    if (!normalizedSession) throw new Error('Swiggy session is required.');
    return this.runMutation(async () => {
      const index = this.profiles.findIndex((profile) => profile.id === id);
      if (index < 0) throw new Error('Agent profile not found: ' + id + '.');
      const updated: StoredAgentProfile = {
        ...this.profiles[index],
        swiggySession: normalizedSession,
        updatedAt: new Date().toISOString()
      };
      const next = [...this.profiles];
      next[index] = updated;
      await this.persist(next);
      this.profiles = next;
      return publicProfile(updated);
    });
  }

  public async clearSwiggySession(id: string): Promise<AgentProfile> {
    return this.runMutation(async () => {
      const index = this.profiles.findIndex((profile) => profile.id === id);
      if (index < 0) throw new Error('Agent profile not found: ' + id + '.');
      const updated: StoredAgentProfile = {
        ...this.profiles[index],
        swiggySession: null,
        updatedAt: new Date().toISOString()
      };
      const next = [...this.profiles];
      next[index] = updated;
      await this.persist(next);
      this.profiles = next;
      return publicProfile(updated);
    });
  }
}

export const profileStore = new AgentProfileStore();
