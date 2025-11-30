// =====================================================
// COMPLETE SHOPIFY + SALESIQ BOT BACKEND - CORRECTED
// Multi-Tenant AI-Powered E-Commerce Bot
// =====================================================

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import persistence from './persistence.js';

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

// =====================================================
// CONFIGURATION
// =====================================================

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const API_VERSION = "2024-10";
const BASE_URL = "https://zocie.onrender.com";

// Validate env vars
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    console.error('❌ MISSING REQUIRED ENV VARS:');
    console.error('   SHOPIFY_API_KEY:', SHOPIFY_API_KEY ? '✓' : '❌ MISSING');
    console.error('   SHOPIFY_API_SECRET:', SHOPIFY_API_SECRET ? '✓' : '❌ MISSING');
}

// =====================================================
// DATABASES (In-Memory + Persistence)
// =====================================================

const oauthStates = new Map(); // state → { shop, timestamp }
let businessDatabase = new Map(); // businessId → business data
const shopToBusinessMap = new Map(); // shop domain → businessId
const userSessions = new Map(); // "businessId_userId" → conversation memory

// =====================================================
// CONVERSATION MEMORY CLASS - FIXED
// =====================================================

class ConversationMemory {
  constructor(businessId, userId) {
    this.businessId = businessId;
    this.userId = userId;
    this.messages = [];
    this.context = {
      email: null,
      previousActions: [],
      lastIntent: null,
      userData: {}
    };
  }

  // FIXED: Now accepts metadata with intent
  addMessage(role, content, metadata = {}) {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }

  remember(key, value) {
    this.context[key] = value;
    if (key === 'email') {
      this.context.email = value;
    }
  }

  recall(key) {
    return this.context[key];
  }

  // FIXED: Complete context getter
  getContext() {
    return { ...this.context };
  }

  async saveToFile() {
    try {
      await persistence.saveConversationMemory(this.businessId, this.userId, {
        messages: this.messages,
        context: this.context
      });
    } catch (error) {
      console.error(`Error saving conversation: ${error.message}`);
    }
  }

  static async loadFromFile(businessId, userId) {
    const data = await persistence.loadConversationMemory(businessId, userId);
    if (!data) {
      return new ConversationMemory(businessId, userId);
    }
    const memory = new ConversationMemory(businessId, userId);
    memory.messages = data.messages || [];
    memory.context = data.context || {};
    return memory;
  }
}

// =====================================================
// BUSINESS MANAGEMENT FUNCTIONS - FIXED
// =====================================================

