import { createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const META_SIGNATURE_HEADER = 'x-hub-signature-256';
const LOCAL_BYPASS_ENV = 'WHATSAPP_WEBHOOK_ALLOW_UNSIGNED_LOCAL';

export type WhatsAppWebhookRequest = Request & {
  /** Exact bytes authenticated by Meta's X-Hub-Signature-256 header. */
  rawBody?: Buffer;
};

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address?.startsWith('::ffff:127.') === true
  );
}

function unsignedLocalBypassEnabled(req: Request): boolean {
  const mode = process.env.NODE_ENV;
  const hostname = req.hostname.toLowerCase();
  return (
    (mode === 'development' || mode === 'test') &&
    process.env[LOCAL_BYPASS_ENV] === 'true' &&
    isLoopbackAddress(req.socket.remoteAddress) &&
    ['localhost', '127.0.0.1', '::1'].includes(hostname)
  );
}

function signatureMatches(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  const match = /^sha256=([0-9a-f]{64})$/iu.exec(signatureHeader || '');
  if (!match) return false;

  const supplied = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Authenticates the exact raw request bytes Meta signed. This middleware must run after an
 * `express.raw({ type: 'application/json' })` parser and before JSON parsing or webhook handling.
 */
export function verifyWhatsAppWebhookSignature(
  req: WhatsAppWebhookRequest,
  res: Response,
  next: NextFunction
): void {
  if (!Buffer.isBuffer(req.body)) {
    res.status(415).json({ error: 'WhatsApp webhook must be JSON.' });
    return;
  }

  req.rawBody = Buffer.from(req.body);

  if (unsignedLocalBypassEnabled(req)) {
    next();
    return;
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    res.status(503).json({ error: 'WhatsApp webhook authentication is not configured.' });
    return;
  }

  if (
    !signatureMatches(
      req.rawBody,
      req.get(META_SIGNATURE_HEADER),
      appSecret
    )
  ) {
    res.status(401).json({ error: 'Invalid WhatsApp webhook signature.' });
    return;
  }

  next();
}

/** Parses only a body whose raw bytes have already passed signature verification. */
export function parseVerifiedWhatsAppJson(
  req: WhatsAppWebhookRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.rawBody) {
    res.status(401).json({ error: 'WhatsApp webhook signature is required.' });
    return;
  }

  try {
    req.body = JSON.parse(req.rawBody.toString('utf8')) as unknown;
    next();
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload.' });
  }
}
