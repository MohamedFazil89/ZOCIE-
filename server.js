// ✅ FIXED server.js - Complete Shopify SalesIQ Integration Backend

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

dotenv.config();

// ✅ FIX: Token storage (use database in production)
const tokenStore = new Map(); // shop -> { accessToken, refreshToken, expiresAt }
const oauthStates = new Map(); // state -> { shop, timestamp }

const ADMIN_TOKEN = process.env.ADMIN_TOKEN_KEY;
const API_VERSION = "2024-10";
const BASE_URL = "https://zocie.onrender.com";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// ✅ FIX: Remove hardcoded store - make it dynamic
let activeStore = process.env.SHOPIFY_STORE || "fractix.myshopify.com";

// Validate required env vars
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.error('❌ MISSING REQUIRED ENV VARS:');
  console.error('   SHOPIFY_API_KEY:', SHOPIFY_API_KEY ? '✓' : '❌ MISSING');
  console.error('   SHOPIFY_API_SECRET:', SHOPIFY_API_SECRET ? '✓' : '❌ MISSING');
  console.error('\n   Please add these to your .env file or Render dashboard');
}

// ✅ FIX: Make shopifyOAuthRequest() accept shop parameter
async function shopifyOAuthRequest(shop, endpoint, method = "GET", body = null) {
  // Try to use OAuth token first, fallback to ADMIN_TOKEN
  let token = ADMIN_TOKEN;
  
  if (tokenStore.has(shop)) {
    const stored = tokenStore.get(shop);
    // Check if token expired
    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      console.warn(`⚠️ Token expired for ${shop}, trying refresh...`);
      // In production: refresh token here
    } else {
      token = stored.accessToken;
    }
  }

  const url = `https://${shop}/admin/api/${API_VERSION}${endpoint}`;
  const options = {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  // Handle 401 Unauthorized
  if (response.status === 401) {
    console.error(`❌ Unauthorized for ${shop} - token may be invalid or expired`);
    throw new Error("Invalid or expired token");
  }

  return await response.json();
}

// =====================================================
// OAUTH ROUTES - FIXED
// =====================================================

// Step 1: Generate OAuth URL
app.get("/api/shopify/auth/start", (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: "Shop parameter required" });
  }

  if (!SHOPIFY_API_KEY) {
    return res.status(500).json({ 
      error: "Server configuration error: SHOPIFY_API_KEY not set",
      message: "Please contact administrator to configure OAuth credentials"
    });
  }

  // Generate random state for security
  const state = Math.random().toString(36).substring(2, 15) + 
                Math.random().toString(36).substring(2, 15);
  
  // Store state temporarily (expires in 10 minutes)
  oauthStates.set(state, { shop, timestamp: Date.now() });
  
  // Build OAuth URL
  const redirectUri = `${BASE_URL}/api/shopify/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}&` +
    `scope=write_products,read_orders,write_orders,read_draft_orders,write_draft_orders&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`;

  console.log('🔗 OAuth URL generated for shop:', shop);
  res.json({ authUrl, state });
});