function generateBusinessId() {
    return 'biz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// FIXED: Made truly async and persists to file
async function saveBusinessData(businessData) {
  try {
    businessDatabase.set(businessData.businessId, businessData);
    await persistence.saveBusinessData(businessData.businessId, businessData);
    console.log(`✅ Business data saved: ${businessData.businessId}`);
  } catch (error) {
    console.error(`❌ Error saving business data:`, error);
    throw error;
  }
}

// FIXED: Made async and loads from file if not in memory
async function getBusinessData(businessId) {
    let business = businessDatabase.get(businessId);
    
    if (!business) {
      business = await persistence.loadBusinessData(businessId);
      if (business) {
        businessDatabase.set(businessId, business);
      }
    }
    
    return business || null;
}

async function getBusinessIdByShop(shopDomain) {
    return shopToBusinessMap.get(shopDomain);
}

// =====================================================
// SHOPIFY API HELPER - FIXED
// =====================================================

async function shopifyApiCall(shopDomain, adminToken, endpoint, method = "GET", body = null) {
    if (!shopDomain || !adminToken) {
      console.error('❌ Missing shopDomain or adminToken');
      return null;
    }

    const url = `https://${shopDomain}/admin/api/${API_VERSION}${endpoint}`;
    const options = {
        method,
        headers: {
            "X-Shopify-Access-Token": adminToken,
            "Content-Type": "application/json"
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Shopify API error: ${response.status} ${response.statusText}`);
            console.error(`   Details: ${errorText}`);
            return null;
        }
        return await response.json();
    } catch (error) {
        console.error(`❌ Shopify API call failed: ${error.message}`);
        return null;
    }
}

// =====================================================
// INTENT DETECTION (NLP) - FIXED
// =====================================================

// FIXED: Returns object with intent AND confidence
async function detectIntent(userMessage) {
    const msg = userMessage.toLowerCase().trim();

    const intents = {
        track_order: {
            patterns: /track|status|where|delivery|order|shipping/,
            confidence: 0.95
        },
        browse_deals: {
            patterns: /deal|product|browse|show|what.*sell|what.*have|catalog|collection/,
            confidence: 0.9
        },
        add_cart: {
            patterns: /add.*cart|add to cart|add this|want to buy|interested/,
            confidence: 0.9
        },
        buy_now: {
            patterns: /buy now|checkout|payment|purchase|price|cost|how much/,
            confidence: 0.85
        },
        return_order: {
            patterns: /return|refund|money back|cancel|issue|wrong|damaged|not good/,
            confidence: 0.9
        },
        product_info: {
            patterns: /tell|about|info|details|describe|specifications|spec/,
            confidence: 0.8
        }
    };

    for (const [intent, { patterns, confidence }] of Object.entries(intents)) {
        if (patterns.test(msg)) {
            return { intent, confidence };
        }
    }

    return { intent: "general_query", confidence: 0.5 };
}

// =====================================================
// ACTION EXECUTION (Business Logic) - FIXED
// =====================================================

// FIXED: Made truly async, all shopifyCall operations awaited
async function executeAction(intent, userMessage, context, shopDomain, adminToken) {
    if (!shopDomain || !adminToken) {
      console.error('❌ Missing shop or token');
      return { message: "Configuration error. Please reconnect.", suggestions: ["Help"] };
    }

    const shopifyCall = (endpoint, method = "GET", body = null) =>
        shopifyApiCall(shopDomain, adminToken, endpoint, method, body);

    switch (intent) {
        case 'track_order': {
            let email = context.email;

            if (!email) {
                const emailMatch = userMessage.match(/[\w\.-]+@[\w\.-]+/);
                if (emailMatch) {
                    email = emailMatch[0];
                }
            }

            if (!email) {
                return {
                    needsInfo: true,
                    fieldNeeded: "email",
                    question: "📧 What's your email to find your order?",
                    inputType: "email"
                };
            }

            const ordersData = await shopifyCall(
                `/orders.json?status=any&email=${encodeURIComponent(email)}&limit=1`
            );

            if (!ordersData?.orders || ordersData.orders.length === 0) {
                return {
                    message: `No orders found for ${email}. Please check your email address.`,
                    suggestions: ["Browse Products", "Help"]
                };
            }

            const order = ordersData.orders[0];
            return {
                message: `📦 **Order #${order.name}**\nStatus: ${order.fulfillment_status || 'Pending'}\nTotal: ${order.total_price} ${order.currency}\nPlaced: ${new Date(order.created_at).toLocaleDateString()}`,
                remember: true,
                data: { email, orderId: order.id },
                buttons: [
                    {
                        label: "Track Shipment",
                        type: "url",
                        value: order.order_status_url
                    }
                ],
                suggestions: ["View Details", "Return Order", "Browse Products"]
            };
        }

        case 'browse_deals': {
            const productsData = await shopifyCall(
                `/products.json?limit=10&sort=created_at:desc`
            );

            if (!productsData?.products || productsData.products.length === 0) {
                return {
                    message: "🛍️ No products available right now.",
                    suggestions: ["Check Back Later"]
                };
            }

            const deals = productsData.products.slice(0, 5).map(p => {
                const variant = p.variants?.[0];
                const price = variant?.price || "N/A";
                const comparePrice = variant?.compare_at_price;

                let priceText = `$${price}`;
                if (comparePrice && parseFloat(comparePrice) > parseFloat(price)) {
                    const discount = Math.round(
                        ((comparePrice - price) / comparePrice) * 100
                    );
                    priceText = `🔥 $${price} (Save ${discount}%)`;
                }

                return `• **${p.title}** - ${priceText}`;
            }).join('\n');

            return {
                message: `🛍️ **Today's Top Deals**\n\n${deals}`,
                suggestions: ["Show More", "Add to Cart", "View Details"],
                remember: true,
                data: { productCount: productsData.products.length }
            };
        }

        case 'add_cart': {
            let email = context.email;
            if (!email) {
                const emailMatch = userMessage.match(/[\w\.-]+@[\w\.-]+/);
                if (emailMatch) {
                    email = emailMatch[0];
                }
            }

            if (!email) {
                return {
                    needsInfo: true,
                    fieldNeeded: "email",
                    question: "📧 I need your email to add items to your cart",
                    inputType: "email"
                };
            }

            const draftBody = {
                draft_order: {
                    email: email,
                    note: "Created via SalesIQ Bot"
                }
            };

            const draftData = await shopifyCall(
                `/draft_orders.json`,
                "POST",
                draftBody
            );

            if (!draftData?.draft_order) {
                return {
                    message: "⚠️ Could not add to cart. Please try again.",
                    suggestions: ["Try Again", "Browse Products"]
                };
            }

            return {
                message: `✅ **Cart Created!**\n\nReady to add items?\nCheckout URL: ${draftData.draft_order.invoice_url}`,
                remember: true,
                data: { email, draftOrderId: draftData.draft_order.id },
                buttons: [
                    {
                        label: "Go to Checkout",
                        type: "url",
                        value: draftData.draft_order.invoice_url
                    }
                ],
                suggestions: ["Browse More", "View Cart"]
            };
        }

        case 'buy_now': {
            let email = context.email;
            if (!email) {
                return {
                    needsInfo: true,
                    fieldNeeded: "email",
                    question: "📧 What's your email to complete the purchase?",
                    inputType: "email"
                };
            }

            return {
                message: `💳 **Ready to Checkout!**\n\nPlease proceed to complete your purchase.\n\nClick the button below to go to our secure checkout.`,
                suggestions: ["Browse More", "Help"]
            };
        }

        case 'return_order': {
            let email = context.email;
            if (!email) {
                return {
                    needsInfo: true,
                    fieldNeeded: "email",
                    question: "📧 What's your email for the return?",
                    inputType: "email"
                };
            }

            return {
                message: `🔄 **Return Process**\n\nWe'll help you process your return.\n\n1️⃣ Please describe the issue\n2️⃣ We'll verify your order\n3️⃣ Send return label\n4️⃣ Process refund\n\nWhat's the issue with your order?`,
                suggestions: ["Damaged", "Wrong Item", "Not As Described", "Cancel"]
            };
        }

        default: {
            return {
                message: `👋 Hi! How can I help you today?\n\n💬 You can:\n• 🛍️ Browse deals\n• 📦 Track orders\n• 🛒 Add to cart\n• 💳 Buy now\n• 🔄 Return items`,
                suggestions: ["Browse Deals", "Track Order", "Add to Cart", "Help"]
            };
        }
    }
}

