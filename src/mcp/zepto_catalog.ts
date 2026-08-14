export interface Product {
  id: string;
  name: string;
  kannadaName: string;
  category: 'Dairy & Bread' | 'Vegetables & Fruits' | 'Atta, Rice & Dal' | 'Masala & Spices' | 'Breakfast & Snacks' | 'Household';
  unit: string;
  price: number;
  mrp: number;
  inStock: boolean;
  stockCount: number;
  brand: string;
  kannadaAliases: string[];
  imageUrl: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  sessionId: string;
  items: CartItem[];
  itemTotal: number;
  discount: number;
  couponCode?: string;
  deliveryFee: number;
  handlingFee: number;
  grandTotal: number;
  deliveryEtaMinutes: number;
  deliveryAddress: string;
}

export interface PlacedOrder {
  orderId: string;
  sessionId: string;
  status: 'CONFIRMED' | 'PACKING' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  cartSnapshot: Cart;
  deliveryEtaMinutes: number;
  deliveryAddress: string;
  paymentMode: 'UPI_ONLINE' | 'CASH_ON_DELIVERY';
  upiDeepLink?: string;
  trackingUrl: string;
  placedAt: string;
  estimatedDeliveryTime: string;
  riderName: string;
  riderPhone: string;
}

export const ZEPTO_PRODUCT_CATALOG: Product[] = [
  // --- Dairy & Bread ---
  {
    id: 'prod-milk-nandini-toned',
    name: 'Nandini Pasteurised Toned Milk (Blue)',
    kannadaName: 'ನಂದಿನಿ ಟೋನ್ಡ್ ಹಾಲು (Nandini Toned Halu)',
    category: 'Dairy & Bread',
    unit: '500 ml',
    price: 24,
    mrp: 24,
    inStock: true,
    stockCount: 45,
    brand: 'Nandini (KMF)',
    kannadaAliases: ['halu', 'haalu', 'blue milk', 'nandini blue', 'toned milk', 'nandini halu', 'milk'],
    imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-milk-nandini-shubham',
    name: 'Nandini Shubham Full Cream Milk (Orange)',
    kannadaName: 'ನಂದಿನಿ ಶುಭಂ ಹಾಲು (Nandini Shubham Halu)',
    category: 'Dairy & Bread',
    unit: '500 ml',
    price: 27,
    mrp: 27,
    inStock: true,
    stockCount: 20,
    brand: 'Nandini (KMF)',
    kannadaAliases: ['shubham milk', 'orange milk', 'full cream milk', 'shubham halu', 'thick milk'],
    imageUrl: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-curd-nandini-500g',
    name: 'Nandini Fresh Curd / Dahi Pouch',
    kannadaName: 'ನಂದಿನಿ ಮೊಸರು (Nandini Mosaru)',
    category: 'Dairy & Bread',
    unit: '500 g',
    price: 26,
    mrp: 26,
    inStock: true,
    stockCount: 30,
    brand: 'Nandini (KMF)',
    kannadaAliases: ['mosaru', 'mossaru', 'curd', 'dahi', 'nandini mosaru', 'nandini curd'],
    imageUrl: 'https://images.unsplash.com/photo-1571212515416-fef01fc43637?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-butter-amul-100g',
    name: 'Amul Pasteurised Salted Butter',
    kannadaName: 'ಅಮುಲ್ ಬೆಣ್ಣೆ (Amul Benne)',
    category: 'Dairy & Bread',
    unit: '100 g',
    price: 58,
    mrp: 60,
    inStock: true,
    stockCount: 25,
    brand: 'Amul',
    kannadaAliases: ['benne', 'butter', 'amul butter', 'amul benne', 'salted butter'],
    imageUrl: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-ghee-nandini-200ml',
    name: 'Nandini Pure Cow Ghee',
    kannadaName: 'ನಂದಿನಿ ಶುದ್ಧ ತುಪ್ಪ (Nandini Shuddha Tuppa)',
    category: 'Dairy & Bread',
    unit: '200 ml',
    price: 135,
    mrp: 140,
    inStock: true,
    stockCount: 15,
    brand: 'Nandini (KMF)',
    kannadaAliases: ['tuppa', 'ghee', 'nandini tuppa', 'cow ghee', 'neyyi'],
    imageUrl: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-bread-modern-wheat',
    name: 'Modern 100% Whole Wheat Bread',
    kannadaName: 'ಮಾಡರ್ನ್ ಗೋಧಿ ಬ್ರೆಡ್ (Modern Godhi Bread)',
    category: 'Dairy & Bread',
    unit: '400 g',
    price: 45,
    mrp: 50,
    inStock: true,
    stockCount: 18,
    brand: 'Modern',
    kannadaAliases: ['bread', 'godhi bread', 'wheat bread', 'brown bread', 'rotti bread'],
    imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-eggs-country-6pack',
    name: 'Fresho Farm Fresh White Eggs (Pack of 6)',
    kannadaName: 'ಮೊಟ್ಟೆ (Motte / Thatti - 6 Pieces)',
    category: 'Dairy & Bread',
    unit: '6 units',
    price: 48,
    mrp: 55,
    inStock: true,
    stockCount: 40,
    brand: 'Fresho',
    kannadaAliases: ['motte', 'thatte', 'tatti', 'eggs', 'egg', 'baidda', 'koli motte'],
    imageUrl: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-paneer-milky-mist-200g',
    name: 'Milky Mist Fresh Paneer Block',
    kannadaName: 'ಮಿಲ್ಕಿ ಮಿಸ್ಟ್ ಪನೀರ್ (Milky Mist Paneer)',
    category: 'Dairy & Bread',
    unit: '200 g',
    price: 89,
    mrp: 95,
    inStock: true,
    stockCount: 22,
    brand: 'Milky Mist',
    kannadaAliases: ['paneer', 'cottage cheese', 'milky mist paneer'],
    imageUrl: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=200&auto=format&fit=crop&q=60'
  },

  // --- Vegetables & Fresh Herbs ---
  {
    id: 'prod-veg-coriander-100g',
    name: 'Fresh Green Coriander Leaves (Kottambari)',
    kannadaName: 'ಕೊತ್ತಂಬರಿ ಸೊಪ್ಪು (Kottambari Soppu)',
    category: 'Vegetables & Fruits',
    unit: '100 g bunch',
    price: 12,
    mrp: 15,
    inStock: true,
    stockCount: 50,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['kottambari', 'kothambari', 'kothmir', 'coriander', 'soppu', 'dhaniya', 'kottambari soppu'],
    imageUrl: 'https://images.unsplash.com/photo-1526344966-89049886b28d?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-veg-curry-leaves-50g',
    name: 'Fresh Curry Leaves (Karibevu)',
    kannadaName: 'ಕರಿಬೇವು (Karibevu Soppu)',
    category: 'Vegetables & Fruits',
    unit: '50 g bunch',
    price: 8,
    mrp: 10,
    inStock: true,
    stockCount: 50,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['karibevu', 'karivepaku', 'curry leaves', 'kadi patta'],
    imageUrl: 'https://images.unsplash.com/photo-1628556270448-4d4e4148e1b1?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-veg-onion-1kg',
    name: 'Fresh Hybrid Onion (Eerulli)',
    kannadaName: 'ಈರುಳ್ಳಿ (Eerulli / Kanda)',
    category: 'Vegetables & Fruits',
    unit: '1 kg',
    price: 38,
    mrp: 45,
    inStock: true,
    stockCount: 60,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['eerulli', 'irulli', 'onion', 'onions', 'pyaz', 'kanda', 'erulli'],
    imageUrl: 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-veg-tomato-1kg',
    name: 'Fresh Local Tomato (Tomato)',
    kannadaName: 'ಟೊಮ್ಯಾಟೊ (Tomato)',
    category: 'Vegetables & Fruits',
    unit: '1 kg',
    price: 32,
    mrp: 40,
    inStock: true,
    stockCount: 75,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['tomato', 'tamata', 'tomatoes', 'tamatar'],
    imageUrl: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-veg-potato-1kg',
    name: 'Fresh Jyoti Potato (Alugadde)',
    kannadaName: 'ಆಲೂಗಡ್ಡೆ (Alugadde / Batata)',
    category: 'Vegetables & Fruits',
    unit: '1 kg',
    price: 35,
    mrp: 42,
    inStock: true,
    stockCount: 60,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['alugadde', 'aloo', 'potato', 'potatoes', 'batata', 'alu'],
    imageUrl: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-veg-ginger-100g',
    name: 'Fresh Organic Ginger (Shunti)',
    kannadaName: 'ಶುಂಠಿ (Shunti / Adrak)',
    category: 'Vegetables & Fruits',
    unit: '100 g',
    price: 18,
    mrp: 22,
    inStock: true,
    stockCount: 35,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['shunti', 'sunti', 'ginger', 'adrak'],
    imageUrl: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-veg-green-chilli-100g',
    name: 'Fresh Spicy Green Chillies (Hasi Menasinakayi)',
    kannadaName: 'ಹಸಿ ಮೆಣಸಿನಕಾಯಿ (Hasi Menasinakayi)',
    category: 'Vegetables & Fruits',
    unit: '100 g',
    price: 14,
    mrp: 18,
    inStock: true,
    stockCount: 40,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['menasinakayi', 'hasi menasina kayi', 'chilli', 'green chilli', 'mirchi', 'menasu'],
    imageUrl: 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-fruit-banana-robusta-500g',
    name: 'Fresh Robusta Banana (Bale Hannu)',
    kannadaName: 'ಬಾಳೆಹಣ್ಣು (Bale Hannu - 500g)',
    category: 'Vegetables & Fruits',
    unit: '500 g (3-4 pcs)',
    price: 32,
    mrp: 38,
    inStock: true,
    stockCount: 30,
    brand: 'Zepto Fresh Farm',
    kannadaAliases: ['bale hannu', 'balehannu', 'banana', 'kela', 'robusta banana'],
    imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200&auto=format&fit=crop&q=60'
  },

  // --- Atta, Rice & Dal ---
  {
    id: 'prod-atta-aashirvaad-5kg',
    name: 'Aashirvaad Superior MP Sharbati Whole Wheat Atta',
    kannadaName: 'ಆಶೀರ್ವಾದ್ ಗೋಧಿ ಹಿಟ್ಟು (Aashirvaad Godhi Hittu - 5kg)',
    category: 'Atta, Rice & Dal',
    unit: '5 kg',
    price: 275,
    mrp: 310,
    inStock: true,
    stockCount: 20,
    brand: 'Aashirvaad',
    kannadaAliases: ['atta', 'godhi hittu', 'aashirvaad atta', 'wheat flour', 'hittu', 'chapati hittu'],
    imageUrl: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-rice-sona-masoori-5kg',
    name: 'Royal Bullet Sona Masoori Raw Rice',
    kannadaName: 'ಸೋನಾ ಮಸೂರಿ ಅಕ್ಕಿ (Sona Masoori Akki - 5kg)',
    category: 'Atta, Rice & Dal',
    unit: '5 kg',
    price: 330,
    mrp: 375,
    inStock: true,
    stockCount: 15,
    brand: 'Royal Bullet',
    kannadaAliases: ['akki', 'rice', 'sona masoori', 'sona masuri', 'anna', 'chawal'],
    imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-dal-toor-fortune-1kg',
    name: 'Fortune Unpolished Toor Dal / Arhar Dal',
    kannadaName: 'ತೊಗರಿ ಬೇಳೆ (Togari Bele - 1kg)',
    category: 'Atta, Rice & Dal',
    unit: '1 kg',
    price: 165,
    mrp: 185,
    inStock: true,
    stockCount: 25,
    brand: 'Fortune',
    kannadaAliases: ['togari bele', 'toor dal', 'arhar dal', 'bele', 'sambar dal', 'daal'],
    imageUrl: 'https://images.unsplash.com/photo-1585994192701-f1a505c817ea?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-dal-urad-tata-500g',
    name: 'Tata Sampann Unpolished Urad Dal (Gulla)',
    kannadaName: 'ಉದ್ದಿನ ಬೇಳೆ (Uddina Bele - 500g)',
    category: 'Atta, Rice & Dal',
    unit: '500 g',
    price: 88,
    mrp: 98,
    inStock: true,
    stockCount: 20,
    brand: 'Tata Sampann',
    kannadaAliases: ['uddina bele', 'urad dal', 'idli bele', 'black gram'],
    imageUrl: 'https://images.unsplash.com/photo-1585994192701-f1a505c817ea?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-dal-moong-tata-500g',
    name: 'Tata Sampann Yellow Moong Dal',
    kannadaName: 'ಹೆಸರು ಬೇಳೆ (Hesaru Bele - 500g)',
    category: 'Atta, Rice & Dal',
    unit: '500 g',
    price: 78,
    mrp: 88,
    inStock: true,
    stockCount: 18,
    brand: 'Tata Sampann',
    kannadaAliases: ['hesaru bele', 'moong dal', 'hesarubele', 'yellow dal'],
    imageUrl: 'https://images.unsplash.com/photo-1585994192701-f1a505c817ea?w=200&auto=format&fit=crop&q=60'
  },

  // --- Masala, Spices & Oil ---
  {
    id: 'prod-oil-sunflower-fortune-1l',
    name: 'Fortune Sunlite Refined Sunflower Oil',
    kannadaName: 'ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ (Suryakanti Enne / Cooking Oil - 1L)',
    category: 'Masala & Spices',
    unit: '1 Litre Pouch',
    price: 132,
    mrp: 150,
    inStock: true,
    stockCount: 30,
    brand: 'Fortune',
    kannadaAliases: ['enne', 'oil', 'sunflower oil', 'cooking oil', 'fortune oil', 'suryakanti enne'],
    imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-masala-mtr-sambar-100g',
    name: 'MTR Traditional Karnataka Sambar Powder',
    kannadaName: 'ಎಂ.ಟಿ.ಆರ್ ಸಾಂಬಾರ್ ಪುಡಿ (MTR Sambar Pudi)',
    category: 'Masala & Spices',
    unit: '100 g',
    price: 44,
    mrp: 48,
    inStock: true,
    stockCount: 25,
    brand: 'MTR',
    kannadaAliases: ['sambar pudi', 'sambar powder', 'mtr sambar', 'saaru pudi'],
    imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-spice-mustard-100g',
    name: 'Catch Small Mustard Seeds (Sasive)',
    kannadaName: 'ಸಾಸಿವೆ (Sasive / Rai)',
    category: 'Masala & Spices',
    unit: '100 g',
    price: 22,
    mrp: 26,
    inStock: true,
    stockCount: 30,
    brand: 'Catch',
    kannadaAliases: ['sasive', 'mustard', 'rai', 'sasuve'],
    imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-spice-cumin-100g',
    name: 'Catch Whole Cumin Seeds (Jeerige)',
    kannadaName: 'ಜೀರಿಗೆ (Jeerige / Jeera)',
    category: 'Masala & Spices',
    unit: '100 g',
    price: 42,
    mrp: 50,
    inStock: true,
    stockCount: 28,
    brand: 'Catch',
    kannadaAliases: ['jeerige', 'jeera', 'cumin', 'zeera'],
    imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=200&auto=format&fit=crop&q=60'
  },

  // --- Breakfast & Beverages ---
  {
    id: 'prod-tea-redlabel-500g',
    name: 'Brooke Bond Red Label Strong Tea',
    kannadaName: 'ರೆಡ್ ಲೇಬಲ್ ಚಹಾ ಪುಡಿ (Red Label Tea Pudi - 500g)',
    category: 'Breakfast & Snacks',
    unit: '500 g',
    price: 245,
    mrp: 280,
    inStock: true,
    stockCount: 22,
    brand: 'Red Label',
    kannadaAliases: ['tea', 'cha', 'chai', 'tea pudi', 'red label', 'tea powder'],
    imageUrl: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-coffee-bru-200g',
    name: 'BRU Instant Filter Mixed Coffee Powder',
    kannadaName: 'ಬ್ರೂ ಕಾಫಿ ಪುಡಿ (BRU Coffee Pudi - 200g)',
    category: 'Breakfast & Snacks',
    unit: '200 g',
    price: 195,
    mrp: 220,
    inStock: true,
    stockCount: 18,
    brand: 'BRU',
    kannadaAliases: ['coffee', 'kaapi', 'bru', 'coffee pudi', 'instant coffee'],
    imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=200&auto=format&fit=crop&q=60'
  },
  {
    id: 'prod-idli-batter-id-1kg',
    name: 'iD Fresh Natural Idly & Dosa Batter',
    kannadaName: 'ಐಡಿ ಇಡ್ಲಿ ದೋಸೆ ಹಿಟ್ಟು (iD Idli & Dosa Batter - 1kg)',
    category: 'Breakfast & Snacks',
    unit: '1 kg',
    price: 75,
    mrp: 85,
    inStock: true,
    stockCount: 30,
    brand: 'iD Fresh',
    kannadaAliases: ['idli batter', 'dosa batter', 'dosa hittu', 'idli hittu', 'id fresh'],
    imageUrl: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=200&auto=format&fit=crop&q=60'
  }
];