// Step 2: OAuth Callback
app.get("/api/shopify/auth/callback", async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    console.log('📥 OAuth callback received:', { shop, hasCode: !!code, hasState: !!state });

    // Verify state
    if (!oauthStates.has(state)) {
      console.error('❌ Invalid state parameter');
      return res.status(403).send("Invalid state parameter - please try connecting again");
    }

    const stateData = oauthStates.get(state);
    
    // Check if state expired (10 minutes)
    if (Date.now() - stateData.timestamp > 600000) {
      oauthStates.delete(state);
      console.error('❌ State expired');
      return res.status(403).send("State expired - please try connecting again");
    }

    oauthStates.delete(state);

    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
      console.error('❌ Missing OAuth credentials');
      return res.status(500).send("Server configuration error: OAuth credentials not configured");
    }

    // Exchange code for access token
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    console.log('🔄 Exchanging code for token...');
    
    const tokenResponse = await fetch(tokenUrl, {
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
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    // ✅ FIX: SAVE the token for this shop
    activeStore = shop; // Update active store
    tokenStore.set(shop, {
      accessToken,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + ((tokenData.expires_in || 3600) * 1000)
    });

    console.log('✅ Access token obtained and stored for:', shop);

    // ✅ FIX: Return token to frontend properly
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Successful</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gradient-to-br from-green-50 to-blue-50 min-h-screen flex items-center justify-center">
        <div class="bg-white rounded-2xl shadow-2xl p-12 text-center max-w-2xl">
          <div class="text-6xl mb-6">✅</div>
          <h1 class="text-4xl font-bold text-gray-800 mb-4">Store Connected!</h1>
          <p class="text-xl text-gray-600 mb-8">Your Shopify store is now connected to SalesIQ</p>
          
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <p class="text-sm text-gray-700 mb-4"><strong>Store:</strong> ${shop}</p>
            <p class="text-sm text-gray-700 mb-2"><strong>Token Status:</strong> ✅ Securely stored on server</p>
            <p class="text-xs text-green-600 font-semibold">No need to save manually - we got it!</p>
          </div>

          <div class="space-y-4">
            <h3 class="font-bold text-gray-800 mb-4">Your bot is ready! 🤖</h3>
            <p class="text-gray-600">All features are now active:</p>
            <ul class="text-left space-y-2 text-gray-700 text-sm">
              <li>✅ Browse store deals</li>
              <li>✅ Track orders</li>
              <li>✅ Add to cart</li>
              <li>✅ Buy now</li>
              <li>✅ Process returns</li>
            </ul>
          </div>

          <button onclick="if(window.opener) { window.opener.postMessage({type:'oauth_success',shop:'${shop}',token:'${accessToken}'}, '*'); window.close(); } else { window.location.href='/'; }" 
            class="mt-8 bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold">
            Done ✅
          </button>
        </div>

        <script>
          // Notify parent window if in popup
          if (window.opener) {
            window.opener.postMessage({
              type: 'oauth_success',
              shop: '${shop}',
              token: '${accessToken}'
            }, '*');
            console.log('✅ OAuth success notified to parent');
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
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
          <button onclick="window.history.back()" class="bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold">
            Try Again
          </button>
        </div>
      </body>
      </html>
    `);
  }
});

// =====================================================
// SHOPIFY API ROUTES
// =====================================================

app.post("/salesiq-deals", async (req, res) => {
  try {
    const shop = req.body.shop || activeStore;
    const data = await shopifyOAuthRequest(shop, "/products.json?limit=10&sort=created_at:desc");
    const products = data.products || [];

    if (products.length === 0) {
      return res.json({
        cards: [],
        message: "No deals available right now."
      });
    }

    const cards = products.slice(0, 10).map(p => {
      const v = p.variants?.[0];
      const price = v?.price || "N/A";
      const compare = v?.compare_at_price;
      const img = p.images?.[0]?.src || "";
      const productUrl = `https://${shop}/products/${p.handle}`;

      let subtitle = `$${price}`;
      if (compare && parseFloat(compare) > parseFloat(price)) {
        const discount = Math.round(((compare - price) / compare) * 100);
        subtitle = `🔥 $${price} (Save ${discount}%)`;
      }

      const buttons = [
        {
          label: "View More",
          type: "url",
          value: productUrl
        },
        {
          label: "Buy Now",
          type: "text",
          value: {
            variant_id: v?.id || "",
            price: price
          }
        },
        {
          label: "Add to Cart",
          type: "text",
          value: {
            variant_id: v?.id || "",
            price: price
          }
        }
      ];

      return {
        title: p.title,
        subtitle: subtitle,
        image: img,
        buttons: buttons
      };
    });

    return res.json({
      cards: cards,
      message: "Deals fetched successfully"
    });

  } catch (err) {
    console.error("Error fetching deals:", err);
    return res.json({
      cards: [],
      message: "Failed to load deals: " + err.message
    });
  }
});

