// Cache Helper Utility
// Provides fallback data if Notion API fails during build

import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'notion-data.json');

/**
 * Read cached data
 */
export function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return null;
    }
    
    const data = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    
    return {
      timestamp: parsed.timestamp,
      data: parsed.data || [],
      age: Date.now() - new Date(parsed.timestamp).getTime()
    };
  } catch (error) {
    console.error('Error reading cache:', error.message);
    return null;
  }
}

/**
 * Write cache data
 */
export function writeCache(data, metadata = {}) {
  try {
    // Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    
    const cacheData = {
      timestamp: new Date().toISOString(),
      data: data,
      metadata: metadata
    };
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing cache:', error.message);
    return false;
  }
}

/**
 * Check if cache is fresh (less than 24 hours old)
 */
export function isCacheFresh() {
  const cache = readCache();
  if (!cache) return false;
  
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  return cache.age < maxAge;
}

/**
 * Clear cache
 */
export function clearCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
    return true;
  } catch (error) {
    console.error('Error clearing cache:', error.message);
    return false;
  }
}

/**
 * Get cache info for debugging
 */
export function getCacheInfo() {
  const cache = readCache();
  if (!cache) {
    return {
      exists: false,
      message: 'No cache file found'
    };
  }
  
  const ageHours = Math.floor(cache.age / (1000 * 60 * 60));
  const ageMinutes = Math.floor((cache.age % (1000 * 60 * 60)) / (1000 * 60));
  
  return {
    exists: true,
    timestamp: cache.timestamp,
    itemCount: cache.data?.length || 0,
    age: `${ageHours}h ${ageMinutes}m`,
    fresh: isCacheFresh()
  };
}

export default {
  readCache,
  writeCache,
  isCacheFresh,
  clearCache,
  getCacheInfo
};
