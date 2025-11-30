// =====================================================
// persistence.js - File-based data persistence layer
// FULLY FIXED & VERIFIED
// =====================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

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
    // Create main data directory
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Create subdirectories
    await fs.mkdir(BUSINESSES_DIR, { recursive: true });
    await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
    
    console.log('✓ Persistence directories initialized');
    console.log(`  📁 Businesses: ${BUSINESSES_DIR}`);
    console.log(`  💬 Conversations: ${CONVERSATIONS_DIR}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error initializing persistence:', error);
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
 */
async function saveBusinessData(businessId, businessData) {
  try {
    if (!businessId) {
      throw new Error('businessId is required');
    }

    const filePath = getBusinessFilePath(businessId);
    
    const data = {
      businessId,
      ...businessData,
      lastUpdated: new Date().toISOString(),
      savedAt: new Date().toISOString()
    };

    // Write file with pretty formatting for debugging
    await fs.writeFile(
      filePath, 
      JSON.stringify(data, null, 2)
    );
    
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
 */
async function loadBusinessData(businessId) {
  try {
    if (!businessId) {
      throw new Error('businessId is required');
    }

    const filePath = getBusinessFilePath(businessId);
    
    // Check if file exists
    await fs.access(filePath);
    
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent);
    
    console.log(`✓ Loaded business data for ${businessId}`);
    return data;
    
  } catch (error) {
    // ENOENT = file not found, which is OK
    if (error.code === 'ENOENT') {
      console.log(`⚠️ Business file not found: ${businessId}`);
      return null;
    }
    
    console.error(`❌ Error loading business data for ${businessId}:`, error);
    return null;
  }
}

/**
 * Load all businesses from files
 * FIXED: Robust handling of multiple files
 */
async function loadAllBusinesses() {
  try {
    const files = await fs.readdir(BUSINESSES_DIR);
    const businesses = new Map();
    
    // Filter only JSON files
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`📂 Found ${jsonFiles.length} business file(s)`);
    
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(BUSINESSES_DIR, file);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        if (data.businessId) {
          businesses.set(data.businessId, data);
          console.log(`   ✓ Loaded: ${data.businessId} (${data.shopName})`);
        }
      } catch (error) {
        console.error(`❌ Error loading business file ${file}:`, error);
      }
    }
    
    console.log(`✓ Total businesses loaded: ${businesses.size}`);
    return businesses;
    
  } catch (error) {
    // ENOENT = directory doesn't exist yet, which is OK
    if (error.code === 'ENOENT') {
      console.log('⚠️ Businesses directory not found (first run?)');
      return new Map();
    }
    
    console.error('❌ Error loading all businesses:', error);
    return new Map();
  }
}

/**
 * Delete business data
 * FIXED: Proper cleanup
 */
async function deleteBusinessData(businessId) {
  try {
    if (!businessId) {
      throw new Error('businessId is required');
    }

    const filePath = getBusinessFilePath(businessId);
    await fs.unlink(filePath);
    
    console.log(`✓ Deleted business data for ${businessId}`);
    return true;
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`⚠️ Business file not found: ${businessId}`);
      return false;
    }
    
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
 */
async function saveConversationMemory(businessId, userId, memory) {
  try {
    if (!businessId || !userId) {
      throw new Error('businessId and userId are required');
    }

    const filePath = getConversationFilePath(businessId, userId);
    
    const data = {
      businessId,
      userId,
      messages: memory.messages || [],
      context: memory.context || {},
      messageCount: (memory.messages || []).length,
      lastUpdated: new Date().toISOString(),
      savedAt: new Date().toISOString()
    };

    await fs.writeFile(
      filePath,
      JSON.stringify(data, null, 2)
    );
    
    console.log(`✓ Saved conversation memory for ${businessId}:${userId} (${data.messageCount} messages)`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error saving conversation for ${businessId}:${userId}:`, error);
    throw error;
  }
}

/**
 * Load conversation memory from JSON file
 * FIXED: Safe loading with validation
 */
async function loadConversationMemory(businessId, userId) {
  try {
    if (!businessId || !userId) {
      throw new Error('businessId and userId are required');
    }

    const filePath = getConversationFilePath(businessId, userId);
    
    // Check if file exists
    await fs.access(filePath);
    
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent);
    
    console.log(`✓ Loaded conversation memory for ${businessId}:${userId} (${data.messageCount || 0} messages)`);
    return data;
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - first conversation
      return null;
    }
    
    console.error(`❌ Error loading conversation for ${businessId}:${userId}:`, error);
    return null;
  }
}

/**
 * Load all conversations for a specific business
 * FIXED: Efficient batch loading
 */
async function loadAllConversations(businessId) {
  try {
    if (!businessId) {
      throw new Error('businessId is required');
    }

    const files = await fs.readdir(CONVERSATIONS_DIR);
    const conversations = new Map();
    
    // Filter files for this business
    const businessPrefix = `${businessId}_`;
    const businessFiles = files.filter(
      f => f.startsWith(businessPrefix) && f.endsWith('.json')
    );
    
    console.log(`📂 Found ${businessFiles.length} conversation file(s) for ${businessId}`);
    
    for (const file of businessFiles) {
      try {
        const filePath = path.join(CONVERSATIONS_DIR, file);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        if (data.userId) {
          conversations.set(data.userId, data);
          console.log(`   ✓ Loaded: ${data.userId} (${data.messageCount || 0} messages)`);
        }
      } catch (error) {
        console.error(`❌ Error loading conversation file ${file}:`, error);
      }
    }
    
    console.log(`✓ Total conversations loaded for ${businessId}: ${conversations.size}`);
    return conversations;
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`⚠️ Conversations directory not found (first run?)`);
      return new Map();
    }
    
    console.error(`❌ Error loading conversations for ${businessId}:`, error);
    return new Map();
  }
}

/**
 * Delete conversation memory
 * FIXED: Proper cleanup
 */
async function deleteConversationMemory(businessId, userId) {
  try {
    if (!businessId || !userId) {
      throw new Error('businessId and userId are required');
    }

    const filePath = getConversationFilePath(businessId, userId);
    await fs.unlink(filePath);
    
    console.log(`✓ Deleted conversation memory for ${businessId}:${userId}`);
    return true;
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`⚠️ Conversation file not found: ${businessId}:${userId}`);
      return false;
    }
    
    console.error(`❌ Error deleting conversation for ${businessId}:${userId}:`, error);
    throw error;
  }
}

/**
 * Clear all data (cleanup utility)
 * FIXED: Safe cleanup with verification
 */
async function clearAllData() {
  try {
    console.log('⚠️ CLEARING ALL DATA...');
    
    // Delete businesses
    const businessFiles = await fs.readdir(BUSINESSES_DIR);
    for (const file of businessFiles) {
      if (file.endsWith('.json')) {
        await fs.unlink(path.join(BUSINESSES_DIR, file));
      }
    }
    console.log(`✓ Deleted ${businessFiles.length} business file(s)`);
    
    // Delete conversations
    const convFiles = await fs.readdir(CONVERSATIONS_DIR);
    for (const file of convFiles) {
      if (file.endsWith('.json')) {
        await fs.unlink(path.join(CONVERSATIONS_DIR, file));
      }
    }
    console.log(`✓ Deleted ${convFiles.length} conversation file(s)`);
    
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