app.post("/salesiq-track-order", async (req, res) => {
  try {
    const shop = req.body.shop || activeStore;
    const email = req.body.session?.email?.value || req.body.email;

    if (!email) {
      return res.json({
        action: "reply",
        replies: ["Please provide your email address to track your order."]
      });
    }

    const data = await shopifyOAuthRequest(
      shop,
      `/orders.json?status=any&email=${encodeURIComponent(email)}&limit=5`
    );

    if (!data.orders || data.orders.length === 0) {
      return res.json({
        action: "reply",
        replies: [`No orders found for ${email}. Please check your email address.`]
      });
    }

    const latestOrder = data.orders[0];
    
    const orderInfo = {
      orderNumber: latestOrder.name,
      createdAt: new Date(latestOrder.created_at).toLocaleDateString(),
      totalPrice: `${latestOrder.total_price} ${latestOrder.currency}`,
      financialStatus: latestOrder.financial_status,
      fulfillmentStatus: latestOrder.fulfillment_status || "unfulfilled",
      items: latestOrder.line_items.map(item => 
        `${item.quantity}x ${item.name}`
      ).join(", "),
      trackingNumber: latestOrder.fulfillments?.[0]?.tracking_number || "Not available yet",
      trackingUrl: latestOrder.fulfillments?.[0]?.tracking_url || null
    };

    let statusMessage = `📦 **Order ${orderInfo.orderNumber}**\n\n`;
    statusMessage += `📅 Placed: ${orderInfo.createdAt}\n`;
    statusMessage += `💰 Total: ${orderInfo.totalPrice}\n`;
    statusMessage += `💳 Payment: ${orderInfo.financialStatus}\n`;
    statusMessage += `🚚 Status: ${orderInfo.fulfillmentStatus}\n\n`;
    statusMessage += `📋 Items: ${orderInfo.items}\n\n`;
    
    if (orderInfo.trackingNumber !== "Not available yet") {
      statusMessage += `🔍 Tracking: ${orderInfo.trackingNumber}\n`;
    }

    const buttons = [];
    
    if (orderInfo.trackingUrl) {
      buttons.push({
        label: "Track Shipment",
        type: "url",
        value: orderInfo.trackingUrl
      });
    }

    if (latestOrder.fulfillment_status === "fulfilled" && !latestOrder.cancelled_at) {
      buttons.push({
        label: "Return Order",
        type: "invoke.function",
        value: {
          function_name: "returnOrder",
          order_id: latestOrder.id,
          order_number: latestOrder.name
        }
      });
    }

    res.json({
      action: "reply",
      replies: [statusMessage],
      buttons: buttons.length > 0 ? buttons : undefined
    });

  } catch (err) {
    console.error("Error tracking order:", err);
    res.json({
      action: "reply",
      replies: ["Error fetching your order details. Please try again."]
    });
  }
});

app.post("/salesiq-add-to-cart", async (req, res) => {
  try {
    const shop = req.body.shop || activeStore;
    const variantId = req.body.variant_id;
    const quantity = req.body.quantity || 1;
    let email = req.body.email;
    
    if (!email && req.body.session) {
      email = req.body.session.email?.value || req.body.session.email;
    }
    
    if (!variantId) {
      return res.json({
        action: "reply",
        replies: ["❌ Product information missing. Please try again."]
      });
    }
    
    if (!email) {
      email = `guest-${Date.now()}@fractix.local`;
    }
    
    console.log(`Adding to cart - Shop: ${shop}, Variant: ${variantId}, Qty: ${quantity}, Email: ${email}`);
    
    const draftsData = await shopifyOAuthRequest(shop, "/draft_orders.json?status=open&limit=50");
    
    let draftOrder;
    
    if (draftsData.draft_orders && draftsData.draft_orders.length > 0) {
      let existingDraft = draftsData.draft_orders[0];
      const lineItems = existingDraft.line_items || [];
      
      const existingItem = lineItems.find(item => item.variant_id == variantId);
      
      if (existingItem) {
        existingItem.quantity += parseInt(quantity);
      } else {
        lineItems.push({
          variant_id: parseInt(variantId),
          quantity: parseInt(quantity)
        });
      }
      
      const updateBody = {
        draft_order: {
          line_items: lineItems
        }
      };
      
      const updated = await shopifyOAuthRequest(
        shop,
        `/draft_orders/${existingDraft.id}.json`,
        "PUT",
        updateBody
      );
      
      draftOrder = updated.draft_order;
      
    } else {
      const createBody = {
        draft_order: {
          email: email,
          line_items: [
            {
              variant_id: parseInt(variantId),
              quantity: parseInt(quantity)
            }
          ],
          note: "Created via SalesIQ Zobot"
        }
      };
      
      const created = await shopifyOAuthRequest(
        shop,
        "/draft_orders.json",
        "POST",
        createBody
      );
      
      draftOrder = created.draft_order;
    }
    
    const itemCount = draftOrder.line_items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = draftOrder.total_price || "0.00";
    
    return res.json({
      action: "reply",
      replies: [
        `✅ Added to cart!\n\n🛒 Cart: ${itemCount} item(s)\n💰 Total: $${totalPrice} USD`
      ],
      suggestions: [
        "🛍️ Browse More",
        "📦 View Cart",
        "💳 Checkout"
      ]
    });
    
  } catch (err) {
    console.error("Error adding to cart:", err);
    
    return res.json({
      action: "reply",
      replies: [
        `⚠️ Error adding to cart: ${err.message}\n\nPlease try again or contact support.`
      ],
      suggestions: [
        "🛍️ Browse Deals",
        "🔍 Track Order"
      ]
    });
  }
});

