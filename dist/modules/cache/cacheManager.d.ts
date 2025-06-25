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
                dates: string[];
            };
        };
        manualEntries: string[];
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
export declare class CacheManager {
    private readonly cacheFilePath;
    private cache;
    constructor(cacheFilePath: string);
    /**
     * Ensures the cache directory exists
     */
    private ensureCacheDirectory;
    /**
     * Loads the cache from disk
     */
    loadCache(): Promise<void>;
    /**
     * Saves the cache to disk
     */
    saveCache(): Promise<void>;
    /**
     * Updates the cache with new content
     */
    updateCache(key: string, content: string, timestamp: number): void;
    /**
     * Updates the raid schedule in cache
     */
    updateRaidSchedule(content: string, timestamp: number): void;
    /**
     * Updates the offnight schedule in cache
     */
    updateOffnightSchedule(content: string, timestamp: number, threadIds: {
        [threadId: string]: {
            lastUpdated: number;
            dates: string[];
        };
    }, manualEntries: string[]): void;
    /**
     * Gets the cached content for a file
     */
    getCachedContent(key: string): {
        content: string;
        timestamp: number;
    } | undefined;
    /**
     * Gets the cached raid schedule
     */
    getRaidSchedule(): {
        content: string;
        timestamp: number;
    } | undefined;
    /**
     * Gets the cached offnight schedule
     */
    getOffnightSchedule(): {
        content: string;
        timestamp: number;
        threadIds: {
            [threadId: string]: {
                lastUpdated: number;
                dates: string[];
            };
        };
        manualEntries: string[];
    } | undefined;
    /**
     * Clears the offnight schedule from the cache
     */
    clearOffnightCache(): void;
    /**
     * Cleans up old cache entries
     */
    cleanupCache(threshold: number): void;
    /**
     * Gets a cached image data URI
     */
    getImageDataURI(key: string): {
        data: string;
        timestamp: number;
    } | undefined;
    /**
     * Sets a cached image data URI
     */
    setImageDataURI(key: string, value: {
        data: string;
        timestamp: number;
        size: number;
        mimeType: string;
    }): void;
    /**
     * Gets the entire cache object
     */
    getCache(): ContentCache;
    /**
     * Checks if a specific part of the cache is missing, implying it's new or was just cleared.
     * @param key The key of the cache section to check ('raid' or 'offnight').
     * @returns True if the cache section is null, false otherwise.
     */
    wasCacheJustCreated(key: 'raid' | 'offnight'): boolean;
}
