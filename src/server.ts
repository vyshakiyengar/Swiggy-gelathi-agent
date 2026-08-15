import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { geminiAgentService } from './agent/gemini';
import { zeptoStoreService } from './mcp/zepto_catalog';
import { whatsAppCloudApiService } from './whatsapp/cloud_api';
import {
  verifyWhatsAppWebhook,
  handleWhatsAppIncomingMessage
} from './whatsapp/webhook';
import { swiggyAuthService } from './swiggy/auth';
import { startSwiggyReloginReminderCron } from './swiggy/relogin_reminder';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (Interactive WhatsApp Web Dashboard & Simulator)
app.use(express.static(path.join(__dirname, '../public')));

// --- Meta WhatsApp Cloud API Webhook Endpoints ---
app.get('/webhook/whatsapp', verifyWhatsAppWebhook);
app.post('/webhook/whatsapp', handleWhatsAppIncomingMessage);

// --- Swiggy Instamart MCP OAuth ---

/**
 * OAuth redirect target for the Swiggy Instamart MCP login. Tapping the relink link (sent via
 * WhatsApp by the reminder cron, or visited directly) redirects here with a code, which is
 * exchanged for a fresh access token entirely server-side - no laptop or code required.
 */
app.get('/swiggy/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(400).send(`<h2>Swiggy login failed</h2><p>${oauthError}</p>`);
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).send('<h2>Missing code or state</h2>');
  }

  const result = await swiggyAuthService.handleCallback(code, state);
  if (!result.success) {
    return res.status(400).send(`<h2>Swiggy login failed</h2><p>${result.error}</p><p>Ask Vyshak for a fresh link.</p>`);
  }

  res.send('<h2>✅ Swiggy linked successfully!</h2><p>You can close this tab. The grocery bot is ready again.</p>');
});

/** Manual trigger to get a fresh login link without waiting for the cron reminder. */
app.get('/swiggy/relogin-link', (req: Request, res: Response) => {
  res.json({ url: swiggyAuthService.generateAuthorizeUrl() });
});

app.get('/swiggy/status', (req: Request, res: Response) => {
  res.json(swiggyAuthService.getSessionStatus());
});

// --- API Endpoints for Simulator & Frontend ---

/**
 * Send a message to the Gemini Zepto Agent
 */
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { sessionId = '919876543210', message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`💬 User (+${sessionId}): "${message}"`);

    const agentResponse = await geminiAgentService.processMessage(sessionId, message);
    const currentCart = zeptoStoreService.getOrCreateCart(sessionId);

    res.json({
      reply: agentResponse.reply,
      toolCalls: agentResponse.toolCallsExecuted,
      cart: currentCart,
      orderDetails: agentResponse.orderDetails
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

/**
 * Get current cart state
 */
app.get('/api/cart/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const cart = zeptoStoreService.getOrCreateCart(sessionId);
  res.json({ cart });
});

/**
 * Reset / Clear cart
 */
app.post('/api/cart/:sessionId/clear', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const cart = zeptoStoreService.clearCart(sessionId);
  geminiAgentService.clearHistory(sessionId);
  res.json({ status: 'CLEARED', cart });
});

/**
 * Send test direct message to a real WhatsApp phone number via Meta Cloud API
 */
app.post('/api/whatsapp/send-test', async (req: Request, res: Response) => {
  try {
    const { to, text } = req.body;
    if (!to || !text) {
      return res.status(400).json({ error: 'Parameters "to" and "text" are required' });
    }

    const sendResult = await whatsAppCloudApiService.sendTextMessage(to, text);
    res.json({ status: 'SUCCESS', sendResult });
  } catch (error: any) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

/**
 * WhatsApp Cloud API Status & Configuration endpoint
 */
app.get('/api/whatsapp/status', (req: Request, res: Response) => {
  const status = whatsAppCloudApiService.getStatus();
  res.json(status);
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Zepto Mom WhatsApp Agent (Meta Cloud API & MCP Server)',
    metaCloudApi: whatsAppCloudApiService.getStatus(),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Zepto WhatsApp Agent Server running at http://localhost:${PORT}`);
  console.log(`📱 WhatsApp Web Simulator & Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Meta WhatsApp Webhook URL: http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`======================================================\n`);

  startSwiggyReloginReminderCron();
});
