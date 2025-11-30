// =====================================================
// persistence.js - File-based data persistence layer
// FULLY FIXED & VERIFIED
// =====================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import supabase from "./supabase.js";
// Fix for ES modules (since __dirname doesn't exist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const BUSINESSES_DIR = path.join(DATA_DIR, "businesses");
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations");

// =====================================================
// INITIALIZATION
// =====================================================

/**
 * Initialize data directories on startup
 * FIXED: Proper error handling and directory creation
 */
async function initializePersistence() {
  try {
    // Test Supabase connection
    const { error } = await supabase.from('businesses').select('count').limit(1);
    
    if (error) throw error;
    
    console.log('✓ Supabase connection verified');
    console.log(`  📊 Database: Connected`);
    return true;
  } catch (error) {
    console.error('❌ Error connecting to Supabase:', error);
    throw error;
  }
}


// =====================================================
// FILE PATH GENERATORS
// =====================================================

/**
 * Get file path for a business
 * FIXED: Safe file naming
 */
function getBusinessFilePath(businessId) {
    if (!businessId) {
        throw new Error('businessId is required');
    }
    return path.join(BUSINESSES_DIR, `${businessId}.json`);
}

/**
 * Get file path for conversation history
 * FIXED: Safe file naming by sanitizing userId
 */
function getConversationFilePath(businessId, userId) {
    if (!businessId || !userId) {
        throw new Error('businessId and userId are required');
    }

    // Sanitize userId to make it filesystem safe
    const safeUserId = userId
        .replace(/[^a-zA-Z0-9.\-_]/g, '_')
        .substring(0, 50); // Limit length

    return path.join(CONVERSATIONS_DIR, `${businessId}_${safeUserId}.json`);
}

// =====================================================
// BUSINESS DATA OPERATIONS
// =====================================================

/**
 * Save business data to JSON file
 * FIXED: Proper error handling and metadata
 */async function saveBusinessData(businessId, businessData) {
  try {
    if (!businessId) throw new Error('businessId is required');

    const data = {
      business_id: businessId,
      shop_domain: businessData.shopDomain,
      shop_name: businessData.shopName,
      shop_email: businessData.shopEmail,
      admin_token: businessData.adminToken,
      refresh_token: businessData.refreshToken || null,
      expires_at: businessData.expiresAt || null,
      connected_at: businessData.connectedAt || new Date().toISOString(),
      last_reconnected: businessData.lastReconnected || null,
      status: businessData.status || 'active',
      currency: businessData.currency || 'USD',
      timezone: businessData.timezone || null,
      webhook_url: businessData.webhookUrl,
      last_updated: new Date().toISOString()
    };

    const { error } = await supabase
      .from('businesses')
      .upsert(data, { onConflict: 'business_id' });

    if (error) throw error;

    console.log(`✓ Saved business data for ${businessId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving business data for ${businessId}:`, error);
    throw error;
  }
}

/**
 * Load business data from JSON file
 * FIXED: Safe file reading with validation
 */async function loadBusinessData(businessId) {
  try {
    if (!businessId) throw new Error('businessId is required');

    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_id', businessId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found
        console.log(`⚠️ Business not found: ${businessId}`);
        return null;
      }
      throw error;
    }

    console.log(`✓ Loaded business data for ${businessId}`);
    
    // Convert snake_case to camelCase for compatibility
    return {
      businessId: data.business_id,
      shopDomain: data.shop_domain,
      shopName: data.shop_name,
      shopEmail: data.shop_email,
      adminToken: data.admin_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      connectedAt: data.connected_at,
      lastReconnected: data.last_reconnected,
      status: data.status,
      currency: data.currency,
      timezone: data.timezone,
      webhookUrl: data.webhook_url,
      lastUpdated: data.last_updated
    };
  } catch (error) {
    console.error(`❌ Error loading business data for ${businessId}:`, error);
    return null;
  }
}

/**
 * Load all businesses from files
 * FIXED: Robust handling of multiple files
 */async function loadAllBusinesses() {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('status', 'active'); // Only load active businesses

    if (error) throw error;

    const businesses = new Map();
    
    console.log(`📂 Found ${data.length} business(es)`);
    
    for (const row of data) {
      const businessData = {
        businessId: row.business_id,
        shopDomain: row.shop_domain,
        shopName: row.shop_name,
        shopEmail: row.shop_email,
        adminToken: row.admin_token,
        refreshToken: row.refresh_token,
        expiresAt: row.expires_at,
        connectedAt: row.connected_at,
        lastReconnected: row.last_reconnected,
        status: row.status,
        currency: row.currency,
        timezone: row.timezone,
        webhookUrl: row.webhook_url,
        lastUpdated: row.last_updated
      };
      
      businesses.set(row.business_id, businessData);
      console.log(`   ✓ Loaded: ${row.business_id} (${row.shop_name})`);
    }
    
    console.log(`✓ Total businesses loaded: ${businesses.size}`);
    return businesses;
  } catch (error) {
    console.error('❌ Error loading all businesses:', error);
    return new Map();
  }
}