// =====================================================
// BUILD SALESIQ RESPONSE - FIXED
// =====================================================

// FIXED: Complete implementation with proper validation
function buildSalesIQResponse(actionResult) {
    const response = {};

    if (!actionResult) {
      return {
        action: "reply",
        replies: ["An error occurred. Please try again."]
      };
    }

    if (actionResult.needsInfo) {
        response.action = "context";
        response.context_id = actionResult.fieldNeeded;
        response.questions = [
            {
                name: actionResult.fieldNeeded,
                replies: [actionResult.question],
                ...(actionResult.inputType && {
                    input: {
                        type: actionResult.inputType,
                        ...(actionResult.inputType === "email" && {
                            validate: { format: "email" }
                        })
                    }
                })
            }
        ];
    } else {
        response.action = "reply";
        response.replies = [actionResult.message || "No response"];

        if (actionResult.suggestions) {
            response.suggestions = actionResult.suggestions;
        }

        if (actionResult.buttons) {
            response.buttons = actionResult.buttons;
        }
    }

    return response;
}

// =====================================================
// OAUTH ROUTES - FIXED
// =====================================================

app.get("/api/shopify/auth/start", (req, res) => {
    const shop = req.query.shop;

    if (!shop) {
        return res.status(400).json({ error: "Shop parameter required" });
    }

    if (!SHOPIFY_API_KEY) {
        return res.status(500).json({
            error: "Server configuration error: SHOPIFY_API_KEY not set"
        });
    }

    const state = Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);

    oauthStates.set(state, { shop, timestamp: Date.now() });

    const redirectUri = `${BASE_URL}/api/shopify/auth/callback`;
    const authUrl = `https://${shop}/admin/oauth/authorize?` +
        `client_id=${SHOPIFY_API_KEY}&` +
        `scope=write_products,read_orders,write_orders,read_draft_orders,write_draft_orders&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}`;

    console.log('🔗 OAuth URL generated for shop:', shop);
    res.json({ authUrl, state });
});