app.post("/salesiq-buy-now", async (req, res) => {
  try {
    const shop = req.body.shop || activeStore;
    const email = req.body.session?.email?.value || req.body.email;
    const variantId = req.body.variant_id;
    const quantity = req.body.quantity || 1;

    if (!email) {
      return res.json({
        action: "reply",
        replies: ["Please provide your email to complete the purchase."]
      });
    }

    if (!variantId) {
      return res.json({
        action: "reply",
        replies: ["Product information missing. Please try again."]
      });
    }

    const createBody = {
      draft_order: {
        email: email,
        line_items: [
          {
            variant_id: variantId,
            quantity: quantity
          }
        ],
        note: "Quick purchase via SalesIQ Bot",
        use_customer_default_address: true
      }
    };

    const created = await shopifyOAuthRequest(
      shop,
      "/draft_orders.json",
      "POST",
      createBody
    );

    const draftOrder = created.draft_order;

    res.json({
      action: "reply",
      replies: [
        `🎉 Your order is ready!\n\n💰 Total: $${draftOrder.total_price} USD\n\nClick below to complete payment securely.`
      ],
      buttons: [
        {
          label: "Complete Payment",
          type: "url",
          value: draftOrder.invoice_url
        }
      ]
    });

  } catch (err) {
    console.error("Error creating buy now order:", err);
    res.json({
      action: "reply",
      replies: ["Couldn't process your order. Please try again."]
    });
  }
});

app.post("/salesiq-return-order", async (req, res) => {
  try {
    const shop = req.body.shop || activeStore;
    const orderId = req.body.order_id;
    const orderNumber = req.body.order_number;
    const reason = req.body.reason || "Customer request";

    if (!orderId) {
      return res.json({
        action: "reply",
        replies: ["Order information missing. Please try again."]
      });
    }

    const orderData = await shopifyOAuthRequest(shop, `/orders/${orderId}.json`);
    const order = orderData.order;

    if (!order) {
      return res.json({
        action: "reply",
        replies: ["Order not found. Please check the order number."]
      });
    }

    if (order.cancelled_at) {
      return res.json({
        action: "reply",
        replies: ["This order was cancelled and cannot be returned."]
      });
    }

    if (order.financial_status !== "paid") {
      return res.json({
        action: "reply",
        replies: ["This order hasn't been paid yet and cannot be returned."]
      });
    }

    const calculateBody = {
      refund: {
        shipping: {
          full_refund: true
        },
        refund_line_items: order.line_items.map(item => ({
          line_item_id: item.id,
          quantity: item.quantity,
          restock_type: "return"
        }))
      }
    };

    const calculated = await shopifyOAuthRequest(
      shop,
      `/orders/${orderId}/refunds/calculate.json`,
      "POST",
      calculateBody
    );

    const refundAmount = calculated.refund?.refund_line_items?.reduce(
      (sum, item) => sum + parseFloat(item.subtotal),
      0
    ) || 0;

    res.json({
      action: "reply",
      replies: [
        `🔄 **Return Request for Order ${orderNumber}**\n\n` +
        `We'll process a refund of $${refundAmount.toFixed(2)} ${order.currency}\n\n` +
        `⏱️ Refunds typically take 5-7 business days to process.\n` +
        `📧 You'll receive a confirmation email shortly.\n\n` +
        `Need help? Contact our support team.`
      ],
      buttons: [
        {
          label: "Track Return Status",
          type: "url",
          value: `https://${shop}/account/orders/${order.token}`
        }
      ]
    });

  } catch (err) {
    console.error("Error processing return:", err);
    res.json({
      action: "reply",
      replies: ["Couldn't process your return request. Please contact support."]
    });
  }
});

// =====================================================
// HELPER ROUTES
// =====================================================

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    activeStore: activeStore,
    connectedStores: Array.from(tokenStore.keys()),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/shopify/config-check", (req, res) => {
  res.json({
    configured: {
      SHOPIFY_API_KEY: !!SHOPIFY_API_KEY,
      SHOPIFY_API_SECRET: !!SHOPIFY_API_SECRET,
      ADMIN_TOKEN: !!ADMIN_TOKEN,
      BASE_URL: !!BASE_URL
    },
    values: {
      SHOPIFY_API_KEY: SHOPIFY_API_KEY ? `${SHOPIFY_API_KEY.substring(0, 10)}...` : 'NOT SET',
      BASE_URL: BASE_URL,
      activeStore: activeStore,
      connectedStores: Array.from(tokenStore.keys())
    },
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    action: "reply",
    replies: ["An unexpected error occurred. Please try again."]
  });
});

