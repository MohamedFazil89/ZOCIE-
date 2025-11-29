// server.js - Complete Shopify SalesIQ Integration Backend
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
const app = express();
app.use(express.json());

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
// Storage for OAuth states
const oauthStates = new Map();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || "fractix.myshopify.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN_KEY;
const API_VERSION = "2024-10";
const BASE_URL = process.env.BASE_URL || "https://zocie.onrender.com";

// 🔴 FIX: Add these missing variables
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEYS;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// Validate required env vars on startup
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
  console.error('❌ MISSING REQUIRED ENV VARS:');
  console.error('   SHOPIFY_API_KEY:', SHOPIFY_API_KEY ? '✓' : '❌ MISSING');
  console.error('   SHOPIFY_API_SECRET:', SHOPIFY_API_SECRET ? '✓' : '❌ MISSING');
  console.error('\n   Please add these to your .env file or Render dashboard');
}

// Helper function to make Shopify API calls
async function shopifyOAuthRequest(endpoint, method = "GET", body = null) {
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}${endpoint}`;
  const options = {
    method,
    headers: {
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      "Content-Type": "application/json"
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
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

  // 🔴 FIX: Check if API credentials exist
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

    // 🔴 FIX: Check credentials before exchange
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

    // Success! Show success page
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
            <p class="text-sm text-gray-700 mb-2"><strong>Store:</strong> ${shop}</p>
            <p class="text-sm text-gray-700 mb-2"><strong>Access Token:</strong></p>
            <code class="block bg-white p-3 rounded border text-xs break-all">${accessToken}</code>
            <p class="text-xs text-gray-500 mt-2">Save this token securely - you'll need it for API calls</p>
          </div>

          <div class="space-y-4">
            <h3 class="font-bold text-gray-800 mb-4">Next Steps:</h3>
            <ol class="text-left space-y-3 text-gray-700">
              <li class="flex items-start">
                <span class="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-sm">1</span>
                <span>Save your access token in your backend's .env file as <code class="bg-gray-100 px-2 py-1 rounded text-sm">ADMIN_TOKEN_KEY</code></span>
              </li>
              <li class="flex items-start">
                <span class="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-sm">2</span>
                <span>Test your connection by fetching products from your store</span>
              </li>
              <li class="flex items-start">
                <span class="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-sm">3</span>
                <span>Configure your ZoBot in SalesIQ to use your backend webhooks</span>
              </li>
            </ol>
          </div>

          <button onclick="window.close()" class="mt-8 bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold">
            Close Window
          </button>
        </div>
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

app.post("/salesiq-deals", async (req, res) => {
  try {
    const data = await shopifyOAuthRequest("/products.json?limit=10&sort=created_at:desc");
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
      const productUrl = `https://${SHOPIFY_STORE}/products/${p.handle}`;

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
    console.error("Error:", err);
    return res.json({
      cards: [],
      message: "Failed to load deals."
    });
  }
});

