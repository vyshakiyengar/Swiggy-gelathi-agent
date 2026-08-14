import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { zeptoStoreService, Cart, PlacedOrder, Product } from './zepto_catalog';
import { upiPaymentService, PaymentLinks } from '../payment/upi';
import { zeptoLiveApiService } from '../zepto/live_api';

export interface OrderConfirmation {
  orderId: string;
  status: 'CONFIRMED' | 'PACKING' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  cartSnapshot: Cart;
  deliveryEtaMinutes: number;
  deliveryAddress: string;
  paymentMode: 'UPI_ONLINE' | 'CASH_ON_DELIVERY';
  paymentLinks?: PaymentLinks;
  trackingUrl: string;
  placedAt: string;
}

export class ZeptoMcpTools {
  public static declarations: FunctionDeclaration[] = [
    {
      name: 'search_zepto_products',
      description:
        'Search Zepto catalog for groceries, vegetables, milk, curd, fruits, snacks, staples with Kannada/English/Kanglish keywords (e.g. halu, mosaru, kottambari soppu, togari bele, amul butter, eggs, bread, atta).',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: {
            type: SchemaType.STRING,
            description: 'Item name or keyword (e.g. "nandini halu", "curd", "kottambari", "aashirvaad atta", "eggs")'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'get_product_details',
      description: 'Get details, price, MRP, pack size, category, and in-stock status for a product ID.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          productId: {
            type: SchemaType.STRING,
            description: 'Exact product ID returned from search (e.g. prod-milk-nandini-toned)'
          }
        },
        required: ['productId']
      }
    },
    {
      name: 'add_to_cart',
      description: 'Add a grocery product to the user\'s active Zepto shopping cart.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          productId: {
            type: SchemaType.STRING,
            description: 'Exact product ID returned from search_zepto_products (e.g. prod-milk-nandini-toned)'
          },
          quantity: {
            type: SchemaType.INTEGER,
            description: 'Number of units / packets / packs to add (default is 1)'
          }
        },
        required: ['productId']
      }
    },
    {
      name: 'get_cart',
      description: 'Get the current items in the user\'s Zepto cart, itemized breakdown, discounts, delivery fee, and grand total.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {}
      }
    },
    {
      name: 'update_cart_quantity',
      description: 'Update the quantity of an item already in the cart, or remove it if quantity is 0.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          productId: {
            type: SchemaType.STRING,
            description: 'Product ID in cart'
          },
          quantity: {
            type: SchemaType.INTEGER,
            description: 'New quantity'
          }
        },
        required: ['productId', 'quantity']
      }
    },
    {
      name: 'remove_from_cart',
      description: 'Remove an item completely from the Zepto cart.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          productId: {
            type: SchemaType.STRING,
            description: 'Product ID to remove'
          }
        },
        required: ['productId']
      }
    },
    {
      name: 'apply_coupon',
      description: 'Apply a discount coupon promo code (e.g. ZEPTO50, AMMA50, FREESHIP) to the cart.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          code: {
            type: SchemaType.STRING,
            description: 'Promo coupon code'
          }
        },
        required: ['code']
      }
    },
    {
      name: 'place_order',
      description:
        'Finalize and place the Zepto grocery order AFTER the user explicitly confirmed with "Yes / Order / Theek ide / Confirm". Generates order ID, UPI intent deep links, Cash on Delivery option, and 10-minute delivery tracking.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          paymentMode: {
            type: SchemaType.STRING,
            description: 'Payment preference: "UPI_ONLINE" (WhatsApp Pay / UPI) or "CASH_ON_DELIVERY" (default is UPI_ONLINE)'
          },
          deliveryAddress: {
            type: SchemaType.STRING,
            description: 'Delivery address override if specified by user'
          }
        }
      }
    },
    {
      name: 'track_order',
      description: 'Check live order status, rider name, phone, and ETA for a placed order. If orderId is omitted, automatically checks the user\'s latest order.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          orderId: {
            type: SchemaType.STRING,
            description: 'Order ID (optional, e.g. ZP-123456)'
          }
        }
      }
    },
    {
      name: 'cancel_order',
      description: 'Cancel an active Zepto grocery order. Works if order is packing or before delivery. If orderId is omitted, automatically cancels the user\'s latest order.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          orderId: {
            type: SchemaType.STRING,
            description: 'Order ID to cancel (optional)'
          },
          reason: {
            type: SchemaType.STRING,
            description: 'Reason for cancellation if specified by user'
          }
        }
      }
    }
  ];

  /**
   * Executes tool call on behalf of Gemini for a specific session/user
   */
  public static async executeTool(
    sessionId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> {
    switch (toolName) {
      case 'search_zepto_products': {
        const query = args.query || '';

        // Use the local Kannada/Kanglish alias catalog to resolve the query to a canonical
        // English search term, then search Zepto's real inventory with that term. This keeps
        // Kannada understanding while ensuring the product actually ordered is a real one.
        const localMatches = zeptoStoreService.searchProducts(query);
        const resolvedQuery = localMatches.length > 0 ? localMatches[0].name : query;

        let results: Product[] = [];
        let live = false;

        if (zeptoLiveApiService.isConfigured()) {
          const liveResults = await zeptoLiveApiService.searchLiveProducts(resolvedQuery);
          if (liveResults.length > 0) {
            const localMatch = localMatches[0];
            results = liveResults.map((p) => ({
              id: p.id,
              name: p.name,
              kannadaName: localMatch?.kannadaName || p.name,
              category: localMatch?.category || 'Zepto',
              unit: p.unit,
              price: p.price,
              mrp: p.mrp,
              inStock: p.inStock,
              stockCount: p.inStock ? 1 : 0,
              brand: localMatch?.brand || '',
              kannadaAliases: localMatch?.kannadaAliases || [],
              imageUrl: p.imageUrl || '',
              isLive: true
            }));
            zeptoStoreService.cacheLiveProducts(results);
            live = true;
          }
        }

        if (results.length === 0) {
          // Fall back to the local demo catalog (no live account configured, or live search failed/empty)
          results = localMatches;
        }

        return {
          query,
          live,
          count: results.length,
          products: results.map((p) => ({
            id: p.id,
            name: p.name,
            kannadaName: p.kannadaName,
            brand: p.brand,
            unit: p.unit,
            price: p.price,
            mrp: p.mrp,
            inStock: p.inStock,
            live: p.isLive === true
          }))
        };
      }

      case 'get_product_details': {
        const product = zeptoStoreService.getProductById(args.productId);
        if (!product) return { error: `Product ${args.productId} not found` };
        return product;
      }

      case 'add_to_cart': {
        const productId = args.productId;
        const qty = Number(args.quantity) || 1;
        let cart: Cart;
        try {
          cart = zeptoStoreService.addToCart(sessionId, productId, qty);
        } catch (err: any) {
          return { status: 'FAILED', error: err.message };
        }
        return {
          status: 'SUCCESS',
          message: `Added ${qty} unit(s) of ${productId} to cart`,
          cartSummary: {
            totalItems: cart.items.length,
            items: cart.items.map((i) => ({
              id: i.product.id,
              name: i.product.name,
              qty: i.quantity,
              unitPrice: i.product.price,
              subtotal: i.product.price * i.quantity
            })),
            itemTotal: cart.itemTotal,
            discount: cart.discount,
            deliveryFee: cart.deliveryFee,
            grandTotal: cart.grandTotal
          }
        };
      }

      case 'get_cart': {
        const cart = zeptoStoreService.getOrCreateCart(sessionId);
        return {
          cart: {
            itemsCount: cart.items.length,
            items: cart.items.map((i) => ({
              id: i.product.id,
              name: i.product.name,
              kannadaName: i.product.kannadaName,
              quantity: i.quantity,
              unit: i.product.unit,
              unitPrice: i.product.price,
              totalPrice: i.product.price * i.quantity
            })),
            itemTotal: cart.itemTotal,
            discount: cart.discount,
            couponCode: cart.couponCode,
            deliveryFee: cart.deliveryFee,
            handlingFee: cart.handlingFee,
            grandTotal: cart.grandTotal,
            deliveryEtaMinutes: cart.deliveryEtaMinutes,
            deliveryAddress: cart.deliveryAddress
          }
        };
      }

      case 'update_cart_quantity': {
        const { productId, quantity } = args;
        const cart = zeptoStoreService.updateCartQuantity(sessionId, productId, Number(quantity));
        return {
          status: 'SUCCESS',
          message: `Updated ${productId} quantity to ${quantity}`,
          grandTotal: cart.grandTotal,
          totalItems: cart.items.length
        };
      }

      case 'remove_from_cart': {
        const { productId } = args;
        const cart = zeptoStoreService.removeFromCart(sessionId, productId);
        return {
          status: 'SUCCESS',
          message: `Removed ${productId} from cart`,
          grandTotal: cart.grandTotal,
          totalItems: cart.items.length
        };
      }

      case 'apply_coupon': {
        const { code } = args;
        return zeptoStoreService.applyCoupon(sessionId, code);
      }

      case 'place_order': {
        const cart = zeptoStoreService.getOrCreateCart(sessionId);
        if (cart.items.length === 0) {
          return {
            status: 'FAILED',
            error: 'Cart is empty. Please add items before placing an order.'
          };
        }

        const paymentMode = (args.paymentMode as 'UPI_ONLINE' | 'CASH_ON_DELIVERY') || 'UPI_ONLINE';
        const deliveryAddress = args.deliveryAddress || cart.deliveryAddress;

        // Real orders are only supported for Cash on Delivery right now - there is no
        // implemented live checkout path for online/UPI payment against Zepto's account.
        if (zeptoLiveApiService.isConfigured() && paymentMode === 'CASH_ON_DELIVERY') {
          const liveResult = await zeptoLiveApiService.placeLiveCodOrder(
            cart.items.map((i) => ({ productId: i.product.id, quantity: i.quantity }))
          );

          if (liveResult.success === false) {
            return {
              status: 'FAILED',
              error: `Could not place the order on your real Zepto account: ${liveResult.error}. Your Zepto session may have expired - ask Vyshak to relink the account.`
            };
          }

          const orderId = liveResult.orderId;
          const confirmation: PlacedOrder = {
            orderId,
            sessionId,
            status: 'CONFIRMED',
            cartSnapshot: JSON.parse(JSON.stringify(cart)),
            deliveryEtaMinutes: liveResult.deliveryEtaMinutes || 10,
            deliveryAddress,
            paymentMode: 'CASH_ON_DELIVERY',
            trackingUrl: liveResult.trackingUrl || `https://app.zeptonow.com/order/${orderId}`,
            placedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            estimatedDeliveryTime: new Date(Date.now() + (liveResult.deliveryEtaMinutes || 10) * 60000).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit'
            }),
            isLive: true
          };

          zeptoStoreService.savePlacedOrder(confirmation);
          zeptoStoreService.clearCart(sessionId);

          return {
            status: 'ORDER_PLACED_SUCCESSFULLY',
            orderDetails: confirmation
          };
        }

        // Demo/simulated path: no live Zepto account configured, or an online/UPI payment was
        // requested (not wired to a real Zepto checkout). Nothing is sent to Zepto here.
        const orderId = `ZP-${Math.floor(100000 + Math.random() * 900000)}`;

        let paymentLinks: PaymentLinks | undefined;
        if (paymentMode === 'UPI_ONLINE') {
          const itemsPayload = cart.items.map((i) => ({
            name: i.product.name,
            price: i.product.price,
            quantity: i.quantity
          }));
          paymentLinks = await upiPaymentService.generatePaymentLinks(
            orderId,
            cart.grandTotal,
            itemsPayload
          );
        }

        const confirmation: PlacedOrder = {
          orderId,
          sessionId,
          status: 'CONFIRMED',
          cartSnapshot: JSON.parse(JSON.stringify(cart)),
          deliveryEtaMinutes: 10,
          deliveryAddress,
          paymentMode,
          upiDeepLink: paymentLinks?.upiUri,
          trackingUrl: `https://zeptonow.com/order-tracking/${orderId}`,
          placedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          estimatedDeliveryTime: new Date(Date.now() + 10 * 60000).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          riderName: 'Manjunath K (Zepto Rider)',
          riderPhone: '+91 98450 12345',
          isLive: false
        };

        zeptoStoreService.savePlacedOrder(confirmation);
        // Reset cart for this session after placing order
        zeptoStoreService.clearCart(sessionId);

        return {
          status: 'ORDER_PLACED_SUCCESSFULLY',
          orderDetails: confirmation,
          paymentLinks,
          simulated: true,
          note: paymentMode === 'UPI_ONLINE' && zeptoLiveApiService.isConfigured()
            ? 'Real Zepto orders currently only work with Cash on Delivery; this UPI order was simulated, not sent to Zepto.'
            : 'No live Zepto account is linked; this order was simulated, not sent to Zepto.'
        };
      }

      case 'track_order': {
        const targetId = args.orderId || zeptoStoreService.getLastOrderForSession(sessionId)?.orderId;
        if (!targetId) {
          return { error: 'No recent orders found for this session.' };
        }
        const order = zeptoStoreService.getOrder(targetId);
        if (!order) {
          return { error: `Order ${targetId} not found.` };
        }

        if (order.isLive) {
          // Live order tracking isn't wired up to Zepto's API yet - don't fabricate rider/ETA info.
          return {
            orderId: order.orderId,
            status: order.status,
            deliveryAddress: order.deliveryAddress,
            trackingUrl: order.trackingUrl,
            note: 'This is a real Zepto order, but live tracking isn\'t connected yet - please check the Zepto app directly for rider and ETA status.'
          };
        }

        return {
          orderId: order.orderId,
          status: order.status,
          deliveryEtaMinutes: order.deliveryEtaMinutes,
          estimatedDeliveryTime: order.estimatedDeliveryTime,
          rider: { name: order.riderName, phone: order.riderPhone },
          deliveryAddress: order.deliveryAddress,
          trackingUrl: order.trackingUrl,
          note: 'This is a simulated demo order, not a real Zepto order.'
        };
      }

      case 'cancel_order': {
        const targetId = args.orderId || zeptoStoreService.getLastOrderForSession(sessionId)?.orderId;
        if (!targetId) {
          return { success: false, message: 'No active orders found to cancel.' };
        }
        const order = zeptoStoreService.getOrder(targetId);
        if (order?.isLive) {
          return {
            success: false,
            message: 'This is a real Zepto order, but live cancellation isn\'t connected yet - please cancel it directly in the Zepto app.'
          };
        }
        const result = zeptoStoreService.cancelOrder(targetId);
        return {
          ...result,
          reason: args.reason
        };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
