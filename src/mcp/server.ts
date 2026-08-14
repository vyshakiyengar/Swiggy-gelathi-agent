import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { zeptoStoreService, PlacedOrder } from './zepto_catalog';
import { upiPaymentService } from '../payment/upi';

export const ZEPTO_MCP_TOOLS: Tool[] = [
  {
    name: 'search_zepto_products',
    description:
      'Search Zepto grocery catalog for vegetables, milk, dairy, staples, snacks, fruits with multilingual Kannada/Kanglish/English search keywords (e.g. nandini halu, kottambari soppu, curd, bread, eggs, atta, toor dal, onion).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product name or keyword in English or Kannada (e.g. "nandini toned milk", "kottambari", "curd", "eggs")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_product_details',
    description: 'Get full product details including unit size, price, MRP, category, brand, and stock status by productId.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: {
          type: 'string',
          description: 'Unique product ID (e.g. prod-milk-nandini-toned)'
        }
      },
      required: ['productId']
    }
  },
  {
    name: 'add_to_cart',
    description: 'Add a grocery item and quantity to the user\'s active Zepto cart.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'User phone number or session ID (e.g. 919876543210)'
        },
        productId: {
          type: 'string',
          description: 'Exact product ID returned from search_zepto_products'
        },
        quantity: {
          type: 'number',
          description: 'Number of packs/packets/units to add (default 1)'
        }
      },
      required: ['sessionId', 'productId']
    }
  },
  {
    name: 'get_cart',
    description: 'Retrieve current active cart items, itemized subtotals, applied discount, delivery fee, handling fee, and grand total.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'User phone number or session ID'
        }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'update_cart_quantity',
    description: 'Update the quantity of an item in the cart, or remove it if new quantity is 0.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'User phone number or session ID'
        },
        productId: {
          type: 'string',
          description: 'Product ID in cart'
        },
        quantity: {
          type: 'number',
          description: 'New quantity desired'
        }
      },
      required: ['sessionId', 'productId', 'quantity']
    }
  },
  {
    name: 'remove_from_cart',
    description: 'Remove a specific grocery product entirely from the Zepto cart.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'User phone number or session ID'
        },
        productId: {
          type: 'string',
          description: 'Product ID to remove'
        }
      },
      required: ['sessionId', 'productId']
    }
  },
  {
    name: 'apply_coupon',
    description: 'Apply a promotional discount coupon code (e.g. ZEPTO50, AMMA50, FREESHIP) to the cart.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'User phone number or session ID'
        },
        code: {
          type: 'string',
          description: 'Coupon promo code string'
        }
      },
      required: ['sessionId', 'code']
    }
  },
  {
    name: 'place_order',
    description: 'Finalize and place the Zepto grocery order. Generates order ID, instant UPI intent deep links (for WhatsApp Pay / GPay / PhonePe / Paytm), Cash on Delivery mode, rider assignment, and 10-minute delivery tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'User phone number or session ID'
        },
        paymentMode: {
          type: 'string',
          enum: ['UPI_ONLINE', 'CASH_ON_DELIVERY'],
          description: 'Payment mode: "UPI_ONLINE" or "CASH_ON_DELIVERY"'
        },
        deliveryAddress: {
          type: 'string',
          description: 'Custom delivery address if requested'
        }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'track_order',
    description: 'Get real-time delivery status, rider ETA, and tracking link for a placed Zepto order.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'Zepto order ID (e.g. ZP-123456)'
        }
      },
      required: ['orderId']
    }
  }
];

/**
 * Creates and configures the standard Model Context Protocol (MCP) Server
 */