export class ZeptoStoreService {
  private activeCarts: Map<string, Cart> = new Map();
  private placedOrders: Map<string, PlacedOrder> = new Map();

  public searchProducts(query: string): Product[] {
    if (!query || typeof query !== 'string') {
      return ZEPTO_PRODUCT_CATALOG.slice(0, 10);
    }

    const cleanQuery = query.toLowerCase().trim();
    const tokens = cleanQuery.split(/[\s,+-]+/).filter((t) => t.length > 0);

    return ZEPTO_PRODUCT_CATALOG.filter((product) => {
      const allText = [
        product.name.toLowerCase(),
        product.kannadaName.toLowerCase(),
        product.brand.toLowerCase(),
        product.category.toLowerCase(),
        ...product.kannadaAliases.map((a) => a.toLowerCase())
      ].join(' ');

      if (product.kannadaAliases.some((alias) => alias.includes(cleanQuery) || cleanQuery.includes(alias))) {
        return true;
      }

      return tokens.some((token) => token.length >= 2 && allText.includes(token));
    });
  }

  public getProductById(id: string): Product | undefined {
    return ZEPTO_PRODUCT_CATALOG.find((p) => p.id === id);
  }

  public getOrCreateCart(sessionId: string): Cart {
    if (!this.activeCarts.has(sessionId)) {
      this.activeCarts.set(sessionId, {
        sessionId,
        items: [],
        itemTotal: 0,
        discount: 0,
        deliveryFee: 15,
        handlingFee: 5,
        grandTotal: 20,
        deliveryEtaMinutes: 10,
        deliveryAddress: process.env.DEFAULT_DELIVERY_ADDRESS || 'Flat 302, Green Glen Layout, Bellandur, Bengaluru - 560103'
      });
    }
    return this.activeCarts.get(sessionId)!;
  }

