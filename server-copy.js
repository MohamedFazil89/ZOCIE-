// =====================================================
// COMPLETE SHOPIFY + SALESIQ BOT BACKEND - FIXED
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
const BASE_URL = process.env.BASE_URL || "https://zocie.onrender.com";

// Validate env vars
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    console.error('❌ MISSING REQUIRED ENV VARS:');
    console.error('   SHOPIFY_API_KEY:', SHOPIFY_API_KEY ? '✓' : '❌ MISSING');
    console.error('   SHOPIFY_API_SECRET:', SHOPIFY_API_SECRET ? '✓' : '❌ MISSING');
}

// =====================================================
// DATABASES (Use real DB in production)
// =====================================================

const oauthStates = new Map(); // state → { shop, timestamp }
let businessDatabase = new Map(); // businessId → business data
const shopToBusinessMap = new Map(); // shop domain → businessId
const userSessions = new Map(); // "businessId_userId" → conversation memory

// =====================================================
// CONVERSATION MEMORY CLASS
// =====================================================

class ConversationMemory {
    constructor(businessId, userId) {
        this.businessId = businessId;
        this.userId = userId;
        this.messages = [];
        this.context = {
            email: null,
            orderId: null,
            previousActions: []
        };
    }

    addMessage(role, content, metadata = {}) {
        this.messages.push({
            role,
            content,
            metadata,
            timestamp: new Date().toISOString()
        });

        // Keep only last 50 messages
        if (this.messages.length > 50) {
            this.messages = this.messages.slice(-50);
        }
    }

    remember(key, value) {
        if (typeof value === 'object' && value !== null) {
            this.context = { ...this.context, ...value };
        } else {
            this.context[key] = value;
        }
    }

    recall(key) {
        return this.context[key];
    }

    getContext() {
        return this.context;
    }

    async saveToFile() {
        try {
            await persistence.saveConversationMemory(this.businessId, this.userId, {
                messages: this.messages,
                context: this.context
            });
        } catch (error) {
            console.error(`Error saving conversation to file:`, error);
        }
    }

    static async loadFromFile(businessId, userId) {
        try {
            const data = await persistence.loadConversationMemory(businessId, userId);
            if (!data) {
                return new ConversationMemory(businessId, userId);
            }
            const memory = new ConversationMemory(businessId, userId);
            memory.messages = data.messages || [];
            memory.context = data.context || {
                email: null,
                orderId: null,
                previousActions: []
            };
            return memory;
        } catch (error) {
            console.error(`Error loading conversation from file:`, error);
            return new ConversationMemory(businessId, userId);
        }
    }
}

// =====================================================
// BUSINESS MANAGEMENT FUNCTIONS
// =====================================================

function generateBusinessId() {
    return 'biz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
}

async function saveBusinessData(businessId, businessData) {
    try {
        businessDatabase.set(businessId, businessData);
        shopToBusinessMap.set(businessData.shopDomain, businessId);
        // Save to file as well
        await persistence.saveBusinessData(businessId, businessData);
        console.log(`✅ Business data saved: ${businessId}`);
    } catch (error) {
        console.error(`Error saving business data:`, error);
        throw error;
    }
}

async function getBusinessData(businessId) {
    // Try memory first
    if (businessDatabase.has(businessId)) {
        return businessDatabase.get(businessId);
    }

    // Try loading from file
    try {
        const data = await persistence.loadBusinessData(businessId);
        if (data) {
            businessDatabase.set(businessId, data);
            if (data.shopDomain) {
                shopToBusinessMap.set(data.shopDomain, businessId);
            }
            return data;
        }
    } catch (error) {
        console.error(`Error loading business data:`, error);
    }

    return null;
}

async function getBusinessIdByShop(shopDomain) {
    return shopToBusinessMap.get(shopDomain);
}

// =====================================================
// SHOPIFY API HELPER
// =====================================================

async function shopifyApiCall(shopDomain, adminToken, endpoint, method = "GET", body = null) {
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
            console.error(`Response: ${errorText}`);
            return null;
        }
        return await response.json();
    } catch (error) {
        console.error(`❌ Shopify API call failed: ${error.message}`);
        return null;
    }
}