app.get("/api/shopify/auth/callback", async (req, res) => {
    try {
        // FIXED: Proper destructuring syntax
        const { code, shop, state } = req.query;

        console.log('📥 OAuth callback received:', { shop, hasCode: !!code, hasState: !!state });

        if (!oauthStates.has(state)) {
            console.error('❌ Invalid state parameter');
            return res.status(403).send("Invalid state parameter - please try connecting again");
        }

        const stateData = oauthStates.get(state);

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

        const shopDetailsUrl = `https://${shop}/admin/api/${API_VERSION}/shop.json`;
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

        const businessId = generateBusinessId();
        console.log('🆔 Generated businessId:', businessId);

        // FIXED: Properly awaited save
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
        shopToBusinessMap.set(shop, businessId);

        const productsUrl = `https://${shop}/admin/api/${API_VERSION}/products.json?limit=1`;
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

        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bot Configuration Ready!</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gradient-to-br from-green-50 to-blue-100 min-h-screen flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full">
          <div class="bg-gradient-to-r from-green-500 to-green-600 p-8 text-center">
            <div class="text-6xl mb-4">✅</div>
            <h1 class="text-4xl font-bold text-white mb-2">Bot is Ready!</h1>
            <p class="text-green-100">Your store is connected and configured</p>
          </div>
          <div class="p-8">
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
              </div>
            </div>
            <div class="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-6">
              <h3 class="text-lg font-bold text-gray-800 mb-3">🔗 Webhook for SalesIQ</h3>
              <div class="bg-white rounded p-4 mb-4 flex items-center justify-between">
                <code class="text-sm font-mono text-gray-800 break-all">${businessData.webhookUrl}</code>
                <button onclick="copyToClipboard('${businessData.webhookUrl}')" class="ml-3 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold whitespace-nowrap">Copy</button>
              </div>
            </div>
          </div>
        </div>
        <script>
          function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
              alert('✅ Webhook URL copied!');
            });
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
          <button onclick="window.history.back()" class="bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold">Try Again</button>
        </div>
      </body>
      </html>
    `);
    }
});

console.log('✅ PART 1 LOADED - Setup through OAuth complete');
// =====================================================
// PART 2: MULTI-TENANT ZOBOT WEBHOOK - FIXED
// =====================================================

app.post("/api/zobot/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📨 WEBHOOK REQUEST RECEIVED`);
    console.log(`Business ID: ${businessId}`);
    console.log(`${'='.repeat(60)}\n`);

    // ✅ LOAD BUSINESS DATA - FIXED: Now properly async
    const business = await getBusinessData(businessId);
    
    if (!business) {
      console.error(`❌ Business not found: ${businessId}`);
      return res.json({
        action: "reply",
        replies: ["Sorry, bot configuration not found. Please reconnect your store."]
      });
    }

    console.log(`✅ Business found: ${business.shopName}`);

    const { adminToken, shopDomain } = business;
    
    // ✅ EXTRACT MESSAGE - FIXED: Handle all possible formats
    let messageText = null;
    let visitor = {};
    let operation = "message";

    console.log(`\n🔍 Parsing message from SalesIQ...`);

    if (req.body?.message?.text) {
      messageText = req.body.message.text;
      visitor = req.body.visitor || {};
      operation = req.body.operation || "message";
      console.log(`✅ Format 1: Direct message.text found`);
    } 
    else if (req.body?.text) {
      messageText = req.body.text;
      visitor = req.body.visitor || {};
      console.log(`✅ Format 2: Root level text found`);
    } 
    else if (req.body?.session?.message) {
      messageText = req.body.session.message;
      visitor = req.body.session.visitor || {};
      console.log(`✅ Format 3: Session message found`);
    }
    else if (req.body?.data?.message) {
      messageText = req.body.data.message;
      visitor = req.body.data.visitor || {};
      console.log(`✅ Format 4: Data wrapper found`);
    }
    else if (req.body?.payload?.message) {
      messageText = req.body.payload.message;
      visitor = req.body.payload.visitor || {};
      console.log(`✅ Format 5: Payload wrapper found`);
    }
    else {
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string' && value.trim().length > 0) {
          messageText = value;
          console.log(`✅ Format 6: Found text in key: ${key}`);
          break;
        }
        if (typeof value === 'object' && value?.text) {
          messageText = value.text;
          console.log(`✅ Format 7: Found text in nested object: ${key}`);
          break;
        }
      }
    }

    // FIXED: Proper validation
    if (!messageText || messageText.trim() === '') {
      console.error(`❌ No message text found`);
      
      return res.json({
        action: "reply",
        replies: [
          "I couldn't understand your message. Please try again.",
          "Try: 'show deals', 'track order', 'add to cart'"
        ],
        suggestions: ["Browse Deals", "Track Order", "Help"]
      });
    }

    console.log(`📝 Message: "${messageText}"`);
    console.log(`👤 Visitor: ${JSON.stringify(visitor)}`);

    const userId = visitor?.email || visitor?.id || visitor?.name || `user_${Date.now()}`;
    console.log(`🆔 User ID: ${userId}`);

    // ✅ GET OR CREATE CONVERSATION MEMORY - FIXED
    const memoryKey = `${businessId}_${userId}`;
    let memory = userSessions.get(memoryKey);
    
    if (!memory) {
      // Try loading from persistence
      memory = await ConversationMemory.loadFromFile(businessId, userId);
      userSessions.set(memoryKey, memory);
      console.log(`✨ Session created/loaded from persistence`);
    }

    const activeSessions = Array.from(userSessions.keys()).filter(k => k.startsWith(businessId)).length;
    console.log(`💾 Active sessions for this business: ${activeSessions}`);

    // ✅ DETECT INTENT - FIXED
    console.log(`\n🧠 INTENT DETECTION`);
    const { intent, confidence } = await detectIntent(messageText);
    console.log(`   Intent: ${intent}`);
    console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`);
    
    // FIXED: Pass metadata with intent
    memory.addMessage('user', messageText, { intent });

    // ✅ GET CONTEXT FROM MEMORY - FIXED
    const context = memory.getContext();
    console.log(`\n📋 CONTEXT`);
    console.log(`   Email: ${context.email || 'Not set'}`);
    console.log(`   Previous actions: ${context.previousActions?.length || 0}`);

    // ✅ EXECUTE ACTION - FIXED: All async properly awaited
    console.log(`\n⚙️ EXECUTING ACTION`);
    console.log(`   Shop: ${shopDomain}`);
    console.log(`   Intent: ${intent}`);
    
    const actionResult = await executeAction(
      intent,
      messageText,
      context,
      shopDomain,
      adminToken
    );

    if (!actionResult) {
      throw new Error('Action execution returned null');
    }

    console.log(`   ✅ Action completed`);

    // ✅ BUILD SALESIQ RESPONSE - FIXED
    const response = buildSalesIQResponse(actionResult);
    console.log(`\n📤 RESPONSE`);
    console.log(`   Action: ${response.action}`);
    console.log(`   Replies: ${response.replies?.length || 0}`);
    
    // ✅ REMEMBER FOR NEXT INTERACTION - FIXED
    memory.addMessage('bot', actionResult.message);
    
    if (actionResult.remember && actionResult.data) {
      memory.remember(intent, actionResult.data);
      // FIXED: Save memory after interaction
      await memory.saveToFile();
      console.log(`   💾 Data saved to persistence`);
    }

    console.log(`\n✅ Response sent successfully`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json(response);

  } catch (error) {
    console.error(`\n${'='.repeat(60)}`);
    console.error(`❌ ZOBOT WEBHOOK ERROR`);
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error(`${'='.repeat(60)}\n`);
    
    res.status(500).json({
      action: "reply",
      replies: [
        `⚠️ An error occurred: ${error.message}`,
        "Please try again or contact support."
      ],
      suggestions: ["Help", "Browse Deals"]
    });
  }
});

// =====================================================
// GET BUSINESS DATA ENDPOINT - FIXED
// =====================================================

app.get("/api/business/:businessId", async (req, res) => {
    try {
        const { businessId } = req.params;
        // FIXED: Now properly awaits
        const business = await getBusinessData(businessId);

        if (!business) {
            return res.status(404).json({ error: "Business not found" });
        }

        res.json({
            businessId: business.businessId,
            shopName: business.shopName,
            shopDomain: business.shopDomain,
            shopEmail: business.shopEmail,
            currency: business.currency,
            timezone: business.timezone,
            status: business.status,
            connectedAt: business.connectedAt,
            webhookUrl: business.webhookUrl,
            features: [
                { name: "Browse Deals", enabled: true },
                { name: "Track Orders", enabled: true },
                { name: "Add to Cart", enabled: true },
                { name: "Buy Now", enabled: true },
                { name: "Process Returns", enabled: true },
                { name: "Memory Context", enabled: true }
            ]
        });

    } catch (error) {
        console.error('❌ Error fetching business data:', error);
        res.status(500).json({ error: error.message });
    }
});

// =====================================================
// LEGACY ENDPOINTS - FIXED
// =====================================================

// Deals endpoint
app.post("/salesiq-deals", async (req, res) => {
    try {
        const firstBusiness = Array.from(businessDatabase.values())[0];

        if (!firstBusiness) {
            return res.json({
                cards: [],
                message: "No store connected. Please connect a Shopify store first."
            });
        }

        // FIXED: Properly awaited
        const data = await shopifyApiCall(
            firstBusiness.shopDomain,
            firstBusiness.adminToken,
            "/products.json?limit=10&sort=created_at:desc"
        );

        const products = data?.products || [];

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
            const productUrl = `https://${firstBusiness.shopDomain}/products/${p.handle}`;

            let subtitle = `$${price}`;
            if (compare && parseFloat(compare) > parseFloat(price)) {
                const discount = Math.round(((compare - price) / compare) * 100);
                subtitle = `🔥 $${price} (Save ${discount}%)`;
            }

            return {
                title: p.title,
                subtitle: subtitle,
                image: img,
                buttons: [
                    {
                        label: "View More",
                        type: "url",
                        value: productUrl
                    },
                    {
                        label: "Add to Cart",
                        type: "text",
                        value: { variant_id: v?.id || "", price: price }
                    }
                ]
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
            message: "Failed to load deals."
        });
    }
});

