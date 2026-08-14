import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export interface ZeptoUserSession {
  authToken: string;
  refreshToken?: string;
  phoneNumber: string;
  userId?: string;
  defaultAddressId?: string;
  defaultStoreId?: string;
  latitude?: number;
  longitude?: number;
  deliveryAddress?: string;
}

export class ZeptoLiveApiService {
  private client: AxiosInstance;
  private session: ZeptoUserSession | null = null;
  private isLiveConfigured: boolean = false;

  constructor() {
    const authToken = process.env.ZEPTO_AUTH_TOKEN || '';
    const lat = parseFloat(process.env.ZEPTO_LATITUDE || '12.9352');
    const lon = parseFloat(process.env.ZEPTO_LONGITUDE || '77.6245');

    this.client = axios.create({
      baseURL: 'https://api.zeptonow.com',
      timeout: 10000,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zepto/10.0.0',
        'app_version': '10.0.0',
        'platform': 'iOS',
        'tenant_id': 'zepto',
        'x-latitude': lat.toString(),
        'x-longitude': lon.toString()
      }
    });

    if (authToken) {
      this.setAuthToken(authToken);
    }
  }

  public setAuthToken(token: string, refreshToken?: string) {
    this.session = {
      authToken: token,
      refreshToken: refreshToken || this.session?.refreshToken,
      phoneNumber: process.env.ZEPTO_PHONE_NUMBER || '',
      defaultAddressId: process.env.ZEPTO_ADDRESS_ID || '',
      defaultStoreId: process.env.ZEPTO_STORE_ID || '',
      deliveryAddress: process.env.DEFAULT_DELIVERY_ADDRESS || ''
    };
    this.client.defaults.headers.common['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    this.isLiveConfigured = true;

    const expiry = this.decodeJwtExpiry(token);
    if (expiry) {
      const minutesLeft = Math.round((expiry.getTime() - Date.now()) / 60000);
      console.log(`✅ Real Zepto Account Session Loaded! Token expires ${expiry.toISOString()} (~${minutesLeft} min from now)`);
    } else {
      console.log('✅ Real Zepto Account Session Loaded successfully! (token is not a decodable JWT, unknown expiry)');
    }
  }

  /** Decodes a JWT's exp claim without verifying signature - just for logging/diagnostics, never trust for auth. */
  private decodeJwtExpiry(token: string): Date | null {
    try {
      const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
      const payloadB64 = raw.split('.')[1];
      if (!payloadB64) return null;
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
      return payload.exp ? new Date(payload.exp * 1000) : null;
    } catch {
      return null;
    }
  }

  /**
   * Step 1: Send SMS OTP to phone number
   */
  public async sendOtp(phoneNumber: string): Promise<{ status: string; message: string }> {
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
    try {
      const response = await this.client.post('/api/v1/user/otp/send', {
        mobile_number: cleanPhone,
        country_code: '+91'
      });
      return { status: 'SUCCESS', message: response.data.message || 'OTP sent successfully to your phone!' };
    } catch (err: any) {
      console.warn('Zepto standard OTP endpoint failed, trying v2 auth:', err.message);
      try {
        const resV2 = await this.client.post('/api/v2/auth/send-otp', {
          phone: cleanPhone,
          country_code: '+91'
        });
        return { status: 'SUCCESS', message: resV2.data.message || 'OTP sent via v2' };
      } catch (errV2: any) {
        throw new Error(`Could not trigger Zepto OTP for +91 ${cleanPhone}: ${errV2.response?.data?.message || errV2.message}`);
      }
    }
  }

  /**
   * Step 2: Verify OTP and extract Auth Token
   */
  public async verifyOtp(phoneNumber: string, otp: string): Promise<ZeptoUserSession> {
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
    try {
      const response = await this.client.post('/api/v1/user/otp/verify', {
        mobile_number: cleanPhone,
        country_code: '+91',
        otp: otp.trim()
      });

      const data = response.data;
      const inner = data.data || data;
      const authToken = data.token || data.auth_token || inner.token || inner.access_token;
      const refreshToken = data.refresh_token || data.refreshToken || inner.refresh_token || inner.refreshToken;
      const userId = data.user_id || inner.user_id;

      if (!authToken) {
        throw new Error('No auth token returned in OTP verification response');
      }

      // Diagnostic only - logs field names present in the response (not values), so we can
      // tell whether Zepto's login actually issues a refresh token without exposing secrets.
      console.log(`🔍 OTP verify response top-level keys: [${Object.keys(data).join(', ')}]`);
      if (inner !== data) console.log(`🔍 OTP verify response nested "data" keys: [${Object.keys(inner).join(', ')}]`);
      console.log(refreshToken ? '✅ A refresh token WAS found in the login response.' : '⚠️ No refresh token field found in the login response - session may need re-login on expiry.');

      this.setAuthToken(authToken, refreshToken);

      // Save token(s) to .env file permanently
      this.persistTokenToEnv(authToken, cleanPhone, refreshToken);

      return {
        authToken,
        refreshToken,
        phoneNumber: cleanPhone,
        userId
      };
    } catch (err: any) {
      throw new Error(`Failed to verify Zepto OTP: ${err.response?.data?.message || err.message}`);
    }
  }

  /**
   * Search Live Zepto Darkstore Inventory
   */
  public async searchLiveProducts(query: string): Promise<any[]> {
    if (!this.isLiveConfigured) {
      return [];
    }

    try {
      const response = await this.client.get('/api/v2/search', {
        params: { query: query.trim() }
      });

      const items = response.data?.data?.items || response.data?.items || [];
      return items.map((i: any) => ({
        id: i.id || i.product_id,
        name: i.name || i.product_name,
        price: (i.selling_price || i.price || 0) / 100,
        mrp: (i.mrp || 0) / 100,
        unit: i.weight || i.unit || '1 unit',
        inStock: i.out_of_stock !== true && i.available_quantity > 0,
        imageUrl: i.images?.[0]?.url || i.image_url
      }));
    } catch (err: any) {
      console.warn('⚠️ Zepto live search fallback:', err.message);
      return [];
    }
  }

  /**
   * Place Cash on Delivery (COD) Order on real Zepto account
   */
  public async placeLiveCodOrder(cartItems: Array<{ productId: string; quantity: number }>): Promise<any> {
    if (!this.isLiveConfigured) {
      return {
        simulated: true,
        orderId: `ZP-${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'CONFIRMED',
        paymentMode: 'CASH_ON_DELIVERY'
      };
    }

    try {
      // 1. Sync items into live Zepto cart
      for (const item of cartItems) {
        await this.client.post('/api/v1/cart/items', {
          product_id: item.productId,
          quantity: item.quantity
        });
      }

      // 2. Checkout with Cash on Delivery (COD)
      const checkoutRes = await this.client.post('/api/v1/orders/checkout', {
        payment_method: 'CASH_ON_DELIVERY',
        delivery_address_id: process.env.ZEPTO_ADDRESS_ID,
        tip_amount: 0
      });

      const orderData = checkoutRes.data?.data || checkoutRes.data;
      return {
        liveOrder: true,
        orderId: orderData.order_id || orderData.id,
        status: 'CONFIRMED',
        paymentMode: 'CASH_ON_DELIVERY',
        deliveryEtaMinutes: orderData.eta_minutes || 10,
        totalAmount: (orderData.total_payable || 0) / 100,
        trackingUrl: `https://app.zeptonow.com/order/${orderData.order_id || orderData.id}`
      };
    } catch (err: any) {
      const message = err.response?.data?.message || err.message;
      console.error('❌ Error placing live Zepto COD order:', err.response?.data || message);
      return {
        success: false,
        error: message,
        httpStatus: err.response?.status
      };
    }
  }

  private persistTokenToEnv(authToken: string, phone: string, refreshToken?: string) {
    try {
      const envPath = path.join(__dirname, '../../.env');
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf8');
        if (content.includes('ZEPTO_AUTH_TOKEN=')) {
          content = content.replace(/ZEPTO_AUTH_TOKEN=.*/g, `ZEPTO_AUTH_TOKEN="${authToken}"`);
        } else {
          content += `\nZEPTO_AUTH_TOKEN="${authToken}"\nZEPTO_PHONE_NUMBER="${phone}"\n`;
        }
        if (refreshToken) {
          if (content.includes('ZEPTO_REFRESH_TOKEN=')) {
            content = content.replace(/ZEPTO_REFRESH_TOKEN=.*/g, `ZEPTO_REFRESH_TOKEN="${refreshToken}"`);
          } else {
            content += `ZEPTO_REFRESH_TOKEN="${refreshToken}"\n`;
          }
        }
        fs.writeFileSync(envPath, content);
        console.log('💾 Zepto Auth Token saved permanently to .env!');
      }
    } catch (e) {
      console.warn('Could not auto-write to .env:', e);
    }
  }

  public isConfigured(): boolean {
    return this.isLiveConfigured;
  }
}

export const zeptoLiveApiService = new ZeptoLiveApiService();
