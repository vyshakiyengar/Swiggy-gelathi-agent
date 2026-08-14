import { Cart, PlacedOrder } from '../mcp/zepto_catalog';

export class WhatsAppFormatter {
  /**
   * Formats the active cart into a clean, scannable WhatsApp message with COD and UPI choices
   */
  public static formatCartSummary(cart: Cart, ammaName: string = 'Amma'): string {
    if (cart.items.length === 0) {
      return `🛍️ *Zepto Cart is Empty*\n\nNamaskara ${ammaName}, your cart is empty. What would you like to order today? (ಹಾಲು, ಮೊಸರು, ತರಕಾರಿ...)`;
    }

    const itemsText = cart.items
      .map(
        (i, idx) =>
          `${idx + 1}. *${i.product.name}* (${i.product.unit})\n   ↳ Qty: *${i.quantity}* × ₹${i.product.price} = *₹${i.product.price * i.quantity}*`
      )
      .join('\n');

    let discountLine = '';
    if (cart.discount && cart.discount > 0) {
      discountLine = `🏷️ Discount (${cart.couponCode || 'PROMO'}): *-₹${cart.discount}*\n`;
    }

    return (
      `🛒 *Zepto Cart Summary for ${ammaName}*\n` +
      `─────────────────────────\n` +
      `${itemsText}\n` +
      `─────────────────────────\n` +
      `📦 Item Total: *₹${cart.itemTotal}*\n` +
      discountLine +
      `🚚 Delivery Fee: *${cart.deliveryFee === 0 ? 'FREE (Orders > ₹199)' : `₹${cart.deliveryFee}`}*\n` +
      `💼 Handling Fee: *₹${cart.handlingFee}*\n` +
      `💰 *Grand Total: ₹${cart.grandTotal}*\n\n` +
      `⚡ *Delivery Time:* ~${cart.deliveryEtaMinutes} mins via Zepto\n` +
      `📍 *Address:* ${cart.deliveryAddress}\n\n` +
      `👉 *Please choose payment mode to confirm:*\n` +
      `• Reply *'COD'* or *'Cash'* -> Cash / UPI on Delivery\n` +
      `• Reply *'UPI'* or *'Order maadi'* -> WhatsApp Pay / Instant UPI`
    );
  }

  /**
   * Formats the order confirmation message with COD or WhatsApp Pay/UPI details
   */
  public static formatOrderPlaced(confirmation: PlacedOrder | any): string {
    if (!confirmation) return 'Order confirmed!';

    const isCod = confirmation.paymentMode === 'CASH_ON_DELIVERY';

    let paymentBlock = '';
    if (isCod) {
      paymentBlock =
        `💵 *Payment Mode:* *Cash on Delivery (COD)*\n` +
        `• Total to pay at doorstep: *₹${confirmation.cartSnapshot.grandTotal}*\n` +
        `• You can pay in cash or scan delivery partner's QR code on arrival.`;
    } else {
      const upiUri = confirmation.upiDeepLink || confirmation.paymentLinks?.upiUri || '';
      paymentBlock =
        `💳 *Payment Mode:* *WhatsApp Pay / Instant UPI*\n` +
        `• Tap to Pay with *WhatsApp Pay / GPay / PhonePe*:\n` +
        `  👉 ${upiUri}\n\n` +
        `• UPI VPA: \`zepto.orders@icici\``;
    }

    return (
      `🎉 *Order Placed Successfully on Zepto!* ⚡\n` +
      `─────────────────────────\n` +
      `🆔 *Order ID:* \`${confirmation.orderId}\`\n` +
      `⏱️ *ETA:* Arriving in *~${confirmation.deliveryEtaMinutes} minutes*\n` +
      `📍 *Delivering to:* ${confirmation.deliveryAddress}\n` +
      `💰 *Total Bill:* *₹${confirmation.cartSnapshot.grandTotal}*\n\n` +
      `${paymentBlock}\n\n` +
      `🛵 *Track Live Delivery:* ${confirmation.trackingUrl}\n` +
      `─────────────────────────\n` +
      `ಧನ್ಯವಾದಗಳು ಅಮ್ಮ! (Thank you Amma!)`
    );
  }
}
