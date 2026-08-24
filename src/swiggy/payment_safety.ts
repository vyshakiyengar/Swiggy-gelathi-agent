import { randomBytes } from 'crypto';

export type SwiggyDomain = 'food' | 'instamart';

export type PaymentChoiceInput =
  | { kind: 'interactive'; buttonId: string }
  | { kind: 'text'; text: string }
  | { kind: 'unsupported' };

export interface PaymentOptionButton {
  id: string;
  title: string;
}

type PaymentChoice = {
  buttonId: string;
  title: string;
  instruction: string;
  paymentMethod: 'Cash' | 'UPI';
  intentApp?: string;
  textAliases: string[];
};

export type PaymentOptionsPresentation = {
  readonly profileId: string;
  readonly domain: SwiggyDomain;
  readonly buttons: PaymentOptionButton[];
};

export type PaymentAuthorization = {
  readonly profileId: string;
  readonly domain: SwiggyDomain;
  readonly paymentMethod: 'Cash' | 'UPI';
  readonly intentApp?: string;
};

export type ClaimedPaymentAuthorization = {
  authorization: PaymentAuthorization;
  instruction: string;
};

type InternalPresentation = PaymentOptionsPresentation & {
  nonce: string;
  choices: PaymentChoice[];
  deliveredAt?: number;
};

type InternalAuthorization = PaymentAuthorization & {
  consumed: boolean;
};

const KNOWN_UPI_METHODS: Array<{
  intentApp: string;
  slug: string;
  title: string;
  label: string;
  aliases: string[];
}> = [
  {
    intentApp: 'gpay://upi/',
    slug: 'gpay',
    title: '📱 Google Pay',
    label: 'Google Pay',
    aliases: ['google pay', 'gpay']
  },
  {
    intentApp: 'phonepe://',
    slug: 'phonepe',
    title: '📱 PhonePe',
    label: 'PhonePe',
    aliases: ['phonepe', 'phone pe']
  },
  {
    intentApp: 'paytmmp://',
    slug: 'paytm',
    title: '📱 Paytm',
    label: 'Paytm',
    aliases: ['paytm']
  },
  {
    intentApp: 'bhim://upi/',
    slug: 'bhim',
    title: '📱 BHIM',
    label: 'BHIM',
    aliases: ['bhim', 'bhim upi']
  },
  {
    intentApp: 'credpay://upi/',
    slug: 'cred',
    title: '📱 CRED',
    label: 'CRED',
    aliases: ['cred', 'cred pay']
  },
  {
    intentApp: 'super://',
    slug: 'supermoney',
    title: '📱 super.money',
    label: 'super.money',
    aliases: ['super money', 'supermoney', 'super.money']
  }
];

const issuedPresentations = new WeakSet<object>();
const issuedAuthorizations = new WeakSet<object>();
const deliveredPresentationByProfile = new Map<string, InternalPresentation>();
export const PAYMENT_OFFER_TTL_MS = 10 * 60 * 1000;

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function normalizedText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-IN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function expandedAliases(aliases: string[]): string[] {
  const values = new Set<string>();
  for (const alias of aliases) {
    values.add(normalizedText(alias));
    values.add(normalizedText(`pay by ${alias}`));
    values.add(normalizedText(`use ${alias}`));
  }
  return [...values];
}

function paymentData(result: unknown): Record<string, any> {
  const root = asRecord(result) ?? {};
  return asRecord(root.data) ?? root;
}

/**
 * Builds nonce-bound buttons from the real payment-options response. Merely preparing buttons
 * does not authorize anything; markPaymentOptionsDelivered() must be called after the outbound
 * message succeeds.
 */
