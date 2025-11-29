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

// Helper function to make Shopify API calls
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

  const response = await fetch(url, options);
  return await response.json();
}

app.post("/salesiq-deals", async (req, res) => {
  try {
    const data = await shopifyRequest("/products.json?limit=10&sort=created_at:desc");
    const products = data.products || [];

    if (products.length === 0) {
      return res.json({
        platform: "ZOHOSALESIQ",
        action: "reply",
        replies: [
          { text: "No deals available right now!" }
        ]
      });
    }

    const elements = products.slice(0, 10).map(p => {
      const v = p.variants?.[0];
      const price = v?.price || "N/A";
      const compare = v?.compare_at_price;
      const img = p.images?.[0]?.src || "";
      const url = `https://${SHOPIFY_STORE}/products/${p.handle}`;

      let subtitle = `$${price} USD`;
      if (compare && parseFloat(compare) > parseFloat(price)) {
        const discount = Math.round(((compare - price) / compare) * 100);
        subtitle = `🔥 $${price} (Save ${discount}%)`;
      }

      return {
        id: p.id.toString(),
        title: p.title,
        subtitle: subtitle,
        image: img,
        actions: [
          {
            label: "View More",
            name: "view_" + p.id,
            type: "url",
            link: url
          }
        ]
      };
    });

    return res.json({
      platform: "ZOHOSALESIQ",
      action: "reply",
      replies: [
        {
          type: "carousel",
          text: "Here are today's deals",
          elements: elements
        }
      ]
    });

  } catch (err) {
    console.error("Error:", err);
    return res.json({
      platform: "ZOHOSALESIQ",
      action: "reply",
      replies: [{ text: "Failed to load deals. Try later." }]
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
    const data = await shopifyRequest(
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
// 3. ADD TO CART - Create/Update Draft Order
// =====================================================
app.post("/salesiq-add-to-cart", async (req, res) => {
  try {
    const payload = req.body;
    const email = payload.session?.email?.value || payload.email;
    const variantId = payload.variant_id;
    const quantity = payload.quantity || 1;

    if (!email) {
      return res.json({
        action: "reply",
        replies: ["Please provide your email to add items to cart."]
      });
    }

    if (!variantId) {
      return res.json({
        action: "reply",
        replies: ["Product information missing. Please try again."]
      });
    }

    // Check if customer has existing draft order (cart)
    const draftsData = await shopifyRequest(
      `/draft_orders.json?status=open&limit=1`
    );

    let draftOrder;
    
    if (draftsData.draft_orders && draftsData.draft_orders.length > 0) {
      // Update existing draft order
      const existingDraft = draftsData.draft_orders[0];
      
      const updateBody = {
        draft_order: {
          line_items: [
            ...existingDraft.line_items,
            {
              variant_id: variantId,
              quantity: quantity
            }
          ]
        }
      };

      const updated = await shopifyRequest(
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
              variant_id: variantId,
              quantity: quantity
            }
          ],
          note: "Created via SalesIQ Bot"
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
    const totalPrice = draftOrder.total_price;

    res.json({
      action: "reply",
      replies: [
        `✅ Added to cart!\n\n🛒 Cart: ${itemCount} item(s)\n💰 Total: $${totalPrice} USD`
      ],
      buttons: [
        {
          label: "View Cart",
          type: "url",
          value: draftOrder.invoice_url
        },
        {
          label: "Checkout",
          type: "invoke.function",
          value: {
            function_name: "checkout",
            draft_order_id: draftOrder.id
          }
        }
      ]
    });

  } catch (err) {
    console.error("Error adding to cart:", err);
    res.json({
      action: "reply",
      replies: ["Couldn't add item to cart. Please try again."]
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

    const created = await shopifyRequest(
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
    const orderData = await shopifyRequest(`/orders/${orderId}.json`);
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

    const calculated = await shopifyRequest(
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

    await shopifyRequest(
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



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Shopify SalesIQ Backend running on port ${PORT}`);
  console.log(`📍 Store: ${SHOPIFY_STORE}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});