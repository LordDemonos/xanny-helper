import { TextChannel } from 'discord.js';
import { FileProcessor } from '../../utils/fileProcessor';
import { CacheManager } from '../cache/cacheManager';
export declare class InventoryManager {
    private readonly fileProcessor;
    private readonly cacheManager;
    private readonly inventoryChannel;
    private readonly messageRateLimiter;
    constructor(fileProcessor: FileProcessor, cacheManager: CacheManager, inventoryChannel: TextChannel);
    /**
     * Process inventory files from cache
     */
    processInventoryFiles(): Promise<void>;
    /**
     * Process a new inventory file from Discord
     */
    processNewFile(fileName: string, content: string): Promise<void>;
}