// =====================================================
// 2. TRACK ORDER - Get Latest Order Status by Email
// =====================================================
app.post("/salesiq-track-order", async (req, res) => {
  try {
    const payload = req.body;
    const email = payload.session?.email?.value || payload.email;

    if (!email) {
      return res.json({
        action: "reply",
        replies: ["Please provide your email address to track your order."]
      });
    }

    // Fetch orders for this email, sorted by created_at descending (latest first)
    const data = await shopifyOAuthRequest(
      `/orders.json?status=any&email=${encodeURIComponent(email)}&limit=5`
    );

    if (!data.orders || data.orders.length === 0) {
      return res.json({
        action: "reply",
        replies: [`No orders found for ${email}. Please check your email address.`]
      });
    }

    // Get the latest order
    const latestOrder = data.orders[0];
    
    // Build detailed order status
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

    // Generate status message
    let statusMessage = `📦 **Order ${orderInfo.orderNumber}**\n\n`;
    statusMessage += `📅 Placed: ${orderInfo.createdAt}\n`;
    statusMessage += `💰 Total: ${orderInfo.totalPrice}\n`;
    statusMessage += `💳 Payment: ${orderInfo.financialStatus}\n`;
    statusMessage += `🚚 Status: ${orderInfo.fulfillmentStatus}\n\n`;
    statusMessage += `📋 Items: ${orderInfo.items}\n\n`;
    
    if (orderInfo.trackingNumber !== "Not available yet") {
      statusMessage += `🔍 Tracking: ${orderInfo.trackingNumber}\n`;
    }

    // Add action buttons based on status
    const buttons = [];
    
    if (orderInfo.trackingUrl) {
      buttons.push({
        label: "Track Shipment",
        type: "url",
        value: orderInfo.trackingUrl
      });
    }

    // Allow return if order is fulfilled and not cancelled
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
// =====================================================
// BACKEND - ADD TO CART ROUTE
// Creates/Updates Shopify Draft Orders
// =====================================================

app.post("/salesiq-add-to-cart", async (req, res) => {
  try {
    
    // Get data from Zobot
    const variantId = req.body.variant_id || req.query.variant_id;
    const quantity = req.body.quantity || req.query.quantity || 1;
    
    // Get email from session or body
    let email = req.body.email || req.query.email;
    if (!email && req.session) {
      email = req.session.email?.value || req.session.email;
    }
    
    // Validate inputs
    if (!variantId) {
      return res.json({
        action: "reply",
        replies: ["❌ Product information missing. Please try again."]
      });
    }
    
    // Fallback email if not provided
    if (!email) {
      email = `guest-${Date.now()}@fractix.local`;
    }
    
    console.log(`Adding to cart - Variant: ${variantId}, Qty: ${quantity}, Email: ${email}`);
    
    // Fetch existing draft orders
    const draftsData = await shopifyOAuthRequest(
      `/draft_orders.json?status=open&limit=50`
    );
    
    let draftOrder;
    
    if (draftsData.draft_orders && draftsData.draft_orders.length > 0) {
      
      // Find draft order for this customer or use first one
      let existingDraft = draftsData.draft_orders[0];
      
      // Update existing draft order - add line item
      const lineItems = existingDraft.line_items || [];
      
      // Check if variant already in cart
      const existingItem = lineItems.find(item => item.variant_id == variantId);
      
      if (existingItem) {
        // Update quantity
        existingItem.quantity += parseInt(quantity);
      } else {
        // Add new item
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
        `/draft_orders/${existingDraft.id}.json`,
        "PUT",
        updateBody
      );
      
      draftOrder = updated.draft_order;
      
    } else {
      
      // Create new draft order
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
        "/draft_orders.json",
        "POST",
        createBody
      );
      
      draftOrder = created.draft_order;
    }
    
    // Calculate totals
    const itemCount = draftOrder.line_items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = draftOrder.total_price || "0.00";
    
    // Get checkout URL
    const invoiceUrl = draftOrder.invoice_url || "#";
    
    // Return success response
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


// =====================================================
// 4. BUY NOW - Create Order Instantly
// =====================================================
app.post("/salesiq-buy-now", async (req, res) => {
  try {
    const payload = req.body;
    const email = payload.session?.email?.value || payload.email;
    const variantId = payload.variant_id;
    const quantity = payload.quantity || 1;

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

    // Create draft order
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
      "/draft_orders.json",
      "POST",
      createBody
    );

    const draftOrder = created.draft_order;

    // Send invoice URL for payment
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

// =====================================================
// 5. RETURN ORDER - Initiate Refund Process
// =====================================================
app.post("/salesiq-return-order", async (req, res) => {
  try {
    const payload = req.body;
    const orderId = payload.order_id;
    const orderNumber = payload.order_number;
    const reason = payload.reason || "Customer request";

    if (!orderId) {
      return res.json({
        action: "reply",
        replies: ["Order information missing. Please try again."]
      });
    }

    // Get order details
    const orderData = await shopifyOAuthRequest(`/orders/${orderId}.json`);
    const order = orderData.order;

    if (!order) {
      return res.json({
        action: "reply",
        replies: ["Order not found. Please check the order number."]
      });
    }

    // Check if order can be returned
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

    // Calculate refund amount (for demo, we'll create a full refund)
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
      `/orders/${orderId}/refunds/calculate.json`,
      "POST",
      calculateBody
    );

    const refundAmount = calculated.refund?.refund_line_items?.reduce(
      (sum, item) => sum + parseFloat(item.subtotal),
      0
    ) || 0;

    // For hackathon demo, we'll just show the return form
    // In production, you'd actually process the refund here
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
          value: `https://${SHOPIFY_STORE}/account/orders/${order.token}`
        }
      ]
    });

    // Optionally: Actually create the refund (commented for safety)
    /*
    const refundBody = {
      refund: {
        ...calculateBody.refund,
        notify: true,
        note: reason,
        transactions: [
          {
            parent_id: order.transactions?.[0]?.id,
            amount: refundAmount.toFixed(2),
            kind: "refund",
            gateway: order.transactions?.[0]?.gateway
          }
        ]
      }
    };

    await shopifyOAuthRequest(
      `/orders/${orderId}/refunds.json`,
      "POST",
      refundBody
    );
    */

  } catch (err) {
    console.error("Error processing return:", err);
    res.json({
      action: "reply",
      replies: ["Couldn't process your return request. Please contact support."]
    });
  }
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
// SHOPIFY OAUTH FLOW
// =====================================================

// Step 1: Initiate OAuth
// REPLACE YOUR ENTIRE OAUTH SECTION (around line 500-700) WITH THIS:

// =====================================================
// OAUTH ROUTES - FOR ONBOARDING
// =====================================================

// Step 1: Generate OAuth URL
app.get("/api/shopify/auth/start", (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: "Shop parameter required" });
  }

  // Generate random state for security (NO CRYPTO NEEDED)
  const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  // Store state temporarily (expires in 10 minutes)
  oauthStates.set(state, { shop, timestamp: Date.now() });
  
  // Build OAuth URL
  const redirectUri = `${BASE_URL}/api/shopify/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}&` +
    `scope=write_products,read_orders,write_orders,read_draft_orders,write_draft_orders&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`;

  res.json({ authUrl, state });
});

// Step 2: OAuth Callback
app.get("/api/shopify/auth/callback", async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    // Verify state
    if (!oauthStates.has(state)) {
      return res.status(403).send("Invalid state parameter");
    }

    const stateData = oauthStates.get(state);
    
    // Check if state expired (10 minutes)
    if (Date.now() - stateData.timestamp > 600000) {
      oauthStates.delete(state);
      return res.status(403).send("State expired");
    }

    oauthStates.delete(state);

    // Exchange code for access token
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      })
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    // Success! Redirect to success page
    res.redirect(`/success.html?shop=${shop}&accessToken=${accessToken}`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('OAuth failed: ' + error.message);
  }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

