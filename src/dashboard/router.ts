import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { geminiAgentService } from '../agent/gemini';
import { profileStore } from '../profiles/store';
import { swiggyAuthService } from '../swiggy/auth';
import { swiggyMcpService } from '../swiggy/mcp_client';
import { whatsAppCloudApiService } from '../whatsapp/cloud_api';
import {
  getSessionState,
  login,
  logout,
  requireAuth
} from './auth';

type CheckStatus = 'ready' | 'warning' | 'blocked';

type DiagnosticCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
  action?: { id: string; label: string };
};

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function normalizePhone(value: string | null): string {
  return (value || '').replace(/\D/g, '');
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function firstString(...values: unknown[]): string {
  return (
    values.find((value) => typeof value === 'string' && value.trim().length > 0) as
      | string
      | undefined
  )?.trim() ?? '';
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function rawAddressList(payload: unknown): Record<string, any>[] {
  if (Array.isArray(payload)) {
    return payload
      .map(asRecord)
      .filter((item): item is Record<string, any> => Boolean(item));
  }
  const root = asRecord(payload);
  if (!root) return [];

  const data = asRecord(root.data);
  const candidates = [
    root.addresses,
    root.savedAddresses,
    data?.addresses,
    data?.savedAddresses,
    Array.isArray(root.data) ? root.data : undefined
  ];
  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  return (list ?? []).map(asRecord).filter((item): item is Record<string, any> => Boolean(item));
}

function normalizeAddresses(payload: unknown) {
  return rawAddressList(payload)
    .map((address) => {
      const location = asRecord(address.location);
      const id = firstString(
        address.addressId,
        address.id,
        address.address_id,
        address.selectedAddressId
      );
      if (!id) return null;

      const parts = [
        address.flatNo,
        address.houseNumber,
        address.addressLine1,
        address.addressLine2,
        address.landmark,
        address.area,
        address.city
      ].filter((part) => typeof part === 'string' && part.trim().length > 0);

      return {
        id,
        label:
          firstString(address.label, address.tag, address.annotation, address.name) ||
          'Saved address',
        formattedAddress:
          firstString(
            address.formattedAddress,
            address.displayAddress,
            address.address,
            address.fullAddress
          ) || parts.join(', ') || null,
        latitude: firstFiniteNumber(
          address.lat,
          address.latitude,
          location?.lat,
          location?.latitude
        ),
        longitude: firstFiniteNumber(
          address.lng,
          address.lon,
          address.longitude,
          location?.lng,
          location?.lon,
          location?.longitude
        )
      };
    })
    .filter((address): address is NonNullable<typeof address> => Boolean(address));
}

async function buildDiagnostics(
  profileId: string,
  live: boolean
): Promise<{
  status: 'ready' | 'needs-attention' | 'blocked';
  readiness: number;
  checkedAt: string;
  checks: DiagnosticCheck[];
}> {
  const profile = await profileStore.getProfile(profileId);
  if (!profile) throw new Error('Agent profile not found.');

  const checks: DiagnosticCheck[] = [];
  const phoneReady = normalizePhone(profile.whatsappNumber).length >= 8;
  checks.push({
    id: 'whatsapp-number',
    label: 'WhatsApp number',
    status: phoneReady ? 'ready' : 'blocked',
    summary: phoneReady
      ? 'Incoming messages route to this profile.'
      : 'Add the WhatsApp number that should use this agent.',
    action: phoneReady
      ? undefined
      : { id: 'person', label: 'Add WhatsApp number' }
  });

  const whatsappStatus = whatsAppCloudApiService.getStatus();
  checks.push({
    id: 'whatsapp-api',
    label: 'WhatsApp channel',
    status: whatsappStatus.configured ? 'ready' : 'blocked',
    summary: whatsappStatus.configured
      ? 'Meta Cloud API credentials are configured.'
      : 'Meta Cloud API credentials are missing.',
  });

  checks.push({
    id: 'gemini',
    label: 'Gemini agent',
    status: process.env.GEMINI_API_KEY ? 'ready' : 'blocked',
    summary: process.env.GEMINI_API_KEY
      ? 'The language model is configured.'
      : 'GEMINI_API_KEY is missing.',
  });

  const swiggyStatus = await swiggyAuthService.getSessionStatus(profile.id);
  let swiggyCheck: DiagnosticCheck = {
    id: 'swiggy',
    label: 'Swiggy account',
    status: swiggyStatus.valid ? 'ready' : 'blocked',
    summary: swiggyStatus.valid
      ? swiggyStatus.expiresAt
        ? `Linked until ${new Date(swiggyStatus.expiresAt).toLocaleString('en-IN')}.`
        : 'Swiggy is linked.'
      : 'Connect or reconnect this profile’s Swiggy account.',
    action: swiggyStatus.valid
      ? undefined
      : { id: 'connect-swiggy', label: 'Connect Swiggy' }
  };

  if (live && swiggyStatus.valid) {
    try {
      await swiggyMcpService.listTools(profile.id);
      swiggyCheck = {
        ...swiggyCheck,
        summary: 'Live MCP check passed. Swiggy is accepting this profile’s session.'
      };
    } catch (error: unknown) {
      console.warn(
        `Dashboard live Swiggy check failed for profile ${profile.id}:`,
        errorMessage(error)
      );
      swiggyCheck = {
        ...swiggyCheck,
        status: 'blocked',
        summary: 'Live MCP check failed. Reconnect this profile’s Swiggy account and try again.'
      };
    }
  }
  checks.push(swiggyCheck);

  const publicBaseUrl = process.env.PUBLIC_BASE_URL || '';
  if (/\.onrender\.com\/?$/i.test(publicBaseUrl)) {
    checks.push({
      id: 'swiggy-oauth-domain',
      label: 'Swiggy login domain',
      status: 'warning',
      summary:
        'Swiggy currently rejects onrender.com OAuth redirects. Finish the custom-domain setup before relying on one-tap relinking.',
    });
  }

  const hasAddress = Boolean(
    profile.address?.id &&
      profile.address.latitude !== null &&
      profile.address.longitude !== null &&
      Number.isFinite(profile.address.latitude) &&
      Number.isFinite(profile.address.longitude)
  );
  checks.push({
    id: 'address',
    label: 'Delivery address',
    status: hasAddress ? 'ready' : 'blocked',
    summary: hasAddress
      ? `${profile.address?.label || 'Saved address'} is selected for ordering.`
      : 'Sync and choose a Swiggy address with delivery coordinates.',
    action: hasAddress
      ? undefined
      : { id: 'choose-address', label: 'Choose address' }
  });

  if (profile.language.voiceReplies) {
    checks.push({
      id: 'voice',
      label: 'Voice replies',
      status: process.env.GNANI_API_KEY ? 'ready' : 'warning',
      summary: process.env.GNANI_API_KEY
        ? 'Gnani speech replies are configured.'
        : 'Text and voice understanding still work, but spoken replies need GNANI_API_KEY.',
    });
  }

  if (!profile.enabled) {
    checks.push({
      id: 'enabled',
      label: 'Agent availability',
      status: 'blocked',
      summary: 'This profile is paused. Incoming messages will not run the ordering agent.',
      action: { id: 'enable-agent', label: 'Enable agent' }
    });
  }

  const readyCount = checks.filter((check) => check.status === 'ready').length;
  const readiness = Math.round((readyCount / checks.length) * 100);
  const hasBlocked = checks.some((check) => check.status === 'blocked');
  const hasWarning = checks.some((check) => check.status === 'warning');

  return {
    status: hasBlocked ? 'blocked' : hasWarning ? 'needs-attention' : 'ready',
    readiness,
    checkedAt: new Date().toISOString(),
    checks
  };
}

export function createDashboardRouter(): Router {
  const router = Router();

  router.get('/session', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getSessionState(req));
  });

  router.post('/session', (req: Request, res: Response) => {
    const result = login(req, res, req.body?.password);
    res.status(result.status).json(result);
  });

  router.delete('/session', (req: Request, res: Response) => {
    logout(req, res);
    res.status(204).end();
  });

  router.use(requireAuth);

  router.get('/profiles', asyncRoute(async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ profiles: await profileStore.listProfiles() });
  }));

  router.put('/profiles/:profileId', async (req: Request, res: Response) => {
    try {
      const profile = await profileStore.updateProfile(req.params.profileId, req.body);
      res.json({ profile });
    } catch (error: unknown) {
      const message = errorMessage(error);
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.get('/profiles/:profileId/diagnostics', async (req: Request, res: Response) => {
    try {
      const diagnostics = await buildDiagnostics(
        req.params.profileId,
        req.query.live === '1'
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(diagnostics);
    } catch (error: unknown) {
      const message = errorMessage(error);
      res.status(/not found/i.test(message) ? 404 : 500).json({ error: message });
    }
  });

  router.post('/profiles/:profileId/swiggy/login', async (req: Request, res: Response) => {
    try {
      const url = await swiggyAuthService.generateAuthorizeUrl(req.params.profileId);
      res.json({ url });
    } catch (error: unknown) {
      const message = errorMessage(error);
      res.status(/not found/i.test(message) ? 404 : 500).json({ error: message });
    }
  });

  router.delete('/profiles/:profileId/swiggy/session', async (req: Request, res: Response) => {
    try {
      await swiggyAuthService.disconnect(req.params.profileId);
      const profile = await profileStore.updateProfile(req.params.profileId, {
        address: null
      });
      res.json({ profile });
    } catch (error: unknown) {
      const message = errorMessage(error);
      res.status(/not found/i.test(message) ? 404 : 500).json({ error: message });
    }
  });

  router.get('/profiles/:profileId/swiggy/addresses', async (req: Request, res: Response) => {
    try {
      const profile = await profileStore.getProfile(req.params.profileId);
      if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });

      const result = await swiggyMcpService.callTool(profile.id, 'get_addresses', {});
      if (result?.success === false) {
        console.warn(
          `Swiggy get_addresses returned an error for profile ${profile.id}:`,
          result.error || 'Unknown MCP error'
        );
        return res.status(502).json({
          error: 'Swiggy could not return saved addresses. Reconnect this profile and try again.'
        });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ addresses: normalizeAddresses(result) });
    } catch (error: unknown) {
      console.warn(
        `Swiggy address sync failed for profile ${req.params.profileId}:`,
        errorMessage(error)
      );
      return res.status(502).json({
        error: 'Could not sync saved addresses from Swiggy. Reconnect this profile and try again.'
      });
    }
  });

  router.post('/profiles/:profileId/whatsapp-test', async (req: Request, res: Response) => {
    try {
      const profile = await profileStore.getProfile(req.params.profileId);
      if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });
      if (!profile.whatsappNumber) {
        return res.status(400).json({ error: 'Add this profile’s WhatsApp number first.' });
      }

      const result = await whatsAppCloudApiService.sendTextMessage(
        profile.whatsappNumber,
        `✅ ${profile.assistantName} is connected to this WhatsApp profile. No order was created.`
      );
      return res.json({ sent: true, simulated: result?.simulated === true });
    } catch (error: unknown) {
      return res.status(502).json({ error: errorMessage(error) });
    }
  });

  router.post('/profiles/:profileId/conversation/reset', asyncRoute(async (req: Request, res: Response) => {
    const profile = await profileStore.getProfile(req.params.profileId);
    if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });

    geminiAgentService.clearHistory(profile.id);
    return res.json({ reset: true });
  }));

  return router;
}