export function createZeptoMcpServer(): Server {
  const server = new Server(
    {
      name: 'zepto-grocery-mcp-server',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Expose tool list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ZEPTO_MCP_TOOLS
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args || {}) as Record<string, any>;
    const sessionId = safeArgs.sessionId || 'default_user_session';

    try {
      let result: any;

      switch (name) {
        case 'search_zepto_products': {
          const query = safeArgs.query || '';
          const products = zeptoStoreService.searchProducts(query);
          result = {
            query,
            totalFound: products.length,
            products: products.map((p) => ({
              id: p.id,
              name: p.name,
              kannadaName: p.kannadaName,
              brand: p.brand,
              unit: p.unit,
              price: p.price,
              mrp: p.mrp,
              inStock: p.inStock
            }))
          };
          break;
        }

        case 'get_product_details': {
          const productId = safeArgs.productId;
          const product = zeptoStoreService.getProductById(productId);
          if (!product) {
            result = { error: `Product not found: ${productId}` };
          } else {
            result = product;
          }
          break;
        }

        case 'add_to_cart': {
          const { productId, quantity = 1 } = safeArgs;
          const cart = zeptoStoreService.addToCart(sessionId, productId, Number(quantity));
          result = {
            status: 'SUCCESS',
            message: `Added ${quantity} unit(s) of ${productId}`,
            cart: {
              itemsCount: cart.items.length,
              itemTotal: cart.itemTotal,
              discount: cart.discount,
              deliveryFee: cart.deliveryFee,
              handlingFee: cart.handlingFee,
              grandTotal: cart.grandTotal,
              items: cart.items.map((i) => ({
                id: i.product.id,
                name: i.product.name,
                kannadaName: i.product.kannadaName,
                quantity: i.quantity,
                unit: i.product.unit,
                unitPrice: i.product.price,
                subtotal: i.product.price * i.quantity
              }))
            }
          };
          break;
        }

        case 'get_cart': {
          const cart = zeptoStoreService.getOrCreateCart(sessionId);
          result = {
            itemsCount: cart.items.length,
            itemTotal: cart.itemTotal,
            discount: cart.discount,
            couponCode: cart.couponCode,
            deliveryFee: cart.deliveryFee,
            handlingFee: cart.handlingFee,
            grandTotal: cart.grandTotal,
            deliveryEtaMinutes: cart.deliveryEtaMinutes,
            deliveryAddress: cart.deliveryAddress,
            items: cart.items.map((i) => ({
              id: i.product.id,
              name: i.product.name,
              kannadaName: i.product.kannadaName,
              quantity: i.quantity,
              unit: i.product.unit,
              unitPrice: i.product.price,
              subtotal: i.product.price * i.quantity
            }))
          };
          break;
        }

        case 'update_cart_quantity': {
          const { productId, quantity } = safeArgs;
          const cart = zeptoStoreService.updateCartQuantity(sessionId, productId, Number(quantity));
          result = {
            status: 'SUCCESS',
            message: `Updated ${productId} quantity to ${quantity}`,
            grandTotal: cart.grandTotal,
            totalItems: cart.items.length
          };
          break;
        }

        case 'remove_from_cart': {
          const { productId } = safeArgs;
          const cart = zeptoStoreService.removeFromCart(sessionId, productId);
          result = {
            status: 'SUCCESS',
            message: `Removed ${productId} from cart`,
            grandTotal: cart.grandTotal,
            totalItems: cart.items.length
          };
          break;
        }

        case 'apply_coupon': {
          const { code } = safeArgs;
          result = zeptoStoreService.applyCoupon(sessionId, code);
          break;
        }

        case 'place_order': {
          const cart = zeptoStoreService.getOrCreateCart(sessionId);
          if (cart.items.length === 0) {
            result = {
              status: 'FAILED',
              error: 'Cart is empty. Please add grocery items first before placing order.'
            };
            break;
          }

          const paymentMode = (safeArgs.paymentMode as 'UPI_ONLINE' | 'CASH_ON_DELIVERY') || 'UPI_ONLINE';
          const deliveryAddress = safeArgs.deliveryAddress || cart.deliveryAddress;
          const orderId = `ZP-${Math.floor(100000 + Math.random() * 900000)}`;

          let paymentLinks: any;
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

          const placedOrder: PlacedOrder = {
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
            riderPhone: '+91 98450 12345'
          };

          zeptoStoreService.savePlacedOrder(placedOrder);
          // Clear active cart after placing order
          zeptoStoreService.clearCart(sessionId);

          result = {
            status: 'ORDER_PLACED_SUCCESSFULLY',
            orderDetails: placedOrder,
            paymentLinks
          };
          break;
        }

        case 'track_order': {
          const { orderId } = safeArgs;
          const order = zeptoStoreService.getOrder(orderId);
          if (!order) {
            result = {
              error: `Order ${orderId} not found.`
            };
          } else {
            result = {
              orderId: order.orderId,
              status: order.status,
              deliveryEtaMinutes: order.deliveryEtaMinutes,
              estimatedDeliveryTime: order.estimatedDeliveryTime,
              rider: {
                name: order.riderName,
                phone: order.riderPhone
              },
              deliveryAddress: order.deliveryAddress,
              trackingUrl: order.trackingUrl
            };
          }
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Tool execution error: ${err.message}`
          }
        ]
      };
    }
  });

  return server;
}
