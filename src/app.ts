import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import { geminiAgentService } from './agent/gemini';
import { createDashboardRouter } from './dashboard/router';
import { requireAuth } from './dashboard/auth';
import { profileStore } from './profiles/store';
import { swiggyAuthService } from './swiggy/auth';
import { whatsAppCloudApiService } from './whatsapp/cloud_api';
import {
  handleWhatsAppIncomingMessage,
  verifyWhatsAppWebhook
} from './whatsapp/webhook';
import {
  parseVerifiedWhatsAppJson,
  verifyWhatsAppWebhookSignature
} from './whatsapp/signature';

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self' https://mcp.swiggy.com",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createApp(): express.Express {
  const app = express();
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);

  // Authenticate Meta's exact request bytes before parsing or handling the webhook. Keeping this
  // route ahead of the general JSON parser prevents it from losing the bytes Meta signed.
  app.get('/webhook/whatsapp', verifyWhatsAppWebhook);
  app.post(
    '/webhook/whatsapp',
    express.raw({ type: 'application/json', limit: '96kb' }),
    verifyWhatsAppWebhookSignature,
    parseVerifiedWhatsAppJson,
    asyncHandler(handleWhatsAppIncomingMessage)
  );

  app.use(express.json({ limit: '96kb' }));
  app.use(express.urlencoded({ extended: true, limit: '32kb' }));

  app.get(
    '/swiggy/oauth/callback',
    asyncHandler(async (req: Request, res: Response) => {
      const { code, state, error: oauthError } = req.query;
      if (oauthError) {
        return res
          .status(400)
          .send(
            `<h1>Swiggy login failed</h1><p>${escapeHtml(oauthError)}</p><p>Return to the household desk and try again.</p>`
          );
      }
      if (typeof code !== 'string' || typeof state !== 'string') {
        return res.status(400).send('<h1>Missing code or state</h1>');
      }

      const result = await swiggyAuthService.handleCallback(code, state);
      if (!result.success) {
        return res
          .status(400)
          .send(
            `<h1>Swiggy login failed</h1><p>${escapeHtml(result.error)}</p><p>Return to the household desk and request a fresh link.</p>`
          );
      }

      // The profile store owns persistence; access tokens must never be rendered into HTML.
      return res.redirect(
        `/?profile=${encodeURIComponent(result.profileId)}&swiggy=linked`
      );
    })
  );

  app.use('/api/dashboard', createDashboardRouter());

  // Legacy owner endpoints remain available for operational continuity, but are now protected.
  app.get(
    '/swiggy/relogin-link',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const profileId =
          typeof req.query.profileId === 'string' ? req.query.profileId : 'mother';
        res.json({ url: await swiggyAuthService.generateAuthorizeUrl(profileId) });
      } catch (error: unknown) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Could not create login link.'
        });
      }
    })
  );

  app.get(
    '/swiggy/status',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const profileId =
        typeof req.query.profileId === 'string' ? req.query.profileId : 'mother';
      res.json(await swiggyAuthService.getSessionStatus(profileId));
    })
  );

  app.post(
    '/api/chat',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const { sessionId = 'mother', message } = req.body;
        if (!message || typeof message !== 'string') {
          return res.status(400).json({ error: 'Message is required' });
        }

        const agentResponse = await geminiAgentService.processMessage(String(sessionId), {
          type: 'text',
          text: message
        });
        return res.json({
          reply: agentResponse.reply,
          toolCalls: agentResponse.toolCallsExecuted
        });
      } catch (error: unknown) {
        console.error('Error in /api/chat:', error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : 'Internal Server Error'
        });
      }
    })
  );

  app.post(
    '/api/whatsapp/send-test',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const { to, text } = req.body;
        if (!to || !text || typeof to !== 'string' || typeof text !== 'string') {
          return res.status(400).json({ error: 'Parameters "to" and "text" are required' });
        }
        const sendResult = await whatsAppCloudApiService.sendTextMessage(to, text);
        return res.json({ status: 'SUCCESS', sendResult });
      } catch (error: any) {
        return res.status(500).json({ error: error.response?.data || error.message });
      }
    })
  );

  app.get('/api/whatsapp/status', requireAuth, (_req: Request, res: Response) => {
    res.json(whatsAppCloudApiService.getStatus());
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'Swiggy WhatsApp Agent',
      timestamp: new Date().toISOString()
    });
  });

  const dashboardDirectory = path.join(__dirname, 'dashboard', 'public');
  app.use(
    '/dashboard',
    express.static(dashboardDirectory, { index: false, maxAge: '5m' })
  );
  app.get('/', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dashboardDirectory, 'index.html'));
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return app;
}