export function preparePaymentOptionsPresentation(
  profileId: string,
  domain: SwiggyDomain,
  result: unknown
): PaymentOptionsPresentation | null {
  const data = paymentData(result);
  const mobile = asRecord(asRecord(data.platforms)?.mobile);
  const methods = Array.isArray(mobile?.methods) ? mobile.methods : [];
  const availableIntentApps = new Set(
    methods
      .map((method) => asRecord(method)?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
  const nonce = randomBytes(8).toString('hex');
  const choices: PaymentChoice[] = [];

  if (asRecord(data.cod)?.available === true) {
    choices.push({
      buttonId: `pay_${nonce}_cod`,
      title: '💵 Cash on Delivery',
      instruction: 'Pay by Cash on Delivery',
      paymentMethod: 'Cash',
      textAliases: expandedAliases(['cash', 'cash on delivery', 'cod'])
    });
  }

  for (const method of KNOWN_UPI_METHODS) {
    if (choices.length >= 3) break;
    if (!availableIntentApps.has(method.intentApp)) continue;
    choices.push({
      buttonId: `pay_${nonce}_${method.slug}`,
      title: method.title,
      instruction: `Pay by UPI using ${method.label}`,
      paymentMethod: 'UPI',
      intentApp: method.intentApp,
      textAliases: expandedAliases([
        ...method.aliases,
        `upi using ${method.label}`,
        `pay by upi using ${method.label}`
      ])
    });
  }

  if (choices.length === 0) return null;

  const presentation: InternalPresentation = {
    profileId,
    domain,
    nonce,
    choices,
    buttons: choices.map(({ buttonId, title }) => ({ id: buttonId, title }))
  };
  issuedPresentations.add(presentation);
  return presentation;
}

/** Activates an offer only after its text/buttons (or text fallback) were delivered. */
export function markPaymentOptionsDelivered(
  presentation: PaymentOptionsPresentation,
  deliveredAt = Date.now()
): boolean {
  if (!issuedPresentations.has(presentation) || !Number.isFinite(deliveredAt)) {
    return false;
  }
  const internal = presentation as InternalPresentation;
  issuedPresentations.delete(presentation);
  internal.deliveredAt = deliveredAt;
  deliveredPresentationByProfile.set(internal.profileId, internal);
  return true;
}

/**
 * Consumes the profile's most recently delivered offer on the very next inbound turn. A choice
 * must exactly match a nonce-bound button or a conservative text alias for an offered method.
 */
export function claimPaymentAuthorization(
  profileId: string,
  input: PaymentChoiceInput,
  now = Date.now()
): ClaimedPaymentAuthorization | null {
  const presentation = deliveredPresentationByProfile.get(profileId);
  if (!presentation) return null;

  // Payment offers are intentionally next-turn-only. Even an unrelated reply expires the offer.
  deliveredPresentationByProfile.delete(profileId);
  const age = now - (presentation.deliveredAt ?? Number.NaN);
  if (!Number.isFinite(age) || age < 0 || age > PAYMENT_OFFER_TTL_MS) {
    return null;
  }

  let choice: PaymentChoice | undefined;
  if (input.kind === 'interactive') {
    choice = presentation.choices.find(
      (candidate) => candidate.buttonId === input.buttonId
    );
  } else if (input.kind === 'text') {
    const normalized = normalizedText(input.text);
    choice = presentation.choices.find((candidate) =>
      candidate.textAliases.includes(normalized)
    );
  }

  if (!choice) return null;

  const authorization: InternalAuthorization = {
    profileId,
    domain: presentation.domain,
    paymentMethod: choice.paymentMethod,
    intentApp: choice.intentApp,
    consumed: false
  };
  issuedAuthorizations.add(authorization);
  return { authorization, instruction: choice.instruction };
}

export type PaymentAuthorizationResult =
  | { ok: true; paymentArgs: Record<string, string> }
  | { ok: false; error: string };

/**
 * One-use validation at the real order-tool boundary. Model arguments must match the user's
 * claimed choice; canonical server-owned values are returned for the actual MCP call.
 */
export function consumePaymentAuthorization(
  authorization: PaymentAuthorization | undefined,
  profileId: string,
  domain: SwiggyDomain,
  args: Record<string, any>
): PaymentAuthorizationResult {
  if (!authorization || !issuedAuthorizations.has(authorization)) {
    return {
      ok: false,
      error:
        'Cannot place the order: this turn does not contain a verified choice from the payment options delivered in the immediately previous message.'
    };
  }

  const internal = authorization as InternalAuthorization;
  issuedAuthorizations.delete(authorization);
  internal.consumed = true;

  if (internal.profileId !== profileId || internal.domain !== domain) {
    return {
      ok: false,
      error:
        'Cannot place the order: the verified payment choice belongs to a different profile or cart.'
    };
  }

  if (internal.paymentMethod === 'Cash') {
    if (!['Cash', 'COD'].includes(args.paymentMethod) || args.intentApp) {
      return {
        ok: false,
        error:
          'Cannot place the order: the tool call did not match the Cash on Delivery choice made by the user.'
      };
    }
    return { ok: true, paymentArgs: { paymentMethod: 'Cash' } };
  }

  if (
    args.paymentMethod !== 'UPI' ||
    typeof args.intentApp !== 'string' ||
    args.intentApp !== internal.intentApp
  ) {
    return {
      ok: false,
      error:
        'Cannot place the order: the UPI app in the tool call did not exactly match the app selected by the user.'
    };
  }

  return {
    ok: true,
    paymentArgs: { paymentMethod: 'UPI', intentApp: internal.intentApp! }
  };
}

/** Revokes an issued turn authorization when the cart/options change before checkout. */
export function invalidatePaymentAuthorization(
  authorization: PaymentAuthorization | undefined
): void {
  if (!authorization) return;
  issuedAuthorizations.delete(authorization);
  const internal = authorization as InternalAuthorization;
  internal.consumed = true;
}

/** Clears any delivered but unused payment offer for a changed/disabled profile. */
export function clearPaymentSafetyState(profileId: string): void {
  deliveredPresentationByProfile.delete(profileId);
}