// Track order endpoint
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

        const firstBusiness = Array.from(businessDatabase.values())[0];

        if (!firstBusiness) {
            return res.json({
                action: "reply",
                replies: ["No store connected."]
            });
        }

        // FIXED: Properly awaited
        const data = await shopifyApiCall(
            firstBusiness.shopDomain,
            firstBusiness.adminToken,
            `/orders.json?status=any&email=${encodeURIComponent(email)}&limit=5`
        );

        if (!data?.orders || data.orders.length === 0) {
            return res.json({
                action: "reply",
                replies: [`No orders found for ${email}.`]
            });
        }

        const latestOrder = data.orders[0];

        const statusMessage = `📦 **Order #${latestOrder.name}**\n\n` +
            `📅 Placed: ${new Date(latestOrder.created_at).toLocaleDateString()}\n` +
            `💰 Total: ${latestOrder.total_price} ${latestOrder.currency}\n` +
            `💳 Payment: ${latestOrder.financial_status}\n` +
            `🚚 Status: ${latestOrder.fulfillment_status || 'Unfulfilled'}\n\n` +
            `📋 Items: ${latestOrder.line_items.map(item => `${item.quantity}x ${item.name}`).join(', ')}`;

        const buttons = [];
        if (latestOrder.order_status_url) {
            buttons.push({
                label: "Track Shipment",
                type: "url",
                value: latestOrder.order_status_url
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

// Add to cart endpoint
app.post("/salesiq-add-to-cart", async (req, res) => {
    try {
        const variantId = req.body.variant_id || req.query.variant_id;
        const quantity = req.body.quantity || req.query.quantity || 1;
        let email = req.body.email || req.query.email;

        if (!variantId) {
            return res.json({
                action: "reply",
                replies: ["❌ Product information missing. Please try again."]
            });
        }

        if (!email) {
            email = `guest-${Date.now()}@store.local`;
        }

        const firstBusiness = Array.from(businessDatabase.values())[0];

        if (!firstBusiness) {
            return res.json({
                action: "reply",
                replies: ["No store connected."]
            });
        }

        const draftBody = {
            draft_order: {
                email: email,
                line_items: [
                    {
                        variant_id: parseInt(variantId),
                        quantity: parseInt(quantity)
                    }
                ]
            }
        };

        // FIXED: Properly awaited
        const draftData = await shopifyApiCall(
            firstBusiness.shopDomain,
            firstBusiness.adminToken,
            "/draft_orders.json",
            "POST",
            draftBody
        );

        if (!draftData?.draft_order) {
            return res.json({
                action: "reply",
                replies: ["⚠️ Error adding to cart. Please try again."]
            });
        }

        const itemCount = draftData.draft_order.line_items?.length || 1;
        const totalPrice = draftData.draft_order.total_price || "0.00";

        return res.json({
            action: "reply",
            replies: [
                `✅ Added to cart!\n\n🛒 Cart: ${itemCount} item(s)\n💰 Total: $${totalPrice}`
            ],
            suggestions: ["🛍️ Browse More", "📦 View Cart", "💳 Checkout"]
        });

    } catch (err) {
        console.error("Error adding to cart:", err);
        return res.json({
            action: "reply",
            replies: [
                `⚠️ Error adding to cart: ${err.message}`
            ]
        });
    }
});

// Buy now endpoint
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

        const firstBusiness = Array.from(businessDatabase.values())[0];

        if (!firstBusiness) {
            return res.json({
                action: "reply",
                replies: ["No store connected."]
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
                ]
            }
        };

        // FIXED: Properly awaited
        const created = await shopifyApiCall(
            firstBusiness.shopDomain,
            firstBusiness.adminToken,
            "/draft_orders.json",
            "POST",
            createBody
        );

        const draftOrder = created?.draft_order;

        if (!draftOrder) {
            return res.json({
                action: "reply",
                replies: ["Couldn't process your order. Please try again."]
            });
        }

        res.json({
            action: "reply",
            replies: [
                `🎉 Your order is ready!\n\n💰 Total: $${draftOrder.total_price}`
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

// Return order endpoint
app.post("/salesiq-return-order", async (req, res) => {
    try {
        const payload = req.body;
        const orderId = payload.order_id;
        const orderNumber = payload.order_number;

        if (!orderId) {
            return res.json({
                action: "reply",
                replies: ["Order information missing. Please try again."]
            });
        }

        const firstBusiness = Array.from(businessDatabase.values())[0];

        if (!firstBusiness) {
            return res.json({
                action: "reply",
                replies: ["No store connected."]
            });
        }

        // FIXED: Properly awaited
        const orderData = await shopifyApiCall(
            firstBusiness.shopDomain,
            firstBusiness.adminToken,
            `/orders/${orderId}.json`
        );

        const order = orderData?.order;

        if (!order) {
            return res.json({
                action: "reply",
                replies: ["Order not found. Please check the order number."]
            });
        }

        res.json({
            action: "reply",
            replies: [
                `🔄 **Return Request for Order #${orderNumber}**\n\nYour return has been initiated.`
            ],
            buttons: [
                {
                    label: "Track Return",
                    type: "url",
                    value: `https://${firstBusiness.shopDomain}/account/orders/${order.token}`
                }
            ]
        });

    } catch (err) {
        console.error("Error processing return:", err);
        res.json({
            action: "reply",
            replies: ["Couldn't process your return. Please contact support."]
        });
    }
});

console.log('✅ PART 2 LOADED - Webhooks and legacy endpoints complete');
// =====================================================
// PART 3: HOME PAGE & UTILITY ENDPOINTS
// =====================================================

app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Self-Driving Store Bot</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen">
      <div class="container mx-auto px-4 py-12">
        <div class="text-center mb-12">
          <h1 class="text-5xl font-bold text-gray-800 mb-4">🤖 Self-Driving Store Bot</h1>
          <p class="text-xl text-gray-600">AI-Powered E-Commerce Bot for Zoho SalesIQ</p>
        </div>

        <div class="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl p-8">
          <div class="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-center rounded-lg mb-8">
            <h2 class="text-2xl font-bold text-white">✅ Bot Backend Active</h2>
            <p class="text-blue-100">All systems operational</p>
          </div>
          
          <div class="grid md:grid-cols-2 gap-6 mb-8">
            <div class="bg-green-50 p-6 rounded-lg">
              <h3 class="font-bold text-gray-800 mb-2">📊 Connected Stores</h3>
              <p class="text-3xl font-bold text-green-600">${businessDatabase.size}</p>
              <p class="text-sm text-gray-600">Active businesses</p>
            </div>
            <div class="bg-blue-50 p-6 rounded-lg">
              <h3 class="font-bold text-gray-800 mb-2">💬 Active Sessions</h3>
              <p class="text-3xl font-bold text-blue-600">${userSessions.size}</p>
              <p class="text-sm text-gray-600">Conversations in progress</p>
            </div>
          </div>

          <div class="space-y-4">
            <h3 class="text-lg font-bold text-gray-800 mb-4">🚀 Features Active</h3>
            <ul class="space-y-2 text-gray-700">
              <li>✅ Multi-tenant Shopify integration</li>
              <li>✅ Natural language intent detection</li>
              <li>✅ Conversation memory system</li>
              <li>✅ Real-time product fetching</li>
              <li>✅ Order tracking & management</li>
              <li>✅ Draft order creation</li>
              <li>✅ Return processing</li>
              <li>✅ Zoho SalesIQ webhook support</li>
              <li>✅ File-based persistence</li>
            </ul>
          </div>

          <div class="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p class="text-sm text-yellow-800">
              🔗 <strong>Webhook Format:</strong> POST /api/zobot/{businessId}
            </p>
            <p class="text-sm text-yellow-800 mt-2">
              📝 Each connected store gets a unique webhook URL
            </p>
          </div>
        </div>

        <div class="mt-12 text-center">
          <p class="text-gray-600">Status: <span class="font-bold text-green-600">🟢 Online</span></p>
          <p class="text-sm text-gray-500 mt-2">Last updated: ${new Date().toISOString()}</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// =====================================================
// HEALTH CHECK ENDPOINTS - FIXED
// =====================================================

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        businesses: businessDatabase.size,
        activeSessions: userSessions.size,
        environment: {
            SHOPIFY_API_KEY: SHOPIFY_API_KEY ? '✓ Set' : '❌ Missing',
            SHOPIFY_API_SECRET: SHOPIFY_API_SECRET ? '✓ Set' : '❌ Missing',
            BASE_URL: BASE_URL
        }
    });
});

app.get("/api/shopify/config-check", (req, res) => {
    res.json({
        configured: {
            SHOPIFY_API_KEY: !!SHOPIFY_API_KEY,
            SHOPIFY_API_SECRET: !!SHOPIFY_API_SECRET,
            BASE_URL: !!BASE_URL
        },
        values: {
            SHOPIFY_API_KEY: SHOPIFY_API_KEY ? `${SHOPIFY_API_KEY.substring(0, 10)}...` : 'NOT SET',
            BASE_URL: BASE_URL,
            BUSINESSES: businessDatabase.size
        },
        timestamp: new Date().toISOString()
    });
});

// =====================================================
// DEBUG ENDPOINTS - FIXED
// =====================================================

app.get("/api/debug/businesses", (req, res) => {
    const businesses = Array.from(businessDatabase.values()).map(b => ({
        businessId: b.businessId,
        shopDomain: b.shopDomain,
        shopName: b.shopName,
        status: b.status,
        connectedAt: b.connectedAt,
        webhookUrl: b.webhookUrl
    }));

    res.json({
        total: businesses.length,
        businesses: businesses
    });
});

app.get("/api/debug/sessions", (req, res) => {
    const sessions = Array.from(userSessions.entries()).map(([key, memory]) => ({
        key: key,
        businessId: memory.businessId,
        userId: memory.userId,
        messageCount: memory.messages.length,
        lastMessage: memory.messages[memory.messages.length - 1]?.timestamp
    }));

    res.json({
        total: sessions.length,
        sessions: sessions
    });
});

// =====================================================
// SERVER INITIALIZATION - FIXED
// =====================================================

let server = null;
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 STARTING SERVER INITIALIZATION');
    console.log('='.repeat(60) + '\n');

    // FIXED: Initialize persistence first
    console.log('📁 Initializing persistence layer...');
    await persistence.initializePersistence();
    console.log('✅ Persistence initialized\n');

    // FIXED: Load all businesses from files
    console.log('📦 Loading businesses from persistence...');
    const loadedBusinesses = await persistence.loadAllBusinesses();
    
    // Populate businessDatabase from loaded data
    for (const [businessId, business] of loadedBusinesses) {
      businessDatabase.set(businessId, business);
      if (business.shopDomain) {
        shopToBusinessMap.set(business.shopDomain, businessId);
      }
    }
    
    console.log(`✅ Loaded ${businessDatabase.size} businesses from persistence\n`);

    // FIXED: Start the Express server
    server = app.listen(PORT, () => {
      console.log(`🌐 Server running on port ${PORT}`);
      console.log(`📍 Base URL: ${BASE_URL}`);
      console.log('\n' + '='.repeat(60));
      console.log('✅ SERVER READY FOR PRODUCTION');
      console.log('='.repeat(60) + '\n');
      
      console.log('📊 SYSTEM STATUS:');
      console.log(`   • Connected stores: ${businessDatabase.size}`);
      console.log(`   • Active sessions: ${userSessions.size}`);
      console.log(`   • Persistence: ✅ Active`);
      console.log(`   • OAuth: ${SHOPIFY_API_KEY ? '✅ Configured' : '❌ Missing'}\n`);
    });

  } catch (error) {
    console.error('❌ ERROR STARTING SERVER:');
    console.error(error);
    process.exit(1);
  }
}

// =====================================================
// GRACEFUL SHUTDOWN - FIXED
// =====================================================

process.on('SIGTERM', () => {
  console.log('\n📴 SIGTERM signal received: closing HTTP server...');
  
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed');
      console.log(`📊 Final Stats:`);
      console.log(`   Connected Stores: ${businessDatabase.size}`);
      console.log(`   Active Sessions: ${userSessions.size}`);
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      console.error('❌ Server did not close gracefully, forcing exit');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('\n📴 SIGINT signal received: closing HTTP server...');
  
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed');
      console.log(`📊 Final Stats:`);
      console.log(`   Connected Stores: ${businessDatabase.size}`);
      console.log(`   Active Sessions: ${userSessions.size}`);
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      console.error('❌ Server did not close gracefully, forcing exit');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

// =====================================================
// START THE SERVER
// =====================================================

startServer();

console.log('✅ PART 3 LOADED - Server initialization complete');
console.log('✅ ALL FIXES APPLIED - Ready for production!');
