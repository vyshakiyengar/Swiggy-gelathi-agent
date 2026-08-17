import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppSectionRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppSection {
  title: string;
  rows: WhatsAppSectionRow[];
}

export class WhatsAppCloudApiService {
  private token: string;
  private phoneNumberId: string;
  private apiVersion: string;
  private isConfigured: boolean;

  constructor() {
    this.token = process.env.WHATSAPP_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
    this.isConfigured = Boolean(this.token && this.phoneNumberId);

    if (!this.isConfigured) {
      console.log('ℹ️ WhatsApp Cloud API credentials not yet fully configured in .env (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID). Outbound messages will be logged and simulator will be active.');
    }
  }

  private getApiUrl(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  /**
   * Send a standard formatted text message to a WhatsApp number
   */
  public async sendTextMessage(to: string, text: string, previewUrl: boolean = false): Promise<any> {
    const cleanTo = to.replace(/\D/g, ''); // Ensure digits only

    if (!this.isConfigured) {
      console.log(`\n📤 [Meta Cloud API Simulation -> +${cleanTo}]:\n${text}\n`);
      return { simulated: true, to: cleanTo, text };
    }

    try {
      const response = await axios.post(
        this.getApiUrl(),
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
          type: 'text',
          text: {
            preview_url: previewUrl,
            body: text
          }
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ [Meta WhatsApp Cloud API] Message sent to +${cleanTo}:`, response.data);
      return response.data;
    } catch (error: any) {
      console.error(`❌ [Meta WhatsApp Cloud API Error] Failed sending to +${cleanTo}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send Interactive Quick-Action Buttons (Up to 3 buttons)
   * Example: [✅ Confirm Order (UPI)], [💵 Cash on Delivery], [🛒 View Cart]
   */
  public async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: WhatsAppButton[],
    headerText?: string,
    footerText?: string
  ): Promise<any> {
    const cleanTo = to.replace(/\D/g, '');

    // Max 3 buttons allowed by WhatsApp Cloud API
    const formattedButtons = buttons.slice(0, 3).map((b) => ({
      type: 'reply',
      reply: {
        id: b.id,
        title: b.title.slice(0, 20) // WhatsApp limit is 20 chars per button title
      }
    }));

    if (!this.isConfigured) {
      console.log(`\n📤 [Meta Interactive Buttons Simulation -> +${cleanTo}]:`);
      if (headerText) console.log(`📌 Header: ${headerText}`);
      console.log(`💬 Body:\n${bodyText}`);
      console.log(`🔘 Buttons: ${buttons.map((b) => `[${b.title}]`).join(' ')}`);
      if (footerText) console.log(`📝 Footer: ${footerText}\n`);
      return { simulated: true, to: cleanTo, bodyText, buttons };
    }

    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: formattedButtons }
        }
      };

      if (headerText) {
        payload.interactive.header = {
          type: 'text',
          text: headerText
        };
      }

      if (footerText) {
        payload.interactive.footer = {
          text: footerText
        };
      }

      const response = await axios.post(this.getApiUrl(), payload, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ [Meta WhatsApp Cloud API] Interactive buttons sent to +${cleanTo}:`, response.data);
      return response.data;
    } catch (error: any) {
      console.error(`❌ [Meta Interactive Buttons Error]:`, error.response?.data || error.message);
      // Fallback to text message if interactive fails
      return this.sendTextMessage(cleanTo, `${bodyText}\n\n👉 Options: ${buttons.map((b) => b.title).join(' | ')}`);
    }
  }

  /**
   * Downloads a media attachment (e.g. a voice note) from an incoming WhatsApp message.
   * Meta's Media API is a two-step fetch: first resolve the media ID to a short-lived signed
   * URL, then download the actual bytes from that URL (both requests need the same auth).
   */
  public async downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const metaRes = await axios.get(`https://graph.facebook.com/${this.apiVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });

    const { url, mime_type: mimeType } = metaRes.data;

    const fileRes = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      responseType: 'arraybuffer'
    });

    return { data: Buffer.from(fileRes.data), mimeType: mimeType || 'audio/ogg' };
  }

  /**
   * Uploads media bytes to Meta so they can be sent in a message (Meta requires media to be
   * uploaded first and referenced by ID, rather than sent inline). Returns the media ID.
   */
  public async uploadMedia(data: Buffer, mimeType: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);

    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form
    });

    const body: any = await res.json();
    if (!res.ok || !body.id) {
      throw new Error(`Media upload failed: ${JSON.stringify(body)}`);
    }
    return body.id;
  }

  /**
   * Send a voice note / audio message by previously-uploaded media ID.
   */
  public async sendAudioMessage(to: string, mediaId: string): Promise<any> {
    const cleanTo = to.replace(/\D/g, '');

    if (!this.isConfigured) {
      console.log(`\n📤 [Meta Audio Simulation -> +${cleanTo}]: media_id=${mediaId}\n`);
      return { simulated: true, to: cleanTo, mediaId };
    }

    const response = await axios.post(
      this.getApiUrl(),
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'audio',
        audio: { id: mediaId }
      },
      { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } }
    );

    console.log(`✅ [Meta WhatsApp Cloud API] Voice note sent to +${cleanTo}`);
    return response.data;
  }

  /**
   * Mark incoming message as read (blue double-tick)
   */
  public async markMessageAsRead(messageId: string): Promise<void> {
    if (!this.isConfigured || !messageId) return;

    try {
      await axios.post(
        this.getApiUrl(),
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error: any) {
      console.error('⚠️ Could not mark message as read:', error.response?.data || error.message);
    }
  }

  public getStatus() {
    return {
      configured: this.isConfigured,
      phoneNumberId: this.phoneNumberId || 'Not set',
      apiVersion: this.apiVersion
    };
  }
}

export const whatsAppCloudApiService = new WhatsAppCloudApiService();