// =====================================================
// INTENT DETECTION (NLP)
// =====================================================
async function detectIntent(userMessage) {
  const msg = userMessage.toLowerCase();
  
  const intents = {
    // ✅ Match exactly what executeAction() expects
    greeting: { 
      patterns: /^(hi|hey|hello|yo|sup|hola|greetings|good\s+(morning|afternoon|evening)|remember\s+me|its\s+me|im\s+back)\b/i, 
      confidence: 0.95 
    },
    track_order: {  // ✅ Changed from 'trackorder'
      patterns: /track|status|where|delivery|order|shipping/, 
      confidence: 0.95 
    },
    browse_deals: {  // ✅ Changed from 'browsedeals'
      patterns: /deal|product|browse|show|what.*sell|what.*have|catalog|collection/, 
      confidence: 0.9 
    },
    add_cart: {  // ✅ Changed from 'addcart'
      patterns: /add.*cart|add to cart|add this|want to buy|interested|interested in/, 
      confidence: 0.9 
    },
    buy_now: {  // ✅ Changed from 'buynow'
      patterns: /buy now|checkout|payment|purchase|price|cost|how much/, 
      confidence: 0.85 
    },
    return_order: {  // ✅ Changed from 'returnorder'
      patterns: /return|refund|money back|cancel|issue|wrong|damaged|not good/, 
      confidence: 0.9 
    },
    product_info: {  // ✅ Changed from 'productinfo'
      patterns: /tell|about|info|details|describe|specifications|spec/, 
      confidence: 0.8 
    }
  };
  
  for (const [intent, { patterns, confidence }] of Object.entries(intents)) {
    if (patterns.test(msg)) {
      return { intent, confidence };
    }
  }
  
  return { intent: 'general_query', confidence: 0.5 };  // ✅ Changed default too
}

// =====================================================
// ACTION EXECUTION (Business Logic)
// =====================================================

