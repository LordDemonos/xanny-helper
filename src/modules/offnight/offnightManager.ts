import { TextChannel } from 'discord.js';
import { logger } from '../../utils/logger';
import { parseOffnightTitle, ParsedOffnightEvent } from './offnightPatternMatcher';
import { OffnightFileManager } from './offnightFileManager';
import { CacheManager } from '../cache/cacheManager';
import { updateOffnightCalendar } from './offnightCalendar';

export class OffnightManager {
  private fileManager: OffnightFileManager;

  constructor(
    private readonly offnightChannelId: string,
    offnightFilePath: string,
    cacheManager: CacheManager,
    private readonly googleCalendarId?: string
  ) {
    this.fileManager = new OffnightFileManager(offnightFilePath, cacheManager);
  }

  /**
   * Finds and processes the latest offnight threads
   */
  async findLatestOffnightThreads(channel: TextChannel): Promise<void> {
    try {
      const wasCacheCleared = this.fileManager.getCacheManager().wasCacheJustCreated('offnight');
      if (wasCacheCleared) {
        logger.info('Offnight cache was cleared. Will preserve existing manual entries.');
      }

      logger.info('🔍 Searching for offnight threads...');

      // Fetch all threads from the offnight channel
      const allThreads = await channel.threads.fetchActive();
      const archivedThreads = await channel.threads.fetchArchived();
      
      // Only process active threads (skip archived/inactive ones)
      const threads = [...allThreads.threads.values()];
      
      logger.info(`📋 Found ${threads.length} active threads in offnight channel (${archivedThreads.threads.size} archived threads ignored)`);

      // Convert to format with creation dates and owner info for processing
      const threadData = [];
      let skippedDeletedCount = 0;
      for (const thread of threads) {
        if (thread.createdAt !== null) {
          // Check for deleted starter message before processing
          try {
            await thread.fetchStarterMessage();
          } catch (error: any) {
            // DiscordAPIError code 10008 is "Unknown Message"
            if (error.code === 10008) {
              skippedDeletedCount++;
              continue; // Skip this thread entirely
            }
            // Log other errors but don't necessarily skip the thread
            logger.warn(`⚠️ Could not fetch starter message for thread "${thread.name}": ${error.message}`);
          }

          try {
            // Fetch the thread owner for server-specific nickname
            let creatorName = 'Unknown';
            if (thread.guild && thread.ownerId) {
              try {
                const member = await thread.guild.members.fetch(thread.ownerId);
                creatorName = member.nickname || member.displayName || member.user.username;
              } catch (err) {
                // Fallback to fetchOwner if member is not available via guild
                const threadOwner = await thread.fetchOwner();
                if (threadOwner?.user) {
                  creatorName = threadOwner.user.displayName || threadOwner.user.username;
                }
              }
            } else {
              const threadOwner = await thread.fetchOwner();
              if (threadOwner?.user) {
                creatorName = threadOwner.user.displayName || threadOwner.user.username;
              }
            }
            
            threadData.push({
              name: thread.name,
              id: thread.id,
              createdAt: thread.createdAt!,
              creator: creatorName
            });
          } catch (error) {
            logger.warn(`⚠️ Could not fetch owner for thread "${thread.name}": ${error instanceof Error ? error.message : error}`);
            // Still include the thread, just without creator info
            threadData.push({
              name: thread.name,
              id: thread.id,
              createdAt: thread.createdAt!,
              creator: 'Unknown'
            });
          }
        }
      }

      if (skippedDeletedCount > 0) {
        logger.warn(`🗑️ Skipped ${skippedDeletedCount} threads with deleted starter messages`);
      }

      // Process the threads with context
      const validEvents = this.processOffnightThreadsWithContext(threadData);

      // Process and update file if needed
      if (validEvents.length > 0) {
        const wasUpdated = await this.processAndUpdateEvents(validEvents);
        if (wasUpdated) {
          logger.info('✅ Offnight schedule updated successfully');
        } else {
          logger.info('📋 No changes needed for offnight schedule');
        }
      } else {
        logger.info('📭 No valid offnight events found');
      }

    } catch (error) {
      logger.error(`Error finding offnight threads: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Process offnight threads with context awareness
   */
  private processOffnightThreadsWithContext(threads: { name: string; id: string; createdAt: Date; creator: string }[]): ParsedOffnightEvent[] {
    const validEvents: ParsedOffnightEvent[] = [];
    const currentDate = new Date();

    logger.info(`Processing ${threads.length} offnight threads with context awareness`);

    let parsedCount = 0;
    let skippedPastCount = 0;
    let invalidFormatCount = 0;

    for (const thread of threads) {
      // Parse with thread creation context
      const parsedEvent = parseOffnightTitle(thread.name, thread.createdAt);
      if (!parsedEvent) {
        invalidFormatCount++;
        continue;
      }

      // Skip past events
      if (parsedEvent.date < currentDate && !parsedEvent.isRecurring) {
        skippedPastCount++;
        continue;
      }

      // Generate events (including recurring ones)
      const events = this.generateRecurringEventsWithContext(parsedEvent);

      // Add to valid events
      events.forEach(event => {
        if (event.date >= currentDate) {
          validEvents.push({
            ...event,
            originalThreadId: thread.id,
            threadCreatedAt: thread.createdAt,
            threadCreator: thread.creator
          });
        }
      });
      parsedCount++;
    }

    logger.info(`Found ${validEvents.length} valid offnight events with context (${parsedCount} parsed, ${skippedPastCount} past events, ${invalidFormatCount} invalid format)`);
    return validEvents;
  }

  /**
   * Generate recurring events with context awareness
   */
  private generateRecurringEventsWithContext(event: ParsedOffnightEvent): ParsedOffnightEvent[] {
    if (!event.isRecurring) return [event];

    const events: ParsedOffnightEvent[] = [];
    const currentDate = new Date();
    
    // For recurring events, we always start from today's date
    let nextDate = new Date(currentDate);
    
    // If we have a specific day, find the next occurrence of that day
    if (event.day) {
      const targetDayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(event.day);
      if (targetDayIndex === -1) {
        logger.warn(`Invalid day for recurring event: ${event.day}`);
        return [event];
      }
      
      // Find the next occurrence of this day (including today if it matches)
      while (nextDate.getDay() !== targetDayIndex) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
    } else {
      // If no specific day, use today as starting point
      nextDate = new Date(currentDate);
    }

    // Generate next 4 occurrences
    for (let i = 0; i < 4; i++) {
      if (nextDate >= currentDate) {
        events.push({
          ...event,
          date: new Date(nextDate)
        });
      }
      nextDate.setDate(nextDate.getDate() + 7);
    }

    return events;
  }

  /**
   * Process a single thread title (for testing)
   */
  async processSingleThread(title: string): Promise<void> {
    try {
      logger.info(`🔍 Processing single thread title: "${title}"`);
      
      const parsedEvent = parseOffnightTitle(title);
      if (parsedEvent) {
        logger.info('✅ Successfully parsed event:');
        logger.info(`   Title: ${parsedEvent.title}`);
        logger.info(`   Day: ${parsedEvent.day || 'N/A'}`);
        logger.info(`   Date: ${parsedEvent.date.toLocaleDateString()}`);
        logger.info(`   Time: ${parsedEvent.time}`);
        logger.info(`   Recurring: ${parsedEvent.isRecurring}`);
        logger.info(`   Timezone: ${parsedEvent.timezone}`);
      } else {
        logger.warn('❌ Failed to parse event');
      }
    } catch (error) {
      logger.error(`Error processing single thread: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get the current offnight channel
   */
  async getOffnightChannel(client: any): Promise<TextChannel | null> {
    try {
      const channel = await client.channels.fetch(this.offnightChannelId);
      if (channel && channel.type === 0) { // 0 is GUILD_TEXT
        return channel as TextChannel;
      }
      logger.error('Offnight channel not found or is not a text channel');
      return null;
    } catch (error) {
      logger.error(`Error fetching offnight channel: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Processes offnight threads and updates the file
   */
  async processAndUpdateEvents(events: ParsedOffnightEvent[]): Promise<boolean> {
    try {
      // 1. ALWAYS read manual entries from the file FIRST, before any cache checks
      const manualEntries = await this.fileManager.readManualEntriesExcludingBotEvents(events);
      
      // 2. Generate the new file content in memory
      const newContent = this.fileManager.generateFileContent(events, manualEntries);
      
      // 3. Read the current file content
      const existingContent = await this.fileManager.readFile();

      // 4. Compare the new content with the existing content
      logger.info(`📋 Content comparison - New content length: ${newContent.trim().length}, Existing content length: ${existingContent.trim().length}`);
      
      if (newContent.trim() !== existingContent.trim()) {
        logger.info('🔄 Changes detected - will update offnight.txt file');
        
        // 5. Update the cache with the new bot events and the identified manual entries.
        this.fileManager.updateCache(events, manualEntries);
  
        // 6. Write the final file by combining new bot events and preserved manual entries.
        await this.fileManager.writeOffnightFile(newContent);
  
        // 7. Save the updated cache to disk.
        await this.fileManager.getCacheManager().saveCache();
  
        // 8. Sync to GitHub
        const syncSuccess = await this.fileManager.syncToGitHub();
        if (!syncSuccess) {
          logger.error('❌ GitHub sync failed after writing offnight.txt');
        }
      } else {
        logger.info('✅ No changes to offnight.txt needed.');
        logger.info('📋 The "Removing line" messages above were just comparison logs - no actual file changes were made.');
      }

      // 9. ALWAYS update Google Calendar if calendar ID is provided
      if (this.googleCalendarId) {
        try {
          logger.info('📅 Checking and updating Google Calendar with offnight events...');
          const currentContent = await this.fileManager.readFile();
          await updateOffnightCalendar(currentContent, this.googleCalendarId);
          logger.info('✅ Successfully updated Google Calendar with offnight events');
        } catch (error) {
          logger.error(`❌ Failed to update Google Calendar: ${error instanceof Error ? error.message : error}`);
        }
      }

      logger.info('✅ Successfully processed and updated offnight events');
      return true;
    } catch (error) {
      logger.error(`❌ Error processing offnight events: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Manually cleans up past bot events from the offnight.txt file
   * This can be called independently of the normal processing flow
   */
  async cleanupPastEvents(): Promise<{ removedCount: number; preservedCount: number }> {
    try {
      logger.info('🧹 Starting manual cleanup of past bot events...');
      const result = await this.fileManager.cleanupPastBotEvents();
      logger.info(`✅ Manual cleanup completed: ${result.removedCount} events removed, ${result.preservedCount} preserved`);
      return result;
    } catch (error) {
      logger.error(`❌ Error during manual cleanup: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }
} 