"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const logger_1 = require("../../utils/logger");
class CacheManager {
    constructor(cacheFilePath) {
        this.cacheFilePath = cacheFilePath;
        this.cache = {
            raidSchedule: null,
            offnightSchedule: null,
            inventoryFiles: {},
            imageDataURIs: {}
        };
    }
    /**
     * Ensures the cache directory exists
     */
    ensureCacheDirectory() {
        const cacheDir = path_1.default.dirname(this.cacheFilePath);
        if (!(0, fs_1.existsSync)(cacheDir)) {
            try {
                (0, fs_1.mkdirSync)(cacheDir, { recursive: true });
                logger_1.logger.info('Created cache directory');
            }
            catch (error) {
                logger_1.logger.error(`Failed to create cache directory: ${error instanceof Error ? error.message : error}`);
                throw error;
            }
        }
    }
    /**
     * Loads the cache from disk
     */
    async loadCache() {
        this.ensureCacheDirectory();
        try {
            const data = await promises_1.default.readFile(this.cacheFilePath, 'utf-8');
            // If the file is empty, treat it as a new cache
            if (!data) {
                logger_1.logger.info('Cache file is empty, initializing a new cache.');
                this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
                return;
            }
            // Try to parse the file content
            try {
                this.cache = JSON.parse(data);
                logger_1.logger.info('Cache loaded successfully');
            }
            catch (parseError) {
                logger_1.logger.error(`Failed to parse cache file: ${parseError instanceof Error ? parseError.message : parseError}. Initializing a new cache.`);
                this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
            }
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist yet, that's okay
                logger_1.logger.info('No existing cache file found, initializing a new cache.');
                this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
            }
            else {
                logger_1.logger.error(`Error loading cache file: ${error instanceof Error ? error.message : error}. Initializing a new cache.`);
                this.cache = { raidSchedule: null, offnightSchedule: null, inventoryFiles: {}, imageDataURIs: {} };
            }
        }
    }
    /**
     * Saves the cache to disk
     */
    async saveCache() {
        this.ensureCacheDirectory();
        try {
            await promises_1.default.writeFile(this.cacheFilePath, JSON.stringify(this.cache, null, 2), 'utf-8');
            logger_1.logger.info('Cache saved successfully');
        }
        catch (error) {
            logger_1.logger.error(`Error saving cache: ${error instanceof Error ? error.message : error}`);
            throw error;
        }
    }
    /**
     * Updates the cache with new content
     */
    updateCache(key, content, timestamp) {
        this.cache.inventoryFiles[key] = { content, timestamp };
    }
    /**
     * Updates the raid schedule in cache
     */
    updateRaidSchedule(content, timestamp) {
        this.cache.raidSchedule = {
            content,
            timestamp,
            verification: {
                checksum: '', // Will be updated by verification process
                lastVerified: Date.now(),
                status: 'success'
            }
        };
    }
    /**
     * Updates the offnight schedule in cache
     */
    updateOffnightSchedule(content, timestamp, threadIds, manualEntries) {
        this.cache.offnightSchedule = {
            content,
            timestamp,
            threadIds,
            manualEntries,
            verification: {
                checksum: '', // Will be updated by verification process
                lastVerified: Date.now(),
                status: 'success'
            }
        };
    }
    /**
     * Gets the cached content for a file
     */
    getCachedContent(key) {
        return this.cache.inventoryFiles[key];
    }
    /**
     * Gets the cached raid schedule
     */
    getRaidSchedule() {
        return this.cache.raidSchedule || undefined;
    }
    /**
     * Gets the cached offnight schedule
     */
    getOffnightSchedule() {
        return this.cache.offnightSchedule || undefined;
    }
    /**
     * Clears the offnight schedule from the cache
     */
    clearOffnightCache() {
        this.cache.offnightSchedule = null;
        logger_1.logger.info('🗑️ Offnight schedule cache has been cleared.');
    }
    /**
     * Cleans up old cache entries
     */
    cleanupCache(threshold) {
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
            logger_1.logger.info(`Cleaned up ${cleanedCount} old cache entries`);
        }
    }
    /**
     * Gets a cached image data URI
     */
    getImageDataURI(key) {
        return this.cache.imageDataURIs?.[key];
    }
    /**
     * Sets a cached image data URI
     */
    setImageDataURI(key, value) {
        if (!this.cache.imageDataURIs) {
            this.cache.imageDataURIs = {};
        }
        this.cache.imageDataURIs[key] = value;
    }
    /**
     * Gets the entire cache object
     */
    getCache() {
        return this.cache;
    }
    /**
     * Checks if a specific part of the cache is missing, implying it's new or was just cleared.
     * @param key The key of the cache section to check ('raid' or 'offnight').
     * @returns True if the cache section is null, false otherwise.
     */
    wasCacheJustCreated(key) {
        if (key === 'offnight') {
            return this.cache.offnightSchedule === null;
        }
        if (key === 'raid') {
            return this.cache.raidSchedule === null;
        }
        return false;
    }
}
exports.CacheManager = CacheManager;
//# sourceMappingURL=cacheManager.js.map