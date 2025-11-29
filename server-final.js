// server.js - Auto-Generated Bot System
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Storage
const oauthStates = new Map();
const connectedStores = new Map(); // Store: { shop, accessToken, businessId, botScript }

// Config
const API_VERSION = "2024-10";
const BASE_URL = process.env.BASE_URL || "https://zocie.onrender.com";
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// Validate config
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.error('❌ Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET');
}

// =====================================================
// OAUTH FLOW - Auto-Bot Generation
// =====================================================

app.get("/api/shopify/auth/start", (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: "Shop parameter required" });
  }

  if (!SHOPIFY_API_KEY) {
    return res.status(500).json({ 
      error: "SHOPIFY_API_KEY not configured" 
    });
  }

  const state = Math.random().toString(36).substring(2, 15) + 
                Math.random().toString(36).substring(2, 15);
  
  oauthStates.set(state, { shop, timestamp: Date.now() });
  
  const redirectUri = `${BASE_URL}/api/shopify/auth/callback`;
  const scopes = 'read_products,read_orders,read_draft_orders';
  
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}&` +
    `scope=${scopes}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`;

  console.log('🔗 OAuth started for:', shop);
  res.json({ authUrl, state });
});

app.get("/api/shopify/auth/callback", async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    console.log('📥 OAuth callback for:', shop);

    // Verify state
    if (!oauthStates.has(state)) {
      return res.status(403).send("Invalid state - please try again");
    }

    const stateData = oauthStates.get(state);
    if (Date.now() - stateData.timestamp > 600000) {
      oauthStates.delete(state);
      return res.status(403).send("State expired - please try again");
    }

    oauthStates.delete(state);

    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token exchange failed:', errorText);
      throw new Error('Token exchange failed');
    }

    const { access_token } = await tokenResponse.json();

    if (!access_token) {
      throw new Error("No access token received");
    }

    console.log('✅ Access token obtained for:', shop);

    // Generate unique business ID
    const businessId = `shop_${shop.replace('.myshopify.com', '')}`;

    // ====================================================
    // 🚀 AUTO-ANALYZE STORE & GENERATE BOT
    // ====================================================
    
    console.log('🔍 Analyzing store:', shop);
    
    // Fetch store data
    const storeData = await analyzeStore(shop, access_token);
    
    console.log('🤖 Generating bot script...');
    
    // Generate bot script
    const botScript = generateZoBotScript(shop, businessId, storeData);
    
    // Store configuration
    connectedStores.set(businessId, {
      shop,
      accessToken: access_token,
      businessId,
      botScript,
      storeData,
      connectedAt: new Date().toISOString()
    });

    console.log('✅ Bot generated successfully!');

    // Redirect to success page with businessId
    res.redirect(`/success.html?businessId=${businessId}&shop=${shop}`);

  } catch (error) {
    console.error('❌ OAuth error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Failed</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gradient-to-br from-red-50 to-orange-50 min-h-screen flex items-center justify-center">
        <div class="bg-white rounded-2xl shadow-2xl p-12 text-center max-w-xl">
          <div class="text-6xl mb-6">❌</div>
          <h1 class="text-3xl font-bold text-gray-800 mb-4">Connection Failed</h1>
          <p class="text-gray-600 mb-6">${error.message}</p>
          <a href="/" class="inline-block bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold">
            Try Again
          </a>
        </div>
      </body>
      </html>
    `);
  }
});

// =====================================================
// STORE ANALYSIS - Auto-detect features
// =====================================================

async function analyzeStore(shop, accessToken) {
  const storeData = {
    products: [],
    categories: [],
    features: [],
    totalProducts: 0,
    hasOrders: false
  };

  try {
    // Fetch products
    const productsResponse = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/products.json?limit=10`,
      {
        headers: { 
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (productsResponse.ok) {
      const { products } = await productsResponse.json();
      storeData.products = products || [];
      storeData.totalProducts = products?.length || 0;

      // Extract categories
      const productTypes = [...new Set(products.map(p => p.product_type).filter(Boolean))];
      storeData.categories = productTypes.slice(0, 5);

      // Detect features
      storeData.features = detectStoreFeatures(products);
    }

    // Check for orders (lightweight check)
    const ordersResponse = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/orders.json?limit=1`,
      {
        headers: { 
          'X-Shopify-Access-Token': accessToken 
        }
      }
    );

    if (ordersResponse.ok) {
      const { orders } = await ordersResponse.json();
      storeData.hasOrders = orders && orders.length > 0;
    }

  } catch (error) {
    console.error('Error analyzing store:', error);
  }

  return storeData;
}

