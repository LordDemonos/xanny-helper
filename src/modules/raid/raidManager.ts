import { FileProcessor } from '../../utils/fileProcessor';
import { CacheManager } from '../cache/cacheManager';
import { logger } from '../../utils/logger';
import fs from 'fs/promises';
import { updateRaidCalendar } from '../calendar/calendar';

export class RaidManager {
  constructor(
    private readonly fileProcessor: FileProcessor,
    private readonly cacheManager: CacheManager,
    private readonly raidSchedulePath: string,
    private readonly googleCalendarId: string
  ) {}

  /**
   * Process the raid schedule file
   */
  async processRaidSchedule(): Promise<void> {
    try {
      let scheduleContent: string | null = null;
      const cachedSchedule = this.cacheManager.getRaidSchedule();

      if (cachedSchedule?.content) {
        logger.info('Processing raid schedule from cache...');
        scheduleContent = cachedSchedule.content;
      } else {
        logger.info('No raid schedule in cache, attempting to read from file...');
        try {
          scheduleContent = await fs.readFile(this.raidSchedulePath, 'utf-8');
          if (scheduleContent) {
            logger.info('Successfully loaded schedule from file, repopulating cache.');
            this.cacheManager.updateRaidSchedule(scheduleContent, Date.now());
            await this.cacheManager.saveCache();
          }
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            logger.info('raids.txt file not found, no schedule to process.');
          } else {
            logger.error(`Error reading raid schedule file: ${error.message}`);
          }
          return;
        }
      }

      if (!scheduleContent) {
        logger.info('No raid schedule content available to process.');
        return;
      }

      // Debug: Print the first 500 characters and line count of scheduleContent
      logger.info('DEBUG: scheduleContent length: ' + scheduleContent.length);
      logger.info('DEBUG: scheduleContent (first 500 chars): ' + scheduleContent.substring(0, 500));
      logger.info('DEBUG: scheduleContent line count: ' + scheduleContent.split('\n').length);

      // Always check and update calendar
      try {
        logger.info('Checking and updating Google Calendar for raid events...');
        await updateRaidCalendar(scheduleContent, this.googleCalendarId);
        logger.info('✅ Successfully updated Google Calendar with raid schedule.');
      } catch (error) {
        logger.error(`❌ Failed to update raid calendar: ${error instanceof Error ? error.message : error}`);
      }
    } catch (error) {
      logger.error(`Error processing raid schedule: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Process a new raid schedule from Discord
   */
  async processNewSchedule(content: string): Promise<void> {
    try {
      const cachedSchedule = this.cacheManager.getRaidSchedule();

      if (!cachedSchedule || cachedSchedule.content !== content) {
        const result = await this.fileProcessor.processBatch([{
          path: this.raidSchedulePath,
          content: content
        }]);

        if (result[0].success) {
          this.cacheManager.updateRaidSchedule(content, Date.now());
          await this.cacheManager.saveCache();

          // Only update calendar after successful schedule processing
          try {
            logger.info('Checking and updating Google Calendar...');
            await updateRaidCalendar(content, this.googleCalendarId);
            logger.info('Successfully updated Google Calendar with raid schedule');
          } catch (error) {
            logger.error(`Failed to update Google Calendar: ${error instanceof Error ? error.message : error}`);
          }
        } else {
          logger.error(`Failed to process raid schedule: ${result[0].error}`);
        }
      } else {
        logger.info('Raid schedule content is up to date');
        
        // Even if content hasn't changed, still check calendar for missing events
        try {
          logger.info('Checking Google Calendar for missing events...');
          await updateRaidCalendar(content, this.googleCalendarId);
          logger.info('Successfully checked Google Calendar for missing events');
        } catch (error) {
          logger.error(`Failed to check Google Calendar: ${error instanceof Error ? error.message : error}`);
        }
      }
    } catch (error) {
      logger.error(`Error processing new raid schedule: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get the current raid schedule content
   */
  async getCurrentSchedule(): Promise<string | null> {
    try {
      const cachedSchedule = this.cacheManager.getRaidSchedule();
      if (cachedSchedule) {
        return cachedSchedule.content;
      }

      // If not in cache, try to read from file
      const content = await fs.readFile(this.raidSchedulePath, 'utf-8');
      return content;
    } catch (error) {
      logger.error(`Error reading raid schedule: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
} 