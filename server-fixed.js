// server.js - Complete Shopify SalesIQ Integration Backend
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

const app = express();
app.use(express.json());
dotenv.config();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || "fractix.myshopify.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN_KEY;
const API_VERSION = "2024-10";

// =====================================================
// HELPER: SHOPIFY REQUEST FUNCTION (SINGLE DEFINITION)
// =====================================================

async function shopifyRequest(endpoint, method = "GET", body = null) {
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

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Shopify API Error on ${endpoint}:`, error);
    throw error;
  }
}

// =====================================================
// 1. DEALS OF THE DAY - GET TOP 3 PRODUCTS
// =====================================================

app.post("/salesiq-deals", async (req, res) => {
  try {
    const data = await shopifyRequest("/products.json?limit=10&sort=created_at:desc");
    const products = data.products || [];

    if (products.length === 0) {
      return res.json({
        action: "reply",
        replies: ["No deals available right now."]
      });
    }

    // Take top 3 products
    const topProducts = products.slice(0, 3);

    // Build elements array for official SalesIQ format
    const elements = topProducts.map(p => {
      const v = p.variants?.[0];
      const price = v?.price || "N/A";
      const compare = v?.compare_at_price;
      const img = p.images?.[0]?.src || "";
      const productUrl = `https://${SHOPIFY_STORE}/products/${p.handle}`;

      let subtitle = `$${price} USD`;
      if (compare && parseFloat(compare) > parseFloat(price)) {
        const discount = Math.round(((compare - price) / compare) * 100);
        subtitle = `🔥 $${price} USD (Save ${discount}%)`;
      }

      return {
        title: p.title,
        subtitle: subtitle,
        id: p.id.toString(),
        image: img,
        actions: [
          {
            label: "Add to Cart",
            name: "add_to_cart_btn",
            type: "client_action",
            clientaction_name: "addToCart"
          },
          {
            label: "Buy Now",
            name: "buy_now_btn",
            type: "url",
            link: productUrl
          },
          {
            label: "View Details",
            name: "view_details_btn",
            type: "url",
            link: productUrl
          }
        ]
      };
    });

    // Official SalesIQ 2025 format
    return res.json({
      action: "reply",
      replies: [
        {
          type: "multiple-product",
          text: "✨ Here are our top 3 deals!",
          elements: elements
        }
      ]
    });

  } catch (err) {
    console.error("Error in /salesiq-deals:", err);
    return res.json({
      action: "reply",
      replies: ["Error loading deals. Please try again."]
    });
  }
});

// =====================================================
// 2. TRACK ORDER - GET LATEST ORDER STATUS BY EMAIL
// =====================================================

app.post("/salesiq-track-order", async (req, res) => {
  try {
    const email = req.body.email || req.query.email;

    if (!email) {
      return res.json({
        action: "reply",
        replies: ["Please provide your email address to track your order."]
      });
    }

    const data = await shopifyRequest(
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

    const suggestions = [];
    
    if (orderInfo.trackingUrl) {
      suggestions.push("Track Shipment");
    }

    if (latestOrder.fulfillment_status === "fulfilled" && !latestOrder.cancelled_at) {
      suggestions.push("Return Order");
    }

    suggestions.push("🛍️ Browse Deals");

    res.json({
      action: "reply",
      replies: [statusMessage],
      suggestions: suggestions
    });

  } catch (err) {
    console.error("Error in /salesiq-track-order:", err);
    res.json({
      action: "reply",
      replies: ["Error fetching your order details. Please try again."]
    });
  }
});

// =====================================================
// 3. ADD TO CART - CREATE/UPDATE DRAFT ORDERS
// =====================================================

app.post("/salesiq-add-to-cart", async (req, res) => {
  try {
    const variantId = req.body.variant_id || req.query.variant_id;
    const quantity = req.body.quantity || req.query.quantity || 1;
    
    let email = req.body.email || req.query.email;
    if (!email && req.session) {
      email = req.session.email?.value || req.session.email;
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
    
    console.log(`Adding to cart - Variant: ${variantId}, Qty: ${quantity}, Email: ${email}`);
    
    const draftsData = await shopifyRequest(
      `/draft_orders.json?status=open&limit=50`
    );
    
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
      
      const updated = await shopifyRequest(
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
      
      const created = await shopifyRequest(
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
    console.error("Error in /salesiq-add-to-cart:", err);
    
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
// 4. BUY NOW - CREATE ORDER INSTANTLY
// =====================================================

app.post("/salesiq-buy-now", async (req, res) => {
  try {
    const email = req.body.email;
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

    const created = await shopifyRequest(
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
      suggestions: [
        "Complete Payment",
        "🛍️ Browse More"
      ]
    });

  } catch (err) {
    console.error("Error in /salesiq-buy-now:", err);
    res.json({
      action: "reply",
      replies: ["Couldn't process your order. Please try again."]
    });
  }
});

// =====================================================
// 5. RETURN ORDER - INITIATE REFUND PROCESS
// =====================================================

app.post("/salesiq-return-order", async (req, res) => {
  try {
    const orderId = req.body.order_id;
    const orderNumber = req.body.order_number;
    const reason = req.body.reason || "Customer request";

    if (!orderId) {
      return res.json({
        action: "reply",
        replies: ["Order information missing. Please try again."]
      });
    }

    const orderData = await shopifyRequest(`/orders/${orderId}.json`);
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

    const calculated = await shopifyRequest(
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
      suggestions: [
        "Track Return Status",
        "🛍️ Browse Deals"
      ]
    });

  } catch (err) {
    console.error("Error in /salesiq-return-order:", err);
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
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Shopify SalesIQ Backend running on port ${PORT}`);
  console.log(`📍 Store: ${SHOPIFY_STORE}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Routes available:`);
  console.log(`   POST /salesiq-deals`);
  console.log(`   POST /salesiq-track-order`);
  console.log(`   POST /salesiq-add-to-cart`);
  console.log(`   POST /salesiq-buy-now`);
  console.log(`   POST /salesiq-return-order`);
});