function detectStoreFeatures(products) {
  const features = [
    { name: 'Product Browsing', enabled: true, reason: 'Products detected' },
    { name: 'Order Tracking', enabled: true, reason: 'Always enabled' }
  ];

  if (products && products.length > 0) {
    // Check for variants
    const hasVariants = products.some(p => p.variants && p.variants.length > 1);
    if (hasVariants) {
      features.push({ 
        name: 'Size/Color Selection', 
        enabled: true, 
        reason: 'Variants detected' 
      });
    }

    // Check for images
    const hasImages = products.some(p => p.images && p.images.length > 0);
    if (hasImages) {
      features.push({ 
        name: 'Visual Product Cards', 
        enabled: true, 
        reason: 'Product images found' 
      });
    }

    // Check for discounts
    const hasDiscounts = products.some(p => 
      p.variants && p.variants.some(v => v.compare_at_price && v.compare_at_price > v.price)
    );
    if (hasDiscounts) {
      features.push({ 
        name: 'Deals & Discounts', 
        enabled: true, 
        reason: 'Sale prices detected' 
      });
    }
  }

  return features;
}

// =====================================================
// BOT SCRIPT GENERATION
// =====================================================

function generateZoBotScript(shop, businessId, storeData) {
  const webhookBase = `${BASE_URL}/api/bot/${businessId}`;
  
  return `
// =====================================================
// AUTO-GENERATED ZOBOT FOR ${shop}
// Generated: ${new Date().toISOString()}
// Business ID: ${businessId}
// =====================================================

// Configuration
BACKEND_URL = "${BASE_URL}";
BUSINESS_ID = "${businessId}";
SHOP_DOMAIN = "${shop}";

// =====================================================
// GREETING FLOW
// =====================================================
response = {"action":"reply","replies":["👋 Welcome to ${shop.replace('.myshopify.com', '')}! I'm your shopping assistant."]};
response.put("suggestions", ["🛍️ Browse Products", "📦 Track Order", "💬 Help"]);

// =====================================================
// PRODUCT BROWSING FLOW
// =====================================================
if(input.containsIgnoreCase("browse") || input.containsIgnoreCase("products") || input.containsIgnoreCase("shop"))
{
    // Call backend to fetch products
    endpoint = BACKEND_URL + "/api/bot/" + BUSINESS_ID + "/products";
    
    productResponse = invokeurl [
        url: endpoint
        type: POST
        parameters: {"session_id": visitor.get("id")}
        headers: {"Content-Type": "application/json"}
    ];
    
    // Display product cards
    if(productResponse.get("cards") != null)
    {
        response = {"action":"reply","replies":["Here are our featured products:"]};
        response.put("cards", productResponse.get("cards"));
    }
}

// =====================================================
// ORDER TRACKING FLOW
// =====================================================
else if(input.containsIgnoreCase("track") || input.containsIgnoreCase("order") || input.containsIgnoreCase("status"))
{
    // Ask for email if not provided
    if(visitor.get("email") == null || visitor.get("email") == "")
    {
        response = {"action":"reply","replies":["Please provide your email address to track your order:"]};
        response.put("input_type", "email");
    }
    else
    {
        // Call backend to track order
        endpoint = BACKEND_URL + "/api/bot/" + BUSINESS_ID + "/track-order";
        
        trackResponse = invokeurl [
            url: endpoint
            type: POST
            parameters: {"email": visitor.get("email"), "session_id": visitor.get("id")}
            headers: {"Content-Type": "application/json"}
        ];
        
        response = trackResponse;
    }
}

// =====================================================
// ADD TO CART FLOW
// =====================================================
else if(input.containsIgnoreCase("add to cart") || input.containsIgnoreCase("buy"))
{
    // Extract variant ID from button click or context
    variantId = context.get("selected_variant_id");
    
    if(variantId != null)
    {
        endpoint = BACKEND_URL + "/api/bot/" + BUSINESS_ID + "/add-to-cart";
        
        cartResponse = invokeurl [
            url: endpoint
            type: POST
            parameters: {"variant_id": variantId, "email": visitor.get("email"), "session_id": visitor.get("id")}
            headers: {"Content-Type": "application/json"}
        ];
        
        response = cartResponse;
    }
}

// =====================================================
// HELP & FAQ FLOW
// =====================================================
else if(input.containsIgnoreCase("help") || input.containsIgnoreCase("support"))
{
    response = {"action":"reply","replies":["How can I help you today?"]};
    response.put("suggestions", [
        "🛍️ Browse Products",
        "📦 Track My Order",
        "💳 Payment Methods",
        "🚚 Shipping Info",
        "👤 Talk to Human"
    ]);
}

// =====================================================
// DEFAULT FALLBACK
// =====================================================
else
{
    response = {"action":"reply","replies":["I'm here to help! You can:"]};
    response.put("suggestions", ["🛍️ Browse Products", "📦 Track Order", "💬 Get Help"]);
}

// Return response
response;

// =====================================================
// DETECTED FEATURES:
${storeData.features.map(f => `// ✅ ${f.name} - ${f.reason}`).join('\n')}
// =====================================================
`;
}

// =====================================================
// BOT API ENDPOINTS (Business-specific)
// =====================================================

app.post("/api/bot/:businessId/products", async (req, res) => {
  const { businessId } = req.params;
  const store = connectedStores.get(businessId);

  if (!store) {
    return res.status(404).json({ error: "Store not connected" });
  }

  try {
    const response = await fetch(
      `https://${store.shop}/admin/api/${API_VERSION}/products.json?limit=10`,
      {
        headers: { 
          'X-Shopify-Access-Token': store.accessToken 
        }
      }
    );

    const { products } = await response.json();

    const cards = (products || []).slice(0, 10).map(p => {
      const variant = p.variants?.[0];
      const price = variant?.price || "0";
      const comparePrice = variant?.compare_at_price;
      const image = p.images?.[0]?.src || "";

      let subtitle = `$${price}`;
      if (comparePrice && parseFloat(comparePrice) > parseFloat(price)) {
        const discount = Math.round(((comparePrice - price) / comparePrice) * 100);
        subtitle = `🔥 $${price} (Save ${discount}%)`;
      }

      return {
        title: p.title,
        subtitle,
        image,
        buttons: [
          {
            label: "View Details",
            type: "url",
            value: `https://${store.shop}/products/${p.handle}`
          },
          {
            label: "Add to Cart",
            type: "invoke.function",
            value: { variant_id: variant?.id, price }
          }
        ]
      };
    });

    res.json({ cards, message: "Products loaded" });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.post("/api/bot/:businessId/track-order", async (req, res) => {
  const { businessId } = req.params;
  const { email } = req.body;
  const store = connectedStores.get(businessId);

  if (!store || !email) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const response = await fetch(
      `https://${store.shop}/admin/api/${API_VERSION}/orders.json?email=${encodeURIComponent(email)}&limit=1`,
      {
        headers: { 
          'X-Shopify-Access-Token': store.accessToken 
        }
      }
    );

    const { orders } = await response.json();

    if (!orders || orders.length === 0) {
      return res.json({
        action: "reply",
        replies: [`No orders found for ${email}`]
      });
    }

    const order = orders[0];
    const status = `📦 Order ${order.name}\n` +
                   `Status: ${order.fulfillment_status || 'Processing'}\n` +
                   `Total: $${order.total_price} ${order.currency}`;

    res.json({
      action: "reply",
      replies: [status]
    });

  } catch (error) {
    console.error('Error tracking order:', error);
    res.status(500).json({ error: "Failed to track order" });
  }
});

// =====================================================
// ADMIN ENDPOINTS
// =====================================================

app.get("/api/business/:businessId", (req, res) => {
  const { businessId } = req.params;
  const store = connectedStores.get(businessId);

  if (!store) {
    return res.status(404).json({ error: "Store not found" });
  }

  res.json({
    businessId: store.businessId,
    shop: store.shop,
    connectedAt: store.connectedAt,
    features: store.storeData.features,
    totalProducts: store.storeData.totalProducts,
    botScriptReady: true
  });
});

app.get("/api/business/:businessId/bot-script", (req, res) => {
  const { businessId } = req.params;
  const store = connectedStores.get(businessId);

  if (!store) {
    return res.status(404).json({ error: "Store not found" });
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="zobot-${businessId}.deluge"`);
  res.send(store.botScript);
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok",
    connectedStores: connectedStores.size,
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auto-Bot Server running on port ${PORT}`);
  console.log(`🔑 API Key configured: ${SHOPIFY_API_KEY ? '✅' : '❌'}`);
  console.log(`📍 Base URL: ${BASE_URL}`);
});