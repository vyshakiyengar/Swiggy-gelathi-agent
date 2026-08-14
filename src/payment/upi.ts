import QRCode from 'qrcode';

export interface PaymentDetails {
  orderId: string;
  amount: number;
  payeeVpa: string;
  payeeName: string;
  transactionNote: string;
}

export interface PaymentLinks {
  orderId: string;
  amount: number;
  currency: string;
  payeeVpa: string;
  payeeName: string;
  upiUri: string;
  // WhatsApp Pay in-chat interactive payload
  whatsappPayPayload: {
    type: 'payment';
    payment: {
      type: 'upi';
      configuration_name: string;
      reference_id: string;
      amount: {
        value: number; // in paise
        offset: number;
      };
      currency: string;
      total_amount: {
        value: number;
        offset: number;
      };
      order: {
        status: 'pending';
        catalog_id: string;
        items: Array<{
          retailer_id: string;
          name: string;
          amount: { value: number; offset: number };
          quantity: number;
        }>;
        subtotal: { value: number; offset: number };
        tax?: { value: number; offset: number };
        shipping?: { value: number; offset: number };
      };
    };
  };
  // App-specific intent deep-links
  gpayLink: string;
  phonepeLink: string;
  paytmLink: string;
  bhimLink: string;
  qrCodeDataUrl: string;
}

export class UpiPaymentService {
  private defaultVpa: string;
  private defaultPayeeName: string;

  constructor() {
    this.defaultVpa = process.env.UPI_PAYMENT_VPA || 'zepto.orders@icici';
    this.defaultPayeeName = process.env.UPI_PAYEE_NAME || 'Zepto Grocery';
  }

  /**
   * Generates standard NPCI UPI Intent URI, WhatsApp Pay in-chat trigger, and app deep links.
   */
  public async generatePaymentLinks(
    orderId: string,
    amount: number,
    items: Array<{ name: string; price: number; quantity: number }> = [],
    note: string = 'Zepto Grocery Order'
  ): Promise<PaymentLinks> {
    const encodedPn = encodeURIComponent(this.defaultPayeeName);
    const encodedTn = encodeURIComponent(`${note} #${orderId}`);
    const formattedAmount = amount.toFixed(2);
    const amountInPaise = Math.round(amount * 100);

    // Standard NPCI UPI URI
    const upiUri = `upi://pay?pa=${this.defaultVpa}&pn=${encodedPn}&am=${formattedAmount}&cu=INR&tn=${encodedTn}&tr=${orderId}`;

    // App-specific intent deep-links for instant 1-tap mobile payment
    const gpayLink = `gpay://upi/pay?pa=${this.defaultVpa}&pn=${encodedPn}&am=${formattedAmount}&cu=INR&tn=${encodedTn}&tr=${orderId}`;
    const phonepeLink = `phonepe://pay?pa=${this.defaultVpa}&pn=${encodedPn}&am=${formattedAmount}&cu=INR&tn=${encodedTn}&tr=${orderId}`;
    const paytmLink = `paytmmp://pay?pa=${this.defaultVpa}&pn=${encodedPn}&am=${formattedAmount}&cu=INR&tn=${encodedTn}&tr=${orderId}`;
    const bhimLink = `bhim://pay?pa=${this.defaultVpa}&pn=${encodedPn}&am=${formattedAmount}&cu=INR&tn=${encodedTn}&tr=${orderId}`;

    // Native WhatsApp Pay Interactive Payload (WhatsApp Cloud API specification)
    const whatsappPayPayload: PaymentLinks['whatsappPayPayload'] = {
      type: 'payment',
      payment: {
        type: 'upi',
        configuration_name: 'zepto_in_chat_upi',
        reference_id: orderId,
        amount: {
          value: amountInPaise,
          offset: 100
        },
        currency: 'INR',
        total_amount: {
          value: amountInPaise,
          offset: 100
        },
        order: {
          status: 'pending',
          catalog_id: 'zepto_bengaluru_catalog',
          items: items.map((i) => ({
            retailer_id: i.name.toLowerCase().replace(/\s+/g, '_'),
            name: i.name,
            amount: { value: Math.round(i.price * 100), offset: 100 },
            quantity: i.quantity
          })),
          subtotal: { value: amountInPaise, offset: 100 }
        }
      }
    };

    // Generate high quality QR code data URL
    const qrCodeDataUrl = await QRCode.toDataURL(upiUri, {
      margin: 2,
      width: 320,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    });

    return {
      orderId,
      amount,
      currency: 'INR',
      payeeVpa: this.defaultVpa,
      payeeName: this.defaultPayeeName,
      upiUri,
      whatsappPayPayload,
      gpayLink,
      phonepeLink,
      paytmLink,
      bhimLink,
      qrCodeDataUrl
    };
  }
}

export const upiPaymentService = new UpiPaymentService();
