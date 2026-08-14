import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import pino from 'pino';
import { geminiAgentService } from '../agent/gemini';

export class WhatsAppLiveBotService {
  private socket: WASocket | null = null;
  private currentQrCode: string | null = null;
  private currentQrDataUrl: string | null = null;
  private isConnected: boolean = false;
  private userPhoneNumber: string | null = null;

  public async start(): Promise<void> {
    const authFolder = path.join(__dirname, '../../auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Zepto Mom Assistant', 'Chrome', '1.0.0']
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.currentQrCode = qr;
        this.currentQrDataUrl = await QRCode.toDataURL(qr);
        console.log('\n======================================================');
        console.log('📱 SCAN THIS WHATSAPP QR CODE TO LINK YOUR LIVE BOT:');
        console.log('======================================================\n');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('\nOr view it in the browser at: http://localhost:3000');
        console.log('======================================================\n');
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.isConnected = false;
        console.log('⚠️ WhatsApp connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(() => this.start(), 3000);
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.currentQrCode = null;
        this.currentQrDataUrl = null;
        this.userPhoneNumber = this.socket?.user?.id?.split(':')[0] || 'Unknown';
        console.log('\n🎉 ======================================================');
        console.log(`✅ WHATSAPP AGENT IS LIVE on +${this.userPhoneNumber}!`);
        console.log('Mom can now send WhatsApp messages directly to this number!');
        console.log('======================================================\n');
      }
    });

    // Handle Incoming Live WhatsApp Messages
    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Ignore messages sent by the bot itself or status broadcasts
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') {
          continue;
        }

        const senderJid = msg.key.remoteJid;
        if (!senderJid) continue;

        // Extract text message content
        const incomingText =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        if (!incomingText.trim()) continue;

        console.log(`\n📩 [Live WhatsApp from ${senderJid}]: "${incomingText}"`);

        // Send 'typing...' status to WhatsApp chat
        await this.socket?.presenceSubscribe(senderJid);
        await this.socket?.sendPresenceUpdate('composing', senderJid);

        try {
          // Process message through Gemini Zepto Agent
          const agentResponse = await geminiAgentService.processMessage(senderJid, incomingText);

          // Stop typing indicator
          await this.socket?.sendPresenceUpdate('paused', senderJid);

          // Send formatted response to Mom's WhatsApp chat
          await this.socket?.sendMessage(senderJid, {
            text: agentResponse.reply
          });

          console.log(`📤 [Replied to ${senderJid}]: Success`);
        } catch (error) {
          console.error(`❌ Error replying to ${senderJid}:`, error);
          await this.socket?.sendMessage(senderJid, {
            text: 'Amma, I had a brief issue. Could you please send that again? (ನಮಸ್ಕಾರ ಅಮ್ಮ, ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ ದಯವಿಟ್ಟು)'
          });
        }
      }
    });
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      phoneNumber: this.userPhoneNumber,
      qrCodeDataUrl: this.currentQrDataUrl
    };
  }
}

export const whatsAppLiveBotService = new WhatsAppLiveBotService();