  private recalculateCart(cart: Cart): Cart {
    const itemTotal = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const deliveryFee = itemTotal >= 199 || itemTotal === 0 ? 0 : 15;
    const handlingFee = itemTotal > 0 ? 5 : 0;
    const subtotal = Math.max(0, itemTotal - (cart.discount || 0));
    const grandTotal = itemTotal === 0 ? 0 : subtotal + deliveryFee + handlingFee;

    cart.itemTotal = itemTotal;
    cart.deliveryFee = deliveryFee;
    cart.handlingFee = handlingFee;
    cart.grandTotal = grandTotal;
    return cart;
  }

  public addToCart(sessionId: string, productId: string, quantity: number = 1): Cart {
    const cart = this.getOrCreateCart(sessionId);
    const product = this.getProductById(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found in Zepto catalog`);
    }

    const existingItem = cart.items.find((item) => item.product.id === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ product, quantity });
    }

    return this.recalculateCart(cart);
  }

  public updateCartQuantity(sessionId: string, productId: string, newQuantity: number): Cart {
    const cart = this.getOrCreateCart(sessionId);
    if (newQuantity <= 0) {
      return this.removeFromCart(sessionId, productId);
    }

    const existingItem = cart.items.find((item) => item.product.id === productId);
    if (existingItem) {
      existingItem.quantity = newQuantity;
    } else {
      const product = this.getProductById(productId);
      if (product) {
        cart.items.push({ product, quantity: newQuantity });
      }
    }

    return this.recalculateCart(cart);
  }

  public removeFromCart(sessionId: string, productId: string): Cart {
    const cart = this.getOrCreateCart(sessionId);
    cart.items = cart.items.filter((item) => item.product.id !== productId);
    return this.recalculateCart(cart);
  }

  public applyCoupon(sessionId: string, code: string): { success: boolean; message: string; cart: Cart } {
    const cart = this.getOrCreateCart(sessionId);
    const upper = code.toUpperCase().trim();

    if (upper === 'ZEPTO50' || upper === 'AMMA50') {
      cart.discount = 50;
      cart.couponCode = upper;
      this.recalculateCart(cart);
      return { success: true, message: `Applied coupon ${upper} (₹50 discount)!`, cart };
    } else if (upper === 'FREESHIP') {
      cart.discount = cart.deliveryFee;
      cart.couponCode = upper;
      this.recalculateCart(cart);
      return { success: true, message: `Applied free delivery coupon!`, cart };
    }

    return { success: false, message: `Invalid coupon code "${code}". Try ZEPTO50 or AMMA50`, cart };
  }

  public clearCart(sessionId: string): Cart {
    const cart = this.getOrCreateCart(sessionId);
    cart.items = [];
    cart.discount = 0;
    cart.couponCode = undefined;
    return this.recalculateCart(cart);
  }

  public savePlacedOrder(order: PlacedOrder): void {
    this.placedOrders.set(order.orderId, order);
  }

  public getOrder(orderId: string): PlacedOrder | undefined {
    return this.placedOrders.get(orderId);
  }

  public getLastOrderForSession(sessionId: string): PlacedOrder | undefined {
    const orders = Array.from(this.placedOrders.values()).filter((o) => o.sessionId === sessionId);
    return orders.length > 0 ? orders[orders.length - 1] : undefined;
  }

  public cancelOrder(orderId: string): { success: boolean; message: string; order?: PlacedOrder } {
    const order = this.placedOrders.get(orderId);
    if (!order) {
      return { success: false, message: `Order #${orderId} not found.` };
    }
    if (order.status === 'DELIVERED') {
      return { success: false, message: `Order #${orderId} has already been delivered and cannot be cancelled.` };
    }
    if (order.status === 'CANCELLED') {
      return { success: false, message: `Order #${orderId} is already cancelled.` };
    }

    order.status = 'CANCELLED';
    this.placedOrders.set(orderId, order);
    return {
      success: true,
      message: `Order #${orderId} has been successfully cancelled. Any online payment will be refunded to your source UPI within 2 hours.`,
      order
    };
  }
}

export const zeptoStoreService = new ZeptoStoreService();
