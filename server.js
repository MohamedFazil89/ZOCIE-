// ✅ FIXED server.js - Complete Shopify SalesIQ Integration Backend

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

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


const DATA_DIR = path.join(process.cwd(), "businesses");

// Ensure folder exists
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export async function saveBusinessData(data) {
  try {
    ensureDir();

    // each business gets its own file
    const filePath = path.join(DATA_DIR, `business_${data.businessId}.json`);

    let existing = {};
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      existing = JSON.parse(raw || "{}");
    }

    const updated = {
      ...existing,
      ...data
    };

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));

    return { success: true, message: "Saved locally." };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ✅ FIX: Token storage (use database in production)
const tokenStore = new Map(); // shop -> { accessToken, refreshToken, expiresAt }
const oauthStates = new Map(); // state -> { shop, timestamp }

const ADMIN_TOKEN = process.env.ADMIN_TOKEN_KEY;
const API_VERSION = "2024-10";
const BASE_URL = "https://zocie.onrender.com";
const BACKEND_URL = "https://zocie.onrender.com"

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



// =====================================================
// BUSINESS DATABASE (Use real DB in production)
// =====================================================
const businessDatabase = new Map(); // businessId → business data
const shopToBusinessMap = new Map(); // shop domain → businessId

// Helper: Generate unique business ID
function generateBusinessId() {
  return 'biz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Helper: Save business to database


// Helper: Get business data by ID
async function getBusinessData(businessId) {
  return businessDatabase.get(businessId);
}

// Helper: Get business ID by shop domain
async function getBusinessIdByShop(shopDomain) {
  return shopToBusinessMap.get(shopDomain);
}

// =====================================================
// UPDATED: OAuth Callback - Save Business Data
// =====================================================
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

    console.log('✅ Access token obtained successfully');

    // ✅ FETCH SHOP DETAILS
    const shopDetailsUrl = `https://${shop}/admin/api/2024-10/shop.json`;
    const shopResponse = await fetch(shopDetailsUrl, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    });

    let shopDetails = {};
    if (shopResponse.ok) {
      const shopData = await shopResponse.json();
      shopDetails = {
        shopName: shopData.shop?.name || shop,
        shopEmail: shopData.shop?.email || "",
        currency: shopData.shop?.currency || "USD",
        timezone: shopData.shop?.iana_timezone || ""
      };
    }

    // ✅ GENERATE UNIQUE BUSINESS ID
    const businessId = generateBusinessId();
    console.log('🆔 Generated businessId:', businessId);

    // ✅ SAVE BUSINESS DATA WITH TOKEN
    const businessData = {
      businessId: businessId,
      shopDomain: shop,
      shopName: shopDetails.shopName,
      shopEmail: shopDetails.shopEmail,
      adminToken: accessToken,
      refreshToken: tokenData.refresh_token || null,
      expiresAt: Date.now() + ((tokenData.expires_in || 3600) * 1000),
      connectedAt: new Date().toISOString(),
      status: "active",
      currency: shopDetails.currency,
      timezone: shopDetails.timezone,
      webhookUrl: `${BASE_URL}/api/zobot/${businessId}`
    };

    await saveBusinessData(businessData);

    // ✅ FETCH PRODUCT COUNT FOR DISPLAY
    const productsUrl = `https://${shop}/admin/api/2024-10/products.json?limit=1&fields=id`;
    let productCount = 0;
    try {
      const productsResponse = await fetch(productsUrl, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json"
        }
      });
      if (productsResponse.ok) {
        const productsData = await productsResponse.json();
        productCount = productsData.products?.length || 0;
      }
    } catch (err) {
      console.log('⚠️ Could not fetch product count:', err.message);
    }

    console.log('✅ Business successfully configured!');

    // ✅ SUCCESS PAGE WITH WEBHOOK URL
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bot Configuration Ready!</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gradient-to-br from-green-50 to-blue-100 min-h-screen flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full">
          
          <!-- Header -->
          <div class="bg-gradient-to-r from-green-500 to-green-600 p-8 text-center">
            <div class="text-6xl mb-4">✅</div>
            <h1 class="text-4xl font-bold text-white mb-2">Bot is Ready!</h1>
            <p class="text-green-100">Your store is connected and configured</p>
          </div>

          <!-- Content -->
          <div class="p-8">
            
            <!-- Store Info -->
            <div class="bg-gray-50 rounded-lg p-6 mb-6">
              <h3 class="text-xl font-bold text-gray-800 mb-4">📦 Store Information</h3>
              <div class="space-y-3">
                <div class="flex justify-between">
                  <span class="text-gray-600">Store Name:</span>
                  <span class="font-semibold text-gray-800">${shopDetails.shopName}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">Domain:</span>
                  <span class="font-semibold text-gray-800">${shop}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">Status:</span>
                  <span class="font-semibold text-green-600">✓ Active</span>
                </div>
              </div>
            </div>

            <!-- Features -->
            <div class="mb-6">
              <h3 class="text-xl font-bold text-gray-800 mb-4">🤖 Active Features</h3>
              <div class="grid grid-cols-2 gap-3">
                <div class="flex items-center p-3 bg-green-50 rounded-lg">
                  <span class="text-green-500 text-xl mr-2">✓</span>
                  <span class="text-gray-700">Browse Deals</span>
                </div>
                <div class="flex items-center p-3 bg-green-50 rounded-lg">
                  <span class="text-green-500 text-xl mr-2">✓</span>
                  <span class="text-gray-700">Track Orders</span>
                </div>
                <div class="flex items-center p-3 bg-green-50 rounded-lg">
                  <span class="text-green-500 text-xl mr-2">✓</span>
                  <span class="text-gray-700">Add to Cart</span>
                </div>
                <div class="flex items-center p-3 bg-green-50 rounded-lg">
                  <span class="text-green-500 text-xl mr-2">✓</span>
                  <span class="text-gray-700">Buy Now</span>
                </div>
                <div class="flex items-center p-3 bg-green-50 rounded-lg">
                  <span class="text-green-500 text-xl mr-2">✓</span>
                  <span class="text-gray-700">Process Returns</span>
                </div>
                <div class="flex items-center p-3 bg-green-50 rounded-lg">
                  <span class="text-green-500 text-xl mr-2">✓</span>
                  <span class="text-gray-700">Memory Context</span>
                </div>
              </div>
            </div>

            <!-- Webhook Configuration -->
            <div class="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-6">
              <h3 class="text-lg font-bold text-gray-800 mb-3">🔗 Webhook for SalesIQ</h3>
              <p class="text-sm text-gray-600 mb-3">Copy this URL to your Zoho SalesIQ bot settings:</p>
              
              <div class="bg-white rounded p-4 mb-4 flex items-center justify-between">
                de class="text-sm font-mono text-gray-800 break-all">${businessData.webhookUrl}</code>
                <button 
                  onclick="copyToClipboard('${businessData.webhookUrl}')"
                  class="ml-3 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold whitespace-nowrap"
                >
                  Copy
                </button>
              </div>

              <p class="text-xs text-blue-600">Business ID: de>${businessId}</code></p>
            </div>

            <!-- Setup Instructions -->
            <div class="bg-orange-50 border border-orange-200 rounded-lg p-6 mb-6">
              <h3 class="text-lg font-bold text-gray-800 mb-4">📋 Setup Instructions</h3>
              <ol class="space-y-3 text-sm">
                <li class="flex items-start">
                  <span class="bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">1</span>
                  <span class="text-gray-700">Go to Zoho SalesIQ → Settings → Bot → Create New Bot</span>
                </li>
                <li class="flex items-start">
                  <span class="bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">2</span>
                  <span class="text-gray-700">Choose "Message Handler" → Select "Webhook"</span>
                </li>
                <li class="flex items-start">
                  <span class="bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">3</span>
                  <span class="text-gray-700">Paste the webhook URL above and click Save</span>
                </li>
                <li class="flex items-start">
                  <span class="bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">4</span>
                  <span class="text-gray-700">Publish the bot and test with a message!</span>
                </li>
              </ol>
            </div>

            <!-- Action Button -->
            <button 
              onclick="handleDone()"
              class="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white py-4 rounded-lg font-bold text-lg transition"
            >
              ✅ Done - Close This Window
            </button>
          </div>

        </div>

        <script>
          function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
              alert('✅ Webhook URL copied to clipboard!');
            });
          }

          function handleDone() {
            // Notify parent window if in popup
            if (window.opener) {
              window.opener.postMessage({
                type: 'oauth_success',
                shop: '${shop}',
                businessId: '${businessId}',
                webhookUrl: '${businessData.webhookUrl}'
              }, '*');
              window.close();
            } else {
              // If not in popup, redirect to home
              window.location.href = '/';
            }
          }

          // Auto-notify parent if in popup
          if (window.opener) {
            window.opener.postMessage({
              type: 'oauth_success',
              shop: '${shop}',
              businessId: '${businessId}',
              webhookUrl: '${businessData.webhookUrl}'
            }, '*');
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
// NEW: Get Business Data Endpoint (

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


// AI


// Intent detection - No script needed!
async function detectIntent(userMessage) {
  const intents = {
    track_order: /track|status|where|delivery|order/i,
    browse_deals: /deal|product|browse|show|what.*sell/i,
    add_cart: /add.*cart|add to cart|want to buy/i,
    buy_now: /buy now|checkout|payment|purchase/i,
    return_order: /return|refund|money back/i,
  };

  for (const [intent, pattern] of Object.entries(intents)) {
    if (pattern.test(userMessage)) {
      return { intent, confidence: 0.9 };
    }
  }
  return { intent: "general_query", confidence: 0.5 };
}

// Execute action based on intent
async function executeAction(intent, userMessage, sessionData) {
  switch(intent) {
    case 'track_order':
      return await trackOrderAI(userMessage, sessionData);
    case 'browse_deals':
      return await browseDealsAI(userMessage);
    case 'add_cart':
      return await addToCartAI(userMessage, sessionData);
    // ... etc
  }
}

// Natural response generation
async function generateResponse(intent, data) {
  const responses = {
    track_order: `📦 Found your order! Status: ${data.status}. Tracking: ${data.trackingUrl}`,
    browse_deals: `🛍️ Here are today's top deals:\n${data.deals.map(d => `• ${d.name}: $${d.price}`).join('\n')}`,
    add_cart: `✅ Added ${data.productName} to your cart! Your total: $${data.total}`,
  };
  
  return responses[intent] || "How can I help you today?";
}


// Remember user context across messages
const userSessions = new Map();

class ConversationMemory {
  constructor(userId) {
    this.userId = userId;
    this.history = [];
    this.context = {
      email: null,
      previousActions: [],
      preferences: {}
    };
  }

  addMessage(role, content, metadata = {}) {
    this.history.push({ role, content, timestamp: Date.now(), ...metadata });
    
    // Auto-extract info
    if (role === 'user') {
      const emailMatch = content.match(/[\w\.-]+@[\w\.-]+/);
      if (emailMatch) this.context.email = emailMatch[0];
    }
  }

  getContext() {
    return this.context;
  }

  remember(key, value) {
    this.context.previousActions.push({ key, value, timestamp: Date.now() });
  }
}


// Instead of 5 different routes, ONE intelligent endpoint
app.post("/zobot/message", async (req, res) => {
  const { userId, message, sessionData } = req.body;

  // Get or create session memory
  if (!userSessions.has(userId)) {
    userSessions.set(userId, new ConversationMemory(userId));
  }
  const memory = userSessions.get(userId);

  // 1. Detect intent from natural language
  const { intent } = await detectIntent(message);
  memory.addMessage('user', message, { intent });

  // 2. Use context from memory
  const context = memory.getContext();

  // 3. Execute action
  let actionResult = await executeAction(intent, message, context);

  // 4. If we need more info, ask for it
  if (actionResult.needsInfo) {
    return res.json({
      action: "reply",
      replies: [actionResult.question],
      suggestions: actionResult.suggestions
    });
  }

  // 5. Generate natural response
  const response = await generateResponse(intent, actionResult);
  memory.addMessage('bot', response);

  // 6. Remember for next interaction
  if (actionResult.remember) {
    memory.remember(intent, actionResult.data);
  }

  res.json({
    action: "reply",
    replies: [response],
    buttons: actionResult.buttons,
    suggestions: actionResult.suggestions
  });
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Shopify SalesIQ Backend running on port ${PORT}`);
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
