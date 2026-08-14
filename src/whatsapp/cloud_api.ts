import axios from 'axios';
import dotenv from 'dotenv';
import { Cart, PlacedOrder } from '../mcp/zepto_catalog';

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

  /**
   * Send Cart Summary with quick interactive buttons
   */
  public async sendCartSummaryWithActions(to: string, replyText: string, cart: Cart): Promise<any> {
    if (cart.items.length === 0) {
      return this.sendTextMessage(to, replyText);
    }

    // Interactive buttons for quick 1-tap checkout
    const buttons: WhatsAppButton[] = [
      { id: 'btn_confirm_upi', title: '⚡ Pay with UPI' },
      { id: 'btn_confirm_cod', title: '💵 Cash on Delivery' },
      { id: 'btn_clear_cart', title: '❌ Clear Cart' }
    ];

    return this.sendInteractiveButtons(
      to,
      replyText,
      buttons,
      '🛒 Zepto 10-Min Delivery Cart',
      'Tap a button below to confirm or edit'
    );
  }

  /**
   * Send Order Confirmation with live tracking & UPI deep links
   */
  public async sendOrderConfirmation(to: string, confirmation: PlacedOrder): Promise<any> {
    let message = `🎉 *ORDER CONFIRMED on Zepto!* (ಆರ್ಡರ್ ಖಚಿತವಾಗಿದೆ!)\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📦 *Order ID:* \`${confirmation.orderId}\`\n`;
    message += `⚡ *ETA:* *${confirmation.deliveryEtaMinutes} Minutes* (~${confirmation.estimatedDeliveryTime})\n`;
    message += `🛵 *Rider:* ${confirmation.riderName} (${confirmation.riderPhone})\n`;
    message += `📍 *Delivery Address:* ${confirmation.deliveryAddress}\n`;
    message += `💰 *Total Paid:* *₹${confirmation.cartSnapshot.grandTotal}* (${confirmation.paymentMode === 'UPI_ONLINE' ? 'UPI' : 'Cash on Delivery'})\n\n`;

    if (confirmation.paymentMode === 'UPI_ONLINE' && confirmation.upiDeepLink) {
      message += `📲 *Click to Pay via UPI App (GPay / PhonePe / Paytm):*\n${confirmation.upiDeepLink}\n\n`;
    }

    message += `📍 *Track Live Rider:*\n${confirmation.trackingUrl}\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `_Dhanyavadagalu Amma! Your groceries are being packed at the dark store right now._ 🛵💨`;

    const buttons: WhatsAppButton[] = [
      { id: `btn_track_${confirmation.orderId}`, title: '📍 Track Live Rider' },
      { id: 'btn_order_more', title: '🛒 Order More' }
    ];

    return this.sendInteractiveButtons(to, message, buttons, '⚡ Zepto 10-Min Fast Delivery');
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
