import { TextChannel } from 'discord.js';
import { FileProcessor, FileOperation } from '../../utils/fileProcessor';
import { CacheManager } from '../cache/cacheManager';
import { logger } from '../../utils/logger';
import path from 'path';

// Rate limiter for Discord messages
class MessageRateLimiter {
  private lastMessageTime: number = 0;
  private readonly minInterval: number;

  constructor(minIntervalMs: number) {
    this.minInterval = minIntervalMs;
  }

  async waitForNextMessage(): Promise<void> {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    
    if (timeSinceLastMessage < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastMessage;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastMessageTime = Date.now();
  }
}

export class InventoryManager {
  private readonly messageRateLimiter: MessageRateLimiter;

  constructor(
    private readonly fileProcessor: FileProcessor,
    private readonly cacheManager: CacheManager,
    private readonly inventoryChannel: TextChannel
  ) {
    this.messageRateLimiter = new MessageRateLimiter(15000); // 15 seconds
  }

  /**
   * Process inventory files from cache
   */
  async processInventoryFiles(): Promise<void> {
    try {
      // Get all inventory files from cache
      const cache = this.cacheManager.getCache();
      const operations: FileOperation[] = [];

      for (const [cacheKey, cachedData] of Object.entries(cache.inventoryFiles)) {
        const fileName = cacheKey.replace('inventory_', '');
        const githubPath = `assets/data/${fileName}`;

        // Only add to operations if it's an inventory file
        if (fileName === 'Fggems-Inventory.txt' ||
            fileName === 'Fsbank-Inventory.txt' ||
            fileName === 'Fgspells-Inventory.txt') {
          operations.push({
            path: githubPath,
            content: cachedData.content
          });
        }
      }

      if (operations.length > 0) {
        const results = await this.fileProcessor.processBatch(operations);
        
        // Update cache and send notifications for successful operations
        for (const result of results) {
          if (result.success) {
            const fileName = path.basename(result.path);
            const cacheKey = `inventory_${fileName}`;
            const cachedData = this.cacheManager.getCachedContent(cacheKey);

            // Only send message if this is a new file or has changes
            if (!cachedData) {
              await this.messageRateLimiter.waitForNextMessage();
              await this.inventoryChannel.send({
                content: `New inventory file processed: \`${fileName}\`. The website will update shortly.`
              });
            } else {
              logger.info(`Updated existing file in cache: ${fileName}`);
            }
          } else {
            logger.error(`Failed to process file ${result.path}: ${result.error}`);
          }
        }

        await this.cacheManager.saveCache();
      }
    } catch (error) {
      logger.error(`Error processing inventory files: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Process a new inventory file from Discord
   */
  async processNewFile(fileName: string, content: string): Promise<void> {
    try {
      // Only process expected inventory files
      if (fileName !== 'Fggems-Inventory.txt' &&
          fileName !== 'Fsbank-Inventory.txt' &&
          fileName !== 'Fgspells-Inventory.txt') {
        logger.info(`Skipping non-inventory file: ${fileName}`);
        return;
      }

      const cacheKey = `inventory_${fileName}`;
      const cachedData = this.cacheManager.getCachedContent(cacheKey);

      // If file is in cache and content hasn't changed, just log and return
      if (cachedData && cachedData.content === content) {
        logger.info(`File ${fileName} is already up to date in cache`);
        return;
      }

      // If we get here, either the file is new or has changed
      const githubPath = `assets/data/${fileName}`;
      const result = await this.fileProcessor.processBatch([{
        path: githubPath,
        content: content
      }]);

      if (result[0].success) {
        // Update cache with new content
        this.cacheManager.updateCache(cacheKey, content, Date.now());
        await this.cacheManager.saveCache();
        logger.info(`Successfully processed and cached ${fileName}`);
        
        // Send Discord notification after successful processing
        await this.messageRateLimiter.waitForNextMessage();
        await this.inventoryChannel.send({
          content: `✅ New inventory file processed: \`${fileName}\`. The website will update shortly.`
        });
      } else {
        logger.error(`Failed to process file ${fileName}: ${result[0].error}`);
      }
    } catch (error) {
      logger.error(`Error processing new file ${fileName}: ${error instanceof Error ? error.message : error}`);
    }
  }
} 