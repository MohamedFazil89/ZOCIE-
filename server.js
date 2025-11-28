// server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

const app = express();
app.use(express.json());
dotenv.config(); // load .env into process.env

const SHOPIFY_STORE = "fractix.myshopify.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN_KEY; // read from .env

app.post("/salesiq-shopify", async (req, res) => {
  try {
    // 1) Get customer email from request body
    const customerEmail = (req.body && req.body.email) || "";
    if (!customerEmail) {
      return res.json({
        action: "reply",
        replies: ["No email provided. Cannot find your orders."]
      });
    }

    // 2) Call Shopify Orders API filtered by that email
    // status=any so cancelled/closed etc. also show
    const apiUrl =
      `https://${SHOPIFY_STORE}/admin/api/2024-10/orders.json` +
      `?status=any&email=${encodeURIComponent(customerEmail)}`;

    const shopifyRes = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": ADMIN_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const data = await shopifyRes.json();

    const orders = (data.orders || []).map(o => {
      return `#${o.name} - ${o.total_price} ${o.currency}`;
    });

    const orders_status = (data.orders || []).map(o => {
      return `#${o.name} - ${o.financial_status}`;
    });

    const replyText = orders.length
      ? `Orders for ${customerEmail}:\n` + orders.join("\n")
      : `No orders found for ${customerEmail}.`;

    // Response for SalesIQ
    res.json({
      action: "reply",
      replies: [replyText],
      // status: orders_status
    });
  } catch (e) {
    console.error(e);
    res.json({
      action: "reply",
      replies: ["Error fetching your orders from the store."]
    });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