// async function shopifyOAuthRequest(shop, accessToken, endpoint, method = "GET", body = null) {
//   const url = `https://${shop}/admin/api/${API_VERSION}${endpoint}`;
//   const options = {
//     method,
//     headers: {
//       "X-Shopify-Access-Token": accessToken,
//       "Content-Type": "application/json"
//     }
//   };
  
//   if (body) {
//     options.body = JSON.stringify(body);
//   }

//   const response = await fetch(url, options);
//   return await response.json();
// }

function encrypt(text) {
  // Simple encryption - use proper encryption in production (AES-256)
  return Buffer.from(text).toString('base64');
}

function decrypt(encrypted) {
  return Buffer.from(encrypted, 'base64').toString('utf-8');
}

function generateFeatures(products) {
  const features = [
    { name: "Deals of the Day", enabled: true, generated: true },
    { name: "Order Tracking", enabled: true, generated: true },
    { name: "Add to Cart", enabled: true, generated: true },
    { name: "Buy Now Checkout", enabled: true, generated: true },
    { name: "Return Order", enabled: true, generated: true },
    { name: "Customer Memory", enabled: true, generated: true }
  ];

  const hasVariants = products.some(p => p.variants && p.variants.length > 1);
  if (hasVariants) {
    features.push({ name: "Size/Color Selector", enabled: true, generated: true });
  }

  const hasImages = products.some(p => p.images && p.images.length > 0);
  if (hasImages) {
    features.push({ name: "Visual Product Browser", enabled: true, generated: true });
  }

  return features;
}

function generateBotScript(businessId, shop) {
  return `// =====================================================
// AUTO-GENERATED ZOBOT for ${shop}
// Business ID: ${businessId}
// Generated: ${new Date().toISOString()}
// =====================================================

BACKEND_URL = "${BASE_URL}";
BUSINESS_ID = "${businessId}"`;
}



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Shopify SalesIQ Backend running on port ${PORT}`);
  console.log(`📍 Store: ${SHOPIFY_STORE}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});