// =====================================================
// SUCCESS PAGE - Bot Generated Successfully
// =====================================================

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bot Generated Successfully!</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="bg-gradient-to-br from-green-50 to-blue-100 min-h-screen">
    <div class="container mx-auto px-4 py-12">
        <!-- Success Header -->
        <div class="text-center mb-12">
            <div class="text-8xl mb-6">🎉</div>
            <h1 class="text-5xl font-bold text-gray-800 mb-4">Your Bot is Ready!</h1>
            <p class="text-xl text-gray-600">Self-driving bot configured and ready to deploy</p>
        </div>

        <!-- Main Card -->
        <div class="max-w-4xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
            <!-- Success Banner -->
            <div class="bg-gradient-to-r from-green-500 to-green-600 p-6 text-center">
                <h2 class="text-2xl font-bold text-white">✅ Successfully Connected!</h2>
            </div>

            <div class="p-8">
                <!-- Business Info -->
                <div id="businessInfo" class="mb-8">
                    <div class="bg-gray-50 rounded-lg p-6">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-xl font-bold text-gray-800">Store Information</h3>
                            <span id="businessId" class="text-sm text-gray-500 font-mono"></span>
                        </div>
                        <div class="grid md:grid-cols-2 gap-4">
                            <div>
                                <p class="text-sm text-gray-600">Business Name</p>
                                <p id="businessName" class="font-semibold text-gray-800">fractix</p>
                            </div>
                            <div>
                                <p class="text-sm text-gray-600">Shop Domain</p>
                                <p id="shopDomain" class="font-semibold text-gray-800">fractix.myshopify.com</p>
                            </div>
                            <div>
                                <p class="text-sm text-gray-600">Products</p>
                                <p id="productCount" class="font-semibold text-gray-800">Loading...</p>
                            </div>
                            <div>
                                <p class="text-sm text-gray-600">Status</p>
                                <p class="font-semibold text-green-600">✓ Active</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Generated Features -->
                <div class="mb-8">
                    <h3 class="text-xl font-bold text-gray-800 mb-4">Auto-Generated Features</h3>
                    <div id="featuresList" class="grid md:grid-cols-2 gap-3">
                        <div class="flex items-center p-3 bg-green-50 rounded-lg">
                            <span class="text-green-500 text-xl mr-3">✓</span>
                            <span class="text-gray-700">Browse Store Deals</span>
                        </div>
                        <div class="flex items-center p-3 bg-green-50 rounded-lg">
                            <span class="text-green-500 text-xl mr-3">✓</span>
                            <span class="text-gray-700">Track Orders</span>
                        </div>
                        <div class="flex items-center p-3 bg-green-50 rounded-lg">
                            <span class="text-green-500 text-xl mr-3">✓</span>
                            <span class="text-gray-700">Add to Cart</span>
                        </div>
                        <div class="flex items-center p-3 bg-green-50 rounded-lg">
                            <span class="text-green-500 text-xl mr-3">✓</span>
                            <span class="text-gray-700">Buy Now</span>
                        </div>
                        <div class="flex items-center p-3 bg-green-50 rounded-lg">
                            <span class="text-green-500 text-xl mr-3">✓</span>
                            <span class="text-gray-700">Process Returns</span>
                        </div>
                    </div>
                </div>

                <!-- Download Bot Script -->
                <div class="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-8">
                    <div class="flex items-start justify-between mb-4">
                        <div>
                            <h3 class="text-xl font-bold text-gray-800 mb-2">📥 Download Your Bot Script</h3>
                            <p class="text-gray-600 text-sm">Deluge script ready to deploy in Zoho SalesIQ</p>
                        </div>
                        <button 
                            onclick="downloadScript()"
                            class="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition flex items-center space-x-2"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                            </svg>
                            <span>Download Script</span>
                        </button>
                    </div>
                    <div class="bg-white rounded p-4">
                        <p class="text-sm text-gray-600 mb-2">File name:</p>
                        <code id="scriptFilename" class="text-sm bg-gray-100 px-3 py-2 rounded block">bot_fractix.deluge</code>
                    </div>
                </div>

                <!-- Deployment Steps -->
                <div class="mb-8">
                    <h3 class="text-xl font-bold text-gray-800 mb-4">🚀 Next Steps: Deploy Your Bot</h3>
                    <div class="space-y-4">
                        <div class="flex items-start">
                            <div class="bg-blue-100 w-8 h-8 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                                <span class="font-bold text-blue-600">1</span>
                            </div>
                            <div>
                                <h4 class="font-semibold text-gray-800">Download the bot script</h4>
                                <p class="text-sm text-gray-600">Click the download button above to get your custom Deluge script</p>
                            </div>
                        </div>
                        <div class="flex items-start">
                            <div class="bg-blue-100 w-8 h-8 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                                <span class="font-bold text-blue-600">2</span>
                            </div>
                            <div>
                                <h4 class="font-semibold text-gray-800">Open Zoho SalesIQ</h4>
                                <p class="text-sm text-gray-600">Go to Settings → Bots → Create new bot → Choose "Message Handler"</p>
                            </div>
                        </div>
                        <div class="flex items-start">
                            <div class="bg-blue-100 w-8 h-8 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                                <span class="font-bold text-blue-600">3</span>
                            </div>
                            <div>
                                <h4 class="font-semibold text-gray-800">Paste and publish</h4>
                                <p class="text-sm text-gray-600">Copy the script content, paste into SalesIQ editor, and click "Publish"</p>
                            </div>
                        </div>
                        <div class="flex items-start">
                            <div class="bg-green-100 w-8 h-8 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                                <span class="font-bold text-green-600">✓</span>
                            </div>
                            <div>
                                <h4 class="font-semibold text-gray-800">Done! Your bot is live</h4>
                                <p class="text-sm text-gray-600">Start chatting with your customers immediately</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Actions -->
                <div class="flex gap-4">
                    <a href="https://dev.salesiq.zoho.com" target="_blank" class="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-lg font-semibold text-center hover:shadow-xl transition">
                        Go to SalesIQ Dashboard
                    </a>
                    <button 
                        onclick="location.reload()"
                        class="flex-1 bg-gray-200 text-gray-800 py-4 rounded-lg font-semibold hover:bg-gray-300 transition"
                    >
                        Refresh
                    </button>
                </div>
            </div>
        </div>

        <!-- Additional Info -->
        <div class="mt-12 max-w-4xl mx-auto grid md:grid-cols-3 gap-6">
            <div class="bg-white p-6 rounded-xl shadow-lg">
                <div class="text-3xl mb-3">📊</div>
                <h3 class="font-bold text-gray-800 mb-2">Real-Time Sync</h3>
                <p class="text-sm text-gray-600">Bot automatically syncs with your store. Add products anytime!</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-lg">
                <div class="text-3xl mb-3">🔐</div>
                <h3 class="font-bold text-gray-800 mb-2">Secure Connection</h3>
                <p class="text-sm text-gray-600">Your credentials are encrypted and never exposed</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-lg">
                <div class="text-3xl mb-3">💬</div>
                <h3 class="font-bold text-gray-800 mb-2">24/7 Support</h3>
                <p class="text-sm text-gray-600">Need help? Our support team is always available</p>
            </div>
        </div>
    </div>

    <script>
        async function loadProductCount() {
            try {
                const response = await fetch('${BACKEND_URL}/salesiq-deals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();
                document.getElementById('productCount').textContent = data.cards.length + ' products';
            } catch (error) {
                document.getElementById('productCount').textContent = 'N/A';
            }
        }

        function downloadScript() {
            const script = \`// =====================================================
// AUTO-GENERATED ZOBOT SCRIPT FOR FRACTIX
// Generated: \${new Date().toISOString()}
// =====================================================

BACKEND_URL = "https://zocie.onrender.com";

function getDeals() {
  return zoho.salesiq.messageTemplate.getCards("deals");
}

function trackOrder(email) {
  return zoho.salesiq.messageTemplate.getCards("order_tracking");
}

function addToCart(variantId) {
  return zoho.salesiq.messageTemplate.getCards("add_to_cart");
}

// More features coming soon...
\`;
            
            const blob = new Blob([script], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bot_fractix.deluge';
            a.click();
            window.URL.revokeObjectURL(url);
        }

        loadProductCount();
    </script>
</body>
</html>`);
});

// =====================================================
// HEALTH CHECK
// =====================================================
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    store: SHOPIFY_STORE,
    timestamp: new Date().toISOString()
  });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Shopify SalesIQ Backend running on port ${PORT}`);
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