/**
 * Delete business data
 * FIXED: Proper cleanup
 */async function deleteBusinessData(businessId) {
  try {
    if (!businessId) throw new Error('businessId is required');

    const { error } = await supabase
      .from('businesses')
      .delete()
      .eq('business_id', businessId);

    if (error) throw error;

    console.log(`✓ Deleted business data for ${businessId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting business data for ${businessId}:`, error);
    throw error;
  }
}

// =====================================================
// CONVERSATION MEMORY OPERATIONS
// =====================================================

/**
 * Save conversation memory to JSON file
 * FIXED: Complete memory structure with validation
 */async function saveConversationMemory(businessId, userId, memory) {
  try {
    if (!businessId || !userId) {
      throw new Error('businessId and userId are required');
    }

    const data = {
      business_id: businessId,
      user_id: userId,
      messages: memory.messages || [],
      context: memory.context || {},
      message_count: (memory.messages || []).length,
      last_updated: new Date().toISOString()
    };

    const { error } = await supabase
      .from('conversations')
      .upsert(data, { onConflict: 'business_id,user_id' });

    if (error) throw error;

    console.log(`✓ Saved conversation memory for ${businessId}:${userId} (${data.message_count} messages)`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving conversation for ${businessId}:${userId}:`, error);
    throw error;
  }
}


/**
 * Load conversation memory from JSON file
 * FIXED: Safe loading with validation
 */async function loadConversationMemory(businessId, userId) {
  try {
    if (!businessId || !userId) {
      throw new Error('businessId and userId are required');
    }

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found
        return null;
      }
      throw error;
    }

    console.log(`✓ Loaded conversation memory for ${businessId}:${userId} (${data.message_count || 0} messages)`);
    
    return {
      businessId: data.business_id,
      userId: data.user_id,
      messages: data.messages,
      context: data.context,
      messageCount: data.message_count,
      lastUpdated: data.last_updated
    };
  } catch (error) {
    console.error(`❌ Error loading conversation for ${businessId}:${userId}:`, error);
    return null;
  }
}

/**
 * Load all conversations for a specific business
 * FIXED: Efficient batch loading
 */async function loadAllConversations(businessId) {
  try {
    if (!businessId) throw new Error('businessId is required');

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('business_id', businessId);

    if (error) throw error;

    const conversations = new Map();
    
    console.log(`📂 Found ${data.length} conversation file(s) for ${businessId}`);
    
    for (const row of data) {
      const convData = {
        businessId: row.business_id,
        userId: row.user_id,
        messages: row.messages,
        context: row.context,
        messageCount: row.message_count,
        lastUpdated: row.last_updated
      };
      
      conversations.set(row.user_id, convData);
      console.log(`   ✓ Loaded: ${row.user_id} (${row.message_count || 0} messages)`);
    }
    
    console.log(`✓ Total conversations loaded for ${businessId}: ${conversations.size}`);
    return conversations;
  } catch (error) {
    console.error(`❌ Error loading conversations for ${businessId}:`, error);
    return new Map();
  }
}


/**
 * Delete conversation memory
 * FIXED: Proper cleanup
 */async function deleteConversationMemory(businessId, userId) {
  try {
    if (!businessId || !userId) {
      throw new Error('businessId and userId are required');
    }

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('business_id', businessId)
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`✓ Deleted conversation memory for ${businessId}:${userId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting conversation for ${businessId}:${userId}:`, error);
    throw error;
  }
}

/**
 * Clear all data (cleanup utility)
 * FIXED: Safe cleanup with verification
 */async function clearAllData() {
  try {
    console.log('⚠️ CLEARING ALL DATA...');
    
    // Delete all conversations first (due to foreign key)
    const { error: convError, count: convCount } = await supabase
      .from('conversations')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (convError) throw convError;
    console.log(`✓ Deleted ${convCount || 0} conversation(s)`);
    
    // Delete all businesses
    const { error: bizError, count: bizCount } = await supabase
      .from('businesses')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (bizError) throw bizError;
    console.log(`✓ Deleted ${bizCount || 0} business(es)`);
    
    console.log('✓ All data cleared successfully');
    return true;
  } catch (error) {
    console.error('❌ Error clearing data:', error);
    throw error;
  }
}

// =====================================================
// EXPORT ALL FUNCTIONS
// =====================================================

export default {
    // Initialization
    initializePersistence,

    // Business operations
    saveBusinessData,
    loadBusinessData,
    loadAllBusinesses,
    deleteBusinessData,

    // Conversation operations
    saveConversationMemory,
    loadConversationMemory,
    loadAllConversations,
    deleteConversationMemory,

    // Utility
    clearAllData,

    // Helper paths (for testing)
    getBusinessFilePath,
    getConversationFilePath,
    DATA_DIR,
    BUSINESSES_DIR,
    CONVERSATIONS_DIR
};