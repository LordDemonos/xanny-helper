import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../../utils/logger';

export interface ContentCache {
  raidSchedule: {
    content: string;
    timestamp: number;
    verification?: {
      checksum: string;
      lastVerified: number;
      status: 'success' | 'failed';
      error?: string;
    };
  } | null;
  offnightSchedule: {
    content: string;
    timestamp: number;
    threadIds: {
      [threadId: string]: {
        lastUpdated: number;
        dates: string[];  // ISO date strings of generated dates
      };
    };
    manualEntries: string[];  // Array of manual entry lines
    verification?: {
      checksum: string;
      lastVerified: number;
      status: 'success' | 'failed';
      error?: string;
    };
  } | null;
  inventoryFiles: {
    [key: string]: {
      content: string;
      timestamp: number;
      verification?: {
        checksum: string;
        lastVerified: number;
        status: 'success' | 'failed';
        error?: string;
      };
    };
  };
  imageDataURIs?: {
    [key: string]: {
      data: string;
      timestamp: number;
      size: number;
      mimeType: string;
    };
  };
}

export class CacheManager {
  private cache: ContentCache = {
    raidSchedule: null,
    offnightSchedule: null,
    inventoryFiles: {},
    imageDataURIs: {}
  };

  constructor(private readonly cacheFilePath: string) {}

  /**
   * Ensures the cache directory exists
   */
  private ensureCacheDirectory(): void {
    const cacheDir = path.dirname(this.cacheFilePath);
    if (!existsSync(cacheDir)) {
      try {
        mkdirSync(cacheDir, { recursive: true });
        logger.info('Created cache directory');
      } catch (error) {
        logger.error(`Failed to create cache directory: ${error instanceof Error ? error.message : error}`);
        throw error;
      }
    }
  }

  /**
   * Loads the cache from disk
   */
  async loadCache(): Promise<void> {
    this.ensureCacheDirectory();
    
    try {
      const data = await fs.readFile(this.cacheFilePath, 'utf-8');

      // If the file is empty, treat it as a new cache
      if (!data) {
        logger.info('Cache file is empty, initializing a new cache.');
        this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
        return;
      }

      // Try to parse the file content
      try {
      this.cache = JSON.parse(data);
      logger.info('Cache loaded successfully');
      } catch (parseError) {
        logger.error(`Failed to parse cache file: ${parseError instanceof Error ? parseError.message : parseError}. Initializing a new cache.`);
        this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, that's okay
        logger.info('No existing cache file found, initializing a new cache.');
        this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
      } else {
        logger.error(`Error loading cache file: ${error instanceof Error ? error.message : error}. Initializing a new cache.`);
        this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
      }
    }
  }

  /**
   * Saves the cache to disk
   */
  async saveCache(): Promise<void> {
    this.ensureCacheDirectory();
    
    try {
      await fs.writeFile(
        this.cacheFilePath,
        JSON.stringify(this.cache, null, 2),
        'utf-8'
      );
      logger.info('Cache saved successfully');
    } catch (error) {
      logger.error(`Error saving cache: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Updates the cache with new content
   */
  updateCache(key: string, content: string, timestamp: number): void {
    this.cache.inventoryFiles[key] = { content, timestamp };
  }

  /**
   * Updates the raid schedule in cache
   */
  updateRaidSchedule(content: string, timestamp: number): void {
    this.cache.raidSchedule = { 
      content, 
      timestamp,
      verification: {
        checksum: '',  // Will be updated by verification process
        lastVerified: Date.now(),
        status: 'success'
      }
    };
  }

  /**
   * Updates the offnight schedule in cache
   */
  updateOffnightSchedule(content: string, timestamp: number, threadIds: { [threadId: string]: { lastUpdated: number; dates: string[] } }, manualEntries: string[]): void {
    this.cache.offnightSchedule = { 
      content, 
      timestamp,
      threadIds,
      manualEntries,
      verification: {
        checksum: '',  // Will be updated by verification process
        lastVerified: Date.now(),
        status: 'success'
      }
    };
  }

  /**
   * Gets the cached content for a file
   */
  getCachedContent(key: string): { content: string; timestamp: number } | undefined {
    return this.cache.inventoryFiles[key];
  }

  /**
   * Gets the cached raid schedule
   */
  getRaidSchedule(): { content: string; timestamp: number } | undefined {
    return this.cache.raidSchedule || undefined;
  }

  /**
   * Gets the cached offnight schedule
   */
  getOffnightSchedule(): { content: string; timestamp: number; threadIds: { [threadId: string]: { lastUpdated: number; dates: string[] } }, manualEntries: string[] } | undefined {
    return this.cache.offnightSchedule || undefined;
  }

  /**
   * Clears the offnight schedule from the cache
   */
  clearOffnightCache(): void {
    this.cache.offnightSchedule = null;
    logger.info('🗑️ Offnight schedule cache has been cleared.');
  }

  /**
   * Cleans up old cache entries
   */
  cleanupCache(threshold: number): void {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean up inventory files
    Object.keys(this.cache.inventoryFiles).forEach(key => {
      // Remove non-inventory files
      if (!key.includes('Fggems-Inventory.txt') && 
          !key.includes('Fsbank-Inventory.txt') && 
          !key.includes('Fgspells-Inventory.txt')) {
        delete this.cache.inventoryFiles[key];
        cleanedCount++;
        return;
      }

      // Remove old files
      if (now - this.cache.inventoryFiles[key].timestamp > threshold) {
        delete this.cache.inventoryFiles[key];
        cleanedCount++;
      }
    });

    // Clean up raid schedule if it exists and is old
    if (this.cache.raidSchedule && now - this.cache.raidSchedule.timestamp > threshold) {
      this.cache.raidSchedule = null;
      cleanedCount++;
    }

    // Clean up offnight schedule if it exists and is old
    if (this.cache.offnightSchedule && now - this.cache.offnightSchedule.timestamp > threshold) {
      this.cache.offnightSchedule = null;
      cleanedCount++;
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old cache entries`);
    }
  }

  /**
   * Gets a cached image data URI
   */
  getImageDataURI(key: string): { data: string; timestamp: number } | undefined {
    return this.cache.imageDataURIs?.[key];
  }

  /**
   * Sets a cached image data URI
   */
  setImageDataURI(key: string, value: { data: string; timestamp: number; size: number; mimeType: string }): void {
    if (!this.cache.imageDataURIs) {
      this.cache.imageDataURIs = {};
    }
    this.cache.imageDataURIs[key] = value;
  }

  /**
   * Gets the entire cache object
   */
  getCache(): ContentCache {
    return this.cache;
  }

  /**
   * Checks if a specific part of the cache is missing, implying it's new or was just cleared.
   * @param key The key of the cache section to check ('raid' or 'offnight').
   * @returns True if the cache section is null, false otherwise.
   */
  wasCacheJustCreated(key: 'raid' | 'offnight'): boolean {
    if (key === 'offnight') {
      return this.cache.offnightSchedule === null;
    }
    if (key === 'raid') {
      return this.cache.raidSchedule === null;
    }
    return false;
  }
} 