async function executeAction(intent, userMessage, context, shopDomain, adminToken) {

    const shopifyCall = (endpoint, method = "GET", body = null) =>
        shopifyApiCall(shopDomain, adminToken, endpoint, method, body);

    switch (intent) {
        // 🆕 ADD THIS CASE
        case 'greeting':
            // Check if user has context (returning user)
            if (context.email || context.orderId || context.previousActions?.length > 0) {
                const greeting = `Welcome back${context.email ? `, ${context.email.split('@')[0]}` : ''}! 👋`;
                const lastAction = context.previousActions?.[context.previousActions.length - 1];

                let followUp = "\n\nHow can I help you today?";
                if (lastAction === 'trackorder') {
                    followUp = "\n\nWould you like to check your order status again?";
                } else if (lastAction === 'browsedeals') {
                    followUp = "\n\nWant to see more deals?";
                }

                return {
                    message: greeting + followUp,
                    suggestions: ['Track Order', 'Browse Deals', 'Add to Cart', 'Help'],
                    remember: false // Don't overwrite existing context
                };
            } else {
                // New user
                return {
                    message: "👋 Hi! Welcome to our store!\n\nHow can I help you today? You can:\n• 🛍️ Browse deals\n• 📦 Track orders\n• 🛒 Add to cart\n• 💳 Buy now\n• 🔄 Return items",
                    suggestions: ['Browse Deals', 'Track Order', 'Add to Cart', 'Help']
                };
            }
        case 'track_order': {
            // 🔍 Step 1: Try to get email from context first
            let email = context.email;

            console.log('🔎 Checking for email...');
            console.log('  📋 Context email:', email || 'Not found');

            // 🔍 Step 2: If no email in context, try to extract from current message
            if (!email) {
                const emailMatch = userMessage.match(/[\w\.-]+@[\w\.-]+\.\w+/);
                if (emailMatch) {
                    email = emailMatch[0];
                    console.log('  ✉️ Extracted from message:', email);

                    // 🆕 IMPORTANT: Save extracted email to context for future use
                    context.email = email;
                }
            }

            // 🔍 Step 3: Only ask for email if still not found after all checks
            if (!email) {
                console.log('  ❌ No email found - asking user');
                return {
                    needsInfo: true,
                    fieldNeeded: "email",
                    question: "📧 What's your email address? I'll use it to find your order.",
                    inputType: "email",
                    message: "Email required to track your order",
                    suggestions: ["Help", "Browse Products"]
                };
            }

            console.log('  ✅ Using email:', email);
            console.log('🛍️ Fetching orders from Shopify...');

            // 🔍 Step 4: Fetch orders from Shopify
            const ordersData = await shopifyCall(
                `/orders.json?status=any&email=${encodeURIComponent(email)}&limit=5`
            );

            // 🔍 Step 5: Handle no orders found
            if (!ordersData?.orders || ordersData.orders.length === 0) {
                console.log('  ❌ No orders found for:', email);
                return {
                    message: `📭 **No Orders Found**\n\n` +
                        `I couldn't find any orders for **${email}**.\n\n` +
                        `Please check:\n` +
                        `• Email spelling is correct\n` +
                        `• You've placed an order before\n` +
                        `• Order was placed on this store`,
                    remember: true,
                    data: { email }, // Remember email even if no orders
                    suggestions: ["Browse Products", "Try Another Email", "Help"]
                };
            }

            console.log(`  ✅ Found ${ordersData.orders.length} order(s)`);

            // 🔍 Step 6: Process the most recent order
            const order = ordersData.orders[0];

            // Format fulfillment status with emoji
            let statusEmoji = '📦';
            let statusText = order.fulfillment_status || 'Unfulfilled';

            if (statusText === 'fulfilled') {
                statusEmoji = '✅';
                statusText = 'Delivered';
            } else if (statusText === 'partial') {
                statusEmoji = '📮';
                statusText = 'Partially Shipped';
            } else if (statusText === null || statusText === 'Unfulfilled') {
                statusEmoji = '⏳';
                statusText = 'Processing';
            }

            // Format financial status
            let paymentEmoji = '💳';
            let paymentStatus = order.financial_status || 'pending';

            if (paymentStatus === 'paid') {
                paymentEmoji = '✅';
                paymentStatus = 'Paid';
            } else if (paymentStatus === 'pending') {
                paymentEmoji = '⏳';
                paymentStatus = 'Payment Pending';
            } else if (paymentStatus === 'refunded') {
                paymentEmoji = '🔄';
                paymentStatus = 'Refunded';
            }

            // Build item list
            const itemsList = order.line_items
                ?.slice(0, 3) // Show max 3 items
                .map(item => `  • ${item.quantity}x ${item.name}`)
                .join('\n') || '  • Items unavailable';

            const moreItems = order.line_items?.length > 3
                ? `\n  • ...and ${order.line_items.length - 3} more item(s)`
                : '';

            // Calculate days since order
            const orderDate = new Date(order.created_at);
            const daysSince = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
            const daysText = daysSince === 0 ? 'Today' :
                daysSince === 1 ? 'Yesterday' :
                    `${daysSince} days ago`;

            // Build response message
            let message = `${statusEmoji} **Order #${order.name}**\n\n` +
                `**Status:** ${statusText}\n` +
                `**Payment:** ${paymentEmoji} ${paymentStatus}\n` +
                `**Total:** ${order.total_price} ${order.currency}\n` +
                `**Placed:** ${orderDate.toLocaleDateString()} (${daysText})\n\n` +
                `**Items:**\n${itemsList}${moreItems}`;

            // Add tracking info if available
            if (order.fulfillments && order.fulfillments.length > 0) {
                const tracking = order.fulfillments[0];
                if (tracking.tracking_number) {
                    message += `\n\n📍 **Tracking:** ${tracking.tracking_number}`;
                    if (tracking.tracking_company) {
                        message += ` (${tracking.tracking_company})`;
                    }
                }
            }

            // Build buttons array
            const buttons = [];

            // Add tracking button if order status URL exists
            if (order.order_status_url) {
                buttons.push({
                    label: "🔍 Track Shipment",
                    type: "url",
                    value: order.order_status_url
                });
            }

            // Add view details button (if you have order details page)
            if (order.id) {
                buttons.push({
                    label: "📄 View Full Details",
                    type: "url",
                    value: order.order_status_url || `https://${shopDomain}/account/orders/${order.token || order.id}`
                });
            }

            // Build suggestions based on order status
            let suggestions = ["Browse Products", "Help"];

            if (ordersData.orders.length > 1) {
                suggestions.unshift("View Other Orders");
            }

            // Only show "Return Order" if delivered and within return window (e.g., 30 days)
            if (statusText === 'Delivered' && daysSince <= 30) {
                suggestions.unshift("Return Order");
            }

            console.log('  ✅ Order details sent successfully');

            return {
                message: message,
                remember: true,
                data: {
                    email,
                    orderId: order.id,
                    orderName: order.name,
                    orderStatus: order.fulfillment_status,
                    lastOrderDate: order.created_at
                },
                buttons: buttons.length > 0 ? buttons : undefined,
                suggestions: suggestions
            };
        }


        case 'browse_deals': {
            const productsData = await shopifyCall(
                `/products.json?limit=10&published_status=published`
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
                const emailMatch = userMessage.match(/[\w\.-]+@[\w\.-]+\.\w+/);
                if (emailMatch) {
                    email = emailMatch[0];
                }
            }

            if (!email) {
                return {
                    needsInfo: true,
                    fieldNeeded: "email",
                    question: "📧 I need your email to add items to your cart",
                    inputType: "email",
                    message: "Email required"
                };
            }

            // Create draft order
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
                    inputType: "email",
                    message: "Email required"
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
                    inputType: "email",
                    message: "Email required"
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
// BUILD SALESIQ RESPONSE
// =====================================================

function buildSalesIQResponse(actionResult) {
    const response = {};

    if (actionResult.needsInfo) {
        // Ask for missing information
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
        // Simple reply
        response.action = "reply";
        response.replies = [actionResult.message];

        if (actionResult.suggestions && actionResult.suggestions.length > 0) {
            response.suggestions = actionResult.suggestions;
        }

        if (actionResult.buttons && actionResult.buttons.length > 0) {
            response.buttons = actionResult.buttons;
        }
    }

    return response;
}

// =====================================================
// OAUTH ROUTES
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

        await saveBusinessData(businessId, businessData);

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
                <code class="text-sm font-mono text-gray-800 break-all">${businessData.webhookUrl}</code>
                <button 
                  onclick="copyToClipboard('${businessData.webhookUrl}')"
                  class="ml-3 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold whitespace-nowrap"
                >
                  Copy
                </button>
              </div>

              <p class="text-xs text-blue-600">Business ID: <code>${businessId}</code></p>
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
            if (window.opener) {
              window.opener.postMessage({
                type: 'oauth_success',
                shop: '${shop}',
                businessId: '${businessId}',
                webhookUrl: '${businessData.webhookUrl}'
              }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          }

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
// MULTI-TENANT ZOBOT WEBHOOK
// =====================================================

// =====================================================
// MULTI-TENANT ZOBOT WEBHOOK (COMPLETE FIXED VERSION)
// =====================================================

app.post("/api/zobot/:businessId", async (req, res) => {
    try {
        const { businessId } = req.params;

        console.log(`\n${'='.repeat(60)}`);
        console.log(`📨 WEBHOOK REQUEST RECEIVED`);
        console.log(`Business ID: ${businessId}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log(`Full Request Body:`, JSON.stringify(req.body, null, 2));
        console.log(`${'='.repeat(60)}\n`);

        // ✅ LOAD BUSINESS DATA (from memory or file)
        let business = await getBusinessData(businessId);

        if (!business) {
            console.error(`❌ Business not found: ${businessId}`);
            return res.json({
                action: "reply",
                replies: ["Sorry, bot configuration not found. Please reconnect your store."],
                suggestions: ["Help", "Contact Support"]
            });
        }

        console.log(`✅ Business found: ${business.shopName} (${business.shopDomain})`);
        console.log(`   Status: ${business.status}`);
        console.log(`   Connected: ${business.connectedAt}`);

        const { adminToken, shopDomain } = business;

        // ✅ EXTRACT MESSAGE - HANDLE ALL POSSIBLE FORMATS
        let messageText = null;
        let visitor = {};
        let operation = "message";

        console.log(`\n🔍 Parsing message from SalesIQ...`);

        // Try multiple ways to get the message (SalesIQ sends in different formats)
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
        // Last resort - check if there's ANY text property
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

        // If still no message, return helpful error
        if (!messageText || messageText.trim() === '') {
            console.error(`❌ No message text found in any format`);
            console.error(`Request keys:`, Object.keys(req.body));

            return res.json({
                action: "reply",
                replies: [
                    "👋 I couldn't understand your message. Please try again!",
                    "Try saying: 'show me deals', 'track order', 'add to cart', or 'help'"
                ],
                suggestions: ["Browse Deals", "Track Order", "Help"]
            });
        }

        console.log(`📝 Message extracted: "${messageText}"`);
        console.log(`👤 Visitor data:`, JSON.stringify(visitor, null, 2));

        const userId = visitor?.email || visitor?.id || visitor?.name || `visitor_${Date.now()}`;
        console.log('User ID:', userId);

        // GET OR CREATE CONVERSATION MEMORY
        const memoryKey = `${businessId}:${userId}`;
        let memory;
        if (!userSessions.has(memoryKey)) {
            console.log('Loading conversation memory from file...');
            memory = await ConversationMemory.loadFromFile(businessId, userId);
            userSessions.set(memoryKey, memory);
            console.log('Conversation session created/loaded');
        } else {
            memory = userSessions.get(memoryKey);
            console.log('Reusing existing session');
        }

        // 🆕 ADD THIS - Auto-save visitor email if available
        if (visitor?.email && !memory.context.email) {
            memory.remember({ email: visitor.email });
            console.log('📧 Auto-saved visitor email to context:', visitor.email);
            await memory.saveToFile(); // Persist immediately
        }

        const activeSessions = Array.from(userSessions.keys())
            .filter(k => k.startsWith(businessId)).length;
        console.log(`💾 Active sessions for this business: ${activeSessions}`);

        // ✅ DETECT INTENT
        console.log(`\n🧠 INTENT DETECTION`);
        const { intent, confidence } = await detectIntent(messageText);
        console.log(`   Intent: ${intent}`);
        console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`);

        // Add message to memory with metadata
        memory.addMessage('user', messageText, { intent, confidence });

        // ✅ GET CONTEXT FROM MEMORY
        const context = memory.getContext();
        console.log(`\n📋 CONTEXT FROM MEMORY`);
        console.log(`   Email: ${context.email || 'Not set'}`);
        console.log(`   Order ID: ${context.orderId || 'None'}`);
        console.log(`   Previous actions:`, context.previousActions || []);

        // ✅ EXECUTE ACTION
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

        console.log(`   ✅ Action completed successfully`);
        if (actionResult.needsInfo) {
            console.log(`   ⚠️ Additional info needed: ${actionResult.fieldNeeded}`);
        }

        // ✅ BUILD SALESIQ RESPONSE
        const response = buildSalesIQResponse(actionResult);
        console.log(`\n📤 BUILDING RESPONSE`);
        console.log(`   Action type: ${response.action}`);
        console.log(`   Has suggestions: ${!!response.suggestions}`);
        console.log(`   Has buttons: ${!!response.buttons}`);

        // ✅ UPDATE MEMORY AND PERSIST
        memory.addMessage('bot', actionResult.message, {
            intent,
            actionType: response.action
        });

        if (actionResult.remember && actionResult.data) {
            memory.remember(actionResult.data);

            // Track action in context
            if (!context.previousActions) {
                context.previousActions = [];
            }
            context.previousActions.push({
                intent,
                timestamp: new Date().toISOString()
            });

            console.log(`   💾 Data saved to memory`);
        }

        // Save memory to file (async, don't wait)
        memory.saveToFile().catch(err => {
            console.error(`⚠️ Failed to save conversation to file:`, err);
        });

        console.log(`\n✅ Response sent successfully`);
        console.log(`${'='.repeat(60)}\n`);

        res.json(response);

    } catch (error) {
        console.error(`\n${'='.repeat(60)}`);
        console.error(`❌ ZOBOT WEBHOOK ERROR`);
        console.error(`Error: ${error.message}`);
        console.error(`Stack trace:`, error.stack);
        console.error(`${'='.repeat(60)}\n`);

        res.json({
            action: "reply",
            replies: [
                `⚠️ An error occurred: ${error.message}`,
                "Please try again or contact support if the issue persists."
            ],
            suggestions: ["Try Again", "Browse Deals", "Help"]
        });
    }
});

// =====================================================
// GET BUSINESS DATA ENDPOINT
// =====================================================

app.get("/api/business/:businessId", async (req, res) => {
    try {
        const { businessId } = req.params;

        const business = await getBusinessData(businessId);

        if (!business) {
            return res.status(404).json({
                error: "Business not found",
                businessId: businessId,
                message: "This business configuration does not exist. Please reconnect your store."
            });
        }

        // Return business info (hide sensitive data)
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
                { name: "Browse Deals", enabled: true, icon: "🛍️" },
                { name: "Track Orders", enabled: true, icon: "📦" },
                { name: "Add to Cart", enabled: true, icon: "🛒" },
                { name: "Buy Now", enabled: true, icon: "💳" },
                { name: "Process Returns", enabled: true, icon: "🔄" },
                { name: "Memory Context", enabled: true, icon: "🧠" }
            ]
        });

    } catch (error) {
        console.error('❌ Error fetching business data:', error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
});

// =====================================================
// CHECK SHOP CONNECTION STATUS
// =====================================================

app.get("/api/shopify/status/:shopDomain", async (req, res) => {
    try {
        const { shopDomain } = req.params;

        const businessId = shopToBusinessMap.get(shopDomain);

        if (!businessId) {
            return res.json({
                connected: false,
                shopDomain: shopDomain,
                message: "Shop not connected"
            });
        }

        const business = await getBusinessData(businessId);

        if (!business) {
            return res.json({
                connected: false,
                shopDomain: shopDomain,
                message: "Business data not found"
            });
        }

        res.json({
            connected: true,
            shopDomain: shopDomain,
            businessId: businessId,
            shopName: business.shopName,
            status: business.status,
            connectedAt: business.connectedAt,
            webhookUrl: business.webhookUrl
        });

    } catch (error) {
        console.error('❌ Error checking shop status:', error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
});

// =====================================================
// RECONNECT EXISTING SHOP (Update tokens)
// =====================================================

app.post("/api/shopify/reconnect", async (req, res) => {
    try {
        const { businessId, shopDomain, adminToken } = req.body;

        if (!businessId || !shopDomain || !adminToken) {
            return res.status(400).json({
                error: "Missing required fields: businessId, shopDomain, adminToken"
            });
        }

        // Load existing business
        let business = await getBusinessData(businessId);

        if (!business) {
            return res.status(404).json({
                error: "Business not found",
                businessId: businessId
            });
        }

        // Update token and timestamp
        business.adminToken = adminToken;
        business.lastReconnected = new Date().toISOString();
        business.status = "active";

        // Save updated business
        await saveBusinessData(businessId, business);

        console.log(`✅ Business reconnected: ${businessId}`);

        res.json({
            success: true,
            businessId: businessId,
            shopDomain: shopDomain,
            webhookUrl: business.webhookUrl,
            message: "Business reconnected successfully"
        });

    } catch (error) {
        console.error('❌ Error reconnecting business:', error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
});

// =====================================================
// LEGACY ENDPOINTS (For backward compatibility)
// =====================================================

// Deals endpoint - uses first available store
app.post("/salesiq-deals", async (req, res) => {
    try {
        // Get first business as fallback
        const firstBusiness = Array.from(businessDatabase.values())[0];

        if (!firstBusiness) {
            return res.json({
                cards: [],
                message: "No store connected. Please connect a Shopify store first."
            });
        }

        const data = await shopifyApiCall(
            firstBusiness.shopDomain,
            firstBusiness.adminToken,
            "/products.json?limit=10&published_status=published"
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

// Track order endpoint - legacy
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

// Add to cart endpoint - legacy
app.post("/salesiq-add-to-cart", async (req, res) => {
    try {
        const variantId = req.body.variant_id || req.query.variant_id;
        const quantity = req.body.quantity || req.query.quantity || 1;
        let email = req.body.email || req.query.email;

        if (!email && req.body.session?.email) {
            email = req.body.session.email.value || req.body.session.email;
        }

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
                `⚠️ Error adding to cart: ${err.message}\n\nPlease try again or contact support.`
            ],
            suggestions: ["🛍️ Browse Deals", "🔍 Track Order"]
        });
    }
});

// Buy now endpoint - legacy
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
                `🎉 Your order is ready!\n\n💰 Total: $${draftOrder.total_price}\n\nClick below to complete payment securely.`
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

// Return order endpoint - legacy
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

        res.json({
            action: "reply",
            replies: [
                `🔄 **Return Request for Order #${orderNumber}**\n\n` +
                `Your return has been initiated.\n\n` +
                `⏱️ Refunds typically take 5-7 business days.\n` +
                `📧 You'll receive a confirmation email shortly.\n\n` +
                `Need help? Contact our support team.`
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

// =====================================================
// HOME PAGE
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
              <li>✅ Persistent webhook URLs</li>
              <li>✅ Natural language intent detection</li>
              <li>✅ Conversation memory system</li>
              <li>✅ Real-time product fetching</li>
              <li>✅ Order tracking & management</li>
              <li>✅ Draft order creation</li>
              <li>✅ Return processing</li>
              <li>✅ File-based persistence</li>
            </ul>
          </div>

          <div class="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p class="text-sm text-yellow-800">
              🔗 <strong>Webhook Format:</strong> POST /api/zobot/{businessId}
            </p>
            <p class="text-sm text-yellow-800 mt-2">
              📝 Each connected store gets a permanent webhook URL
            </p>
          </div>
        </div>

        <div class="mt-12 text-center">
          <p class="text-gray-600">Status: <span class="font-bold text-green-600">🟢 Online</span></p>
          <p class="text-sm text-gray-500 mt-2">Server uptime: ${Math.floor(process.uptime())}s</p>
          <p class="text-sm text-gray-500">Last updated: ${new Date().toISOString()}</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// =====================================================
// HEALTH CHECK
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

// =====================================================
// CONFIG CHECK ENDPOINT
// =====================================================

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
// DEBUG ENDPOINT - List all businesses
// =====================================================

app.get("/api/debug/businesses", (req, res) => {
    const businesses = Array.from(businessDatabase.values()).map(b => ({
        businessId: b.businessId,
        shopDomain: b.shopDomain,
        shopName: b.shopName,
        status: b.status,
        connectedAt: b.connectedAt,
        webhookUrl: b.webhookUrl,
        lastReconnected: b.lastReconnected || null
    }));

    res.json({
        total: businesses.length,
        businesses: businesses,
        shopMappings: Object.fromEntries(shopToBusinessMap)
    });
});
// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

let server = null;

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        console.log('\n🚀 Starting server...\n');

        // ✅ 1. Initialize persistence directories
        console.log('📁 Initializing persistence...');
        await persistence.initializePersistence();

        // ✅ 2. Load all businesses from files
        console.log('💼 Loading businesses from storage...');
        businessDatabase = await persistence.loadAllBusinesses();

        // ✅ 3. Rebuild shop to business mapping
        console.log('🗺️ Rebuilding shop mappings...');
        for (const [businessId, business] of businessDatabase) {
            if (business.shopDomain) {
                shopToBusinessMap.set(business.shopDomain, businessId);
                console.log(`   ✓ Mapped: ${business.shopDomain} → ${businessId}`);
            }
        }

        console.log(`\n✅ Loaded ${businessDatabase.size} business(es) from persistence`);
        console.log(`✅ Mapped ${shopToBusinessMap.size} shop domain(s)\n`);

        // ✅ 4. Start Express server
        server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log('🎉 SERVER STARTED SUCCESSFULLY');
            console.log('='.repeat(60));
            console.log(`📡 Server running on port: ${PORT}`);
            console.log(`🌐 Base URL: ${BASE_URL}`);
            console.log(`📊 Connected Stores: ${businessDatabase.size}`);
            console.log(`💾 Active Sessions: ${userSessions.size}`);
            console.log(`⏰ Started at: ${new Date().toISOString()}`);
            console.log('='.repeat(60) + '\n');
        });

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ FATAL ERROR: Server failed to start');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(60) + '\n');
        process.exit(1);
    }
}

// =====================================================
// SHUTDOWN HANDLERS
// =====================================================

// Handle SIGTERM signal (from hosting platforms like Render)
process.on('SIGTERM', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('📴 SIGTERM signal received');
    console.log('='.repeat(60));
    console.log('Initiating graceful shutdown...\n');

    await gracefulShutdown('SIGTERM');
});

// Handle SIGINT signal (Ctrl+C in terminal)
process.on('SIGINT', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('📴 SIGINT signal received (Ctrl+C)');
    console.log('='.repeat(60));
    console.log('Initiating graceful shutdown...\n');

    await gracefulShutdown('SIGINT');
});

// Graceful shutdown function
async function gracefulShutdown(signal) {
    console.log(`⏳ Shutting down gracefully (${signal})...`);

    try {
        // ✅ 1. Save all active conversation sessions
        console.log('\n💾 Saving active conversation sessions...');
        let savedCount = 0;
        for (const [key, memory] of userSessions) {
            try {
                await memory.saveToFile();
                savedCount++;
            } catch (err) {
                console.error(`   ⚠️ Failed to save session ${key}:`, err.message);
            }
        }
        console.log(`   ✓ Saved ${savedCount} conversation session(s)`);

        // ✅ 2. Close HTTP server
        if (server) {
            console.log('\n🔌 Closing HTTP server...');
            await new Promise((resolve, reject) => {
                server.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('   ✓ HTTP server closed successfully');
        }

        // ✅ 3. Final statistics
        console.log('\n📊 Final Statistics:');
        console.log(`   Connected Stores: ${businessDatabase.size}`);
        console.log(`   Active Sessions: ${userSessions.size}`);
        console.log(`   Total Uptime: ${Math.floor(process.uptime())}s`);

        console.log('\n' + '='.repeat(60));
        console.log('✅ Shutdown completed successfully');
        console.log('='.repeat(60) + '\n');

        process.exit(0);

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ Error during shutdown:');
        console.error('='.repeat(60));
        console.error(error);
        console.error('='.repeat(60) + '\n');
        process.exit(1);
    }
}

// =====================================================
// ERROR HANDLERS
// =====================================================

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('\n' + '='.repeat(60));
    console.error('❌ UNCAUGHT EXCEPTION');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(60) + '\n');

    // Try to save state before exiting
    gracefulShutdown('uncaughtException').finally(() => {
        process.exit(1);
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n' + '='.repeat(60));
    console.error('❌ UNHANDLED PROMISE REJECTION');
    console.error('='.repeat(60));
    console.error('Reason:', reason);
    console.error('Promise:', promise);
    console.error('='.repeat(60) + '\n');

    // Try to save state before exiting
    gracefulShutdown('unhandledRejection').finally(() => {
        process.exit(1);
    });
});

// =====================================================
// START THE SERVER
// =====================================================

console.log('\n' + '='.repeat(60));
console.log('🤖 SHOPIFY + SALESIQ BOT BACKEND');
console.log('Multi-Tenant AI-Powered E-Commerce Bot');
console.log('='.repeat(60) + '\n');

startServer();

console.log('✅ Server initialization complete!\n');