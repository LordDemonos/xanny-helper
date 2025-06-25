/**
 * Discord Events Manager
 * Creates and manages Discord events based on raid and offnight schedules
 */

import { getEventImageUrl, githubImageToDataURI } from '../../utils/imageMatcher';
import { logger } from '../../utils/logger';

export interface DiscordEventConfig {
  guildId: string;
  botToken: string;
  githubRepo: string;
  githubBranch?: string;
  raidChannelId?: string;
  offnightChannelId?: string;
  defaultRaidChannelId?: string;
  defaultOffnightChannelId?: string;
  cacheManager?: any; // Add cache manager reference
}

export interface DiscordEvent {
  id?: string;
  name: string;
  description?: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  entity_type: number; // 1 = stage instance, 2 = voice, 3 = external
  channel_id?: string;
  entity_metadata?: {
    location?: string;
  };
  image?: string;
  privacy_level?: number; // 2 = guild only
  send_start_notification?: boolean;
}

export interface ParsedEvent {
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  type: 'raid' | 'offnight';
  channelId?: string;
}

class DiscordEventManager {
  private config: DiscordEventConfig;
  private baseUrl = 'https://discord.com/api/v10';
  private baseDelay = 10000; // 10 seconds base delay
  private cacheManager: any;

  constructor(config: DiscordEventConfig) {
    this.config = {
      ...config,
      guildId: process.env.DISCORD_GUILD_ID || config.guildId,
      botToken: process.env.DISCORD_TOKEN || config.botToken,
      githubRepo: process.env.GITHUB_REPO || config.githubRepo,
      githubBranch: process.env.GITHUB_BRANCH || config.githubBranch,
      raidChannelId: process.env.DISCORD_RAID_CHANNEL_ID || config.raidChannelId,
      offnightChannelId: process.env.DISCORD_OFFNIGHT_CHANNEL_ID || config.offnightChannelId,
    };
    this.cacheManager = config.cacheManager;
  }

  /**
   * Handle rate limiting with exponential backoff
   */
  private async handleRateLimit(response: Response, attempt: number = 1): Promise<void> {
    if (response.status === 429) {
      const errorData = await response.json();
      const retryAfter = (errorData.retry_after || 5) * 1000; // Convert to milliseconds
      const backoffDelay = Math.min(retryAfter * Math.pow(2, attempt - 1), 60000); // Max 60 seconds
      
      logger.info(`Rate limited. Waiting ${backoffDelay}ms before retry (attempt ${attempt})`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }

  /**
   * Make a Discord API request with rate limit handling
   */
  private async makeDiscordRequest(url: string, options: RequestInit, maxRetries: number = 3): Promise<Response> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        
        if (response.status === 429) {
          await this.handleRateLimit(response, attempt);
          if (attempt === maxRetries) {
            throw new Error(`Rate limited after ${maxRetries} attempts`);
          }
          continue; // Retry the request
        }
        
        return response;
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        logger.error(`Request failed (attempt ${attempt}/${maxRetries}):`, error);
        await new Promise(resolve => setTimeout(resolve, this.baseDelay));
      }
    }
    
    throw new Error(`Request failed after ${maxRetries} attempts`);
  }

  /**
   * Main method to sync Discord events from raid and offnight files
   */
  async syncEventsFromFiles(): Promise<void> {
    try {
      logger.info('Starting Discord events sync...');

      // Read and parse raid events
      const raidEvents = await this.parseRaidEvents();
      logger.info(`Parsed ${raidEvents.length} raid events`);

      // Read and parse offnight events
      const offnightEvents = await this.parseOffnightEvents();
      logger.info(`Parsed ${offnightEvents.length} offnight events`);

      // Get existing Discord events
      const existingEvents = await this.getExistingEvents();
      logger.info(`Found ${existingEvents.length} existing Discord events`);

      // Process raid events
      const raidResults = await this.processEvents(raidEvents, existingEvents, 'raid');

      // Process offnight events
      const offnightResults = await this.processEvents(offnightEvents, existingEvents, 'offnight');

      // Clean up old events (events that no longer exist in our files)
      const cleanupResults = await this.cleanupOldEvents(raidEvents, offnightEvents, existingEvents);

      // Log summary
      const totalCreated = raidResults.created + offnightResults.created;
      const totalUpdated = raidResults.updated + offnightResults.updated;
      const totalSkipped = raidResults.skipped + offnightResults.skipped;
      const totalDeleted = cleanupResults.deleted;

      if (totalCreated > 0 || totalUpdated > 0 || totalDeleted > 0) {
        logger.info(`✅ Discord events sync complete: ${totalCreated} created, ${totalUpdated} updated, ${totalDeleted} deleted, ${totalSkipped} skipped`);
      } else {
        logger.info(`📋 Discord events sync complete: No changes needed`);
      }
    } catch (error) {
      logger.error('❌ Discord events sync failed:', error);
      throw error;
    }
  }

  /**
   * Parse raid events from raids.txt
   */
  private async parseRaidEvents(): Promise<ParsedEvent[]> {
    try {
      const fs = require('fs').promises;
      const raidContent = await fs.readFile('assets/data/raids.txt', 'utf8');
      
      const events: ParsedEvent[] = [];
      const lines = raidContent.split('\n').filter((line: string) => line.trim());

      for (const line of lines) {
        const event = this.parseRaidLine(line);
        if (event) {
          events.push(event);
        }
      }

      return events;
    } catch (error) {
      logger.error('Error parsing raid events:', error);
      return [];
    }
  }

  /**
   * Parse offnight events from offnight.txt
   */
  private async parseOffnightEvents(): Promise<ParsedEvent[]> {
    try {
      const fs = require('fs').promises;
      const offnightContent = await fs.readFile('assets/data/offnight.txt', 'utf8');
      
      const events: ParsedEvent[] = [];
      const lines = offnightContent.split('\n').filter((line: string) => line.trim());

      for (const line of lines) {
        const event = this.parseOffnightLine(line);
        if (event) {
          events.push(event);
        }
      }

      return events;
    } catch (error) {
      logger.error('Error parsing offnight events:', error);
      return [];
    }
  }

  /**
   * Parse a single raid line from raids.txt
   */
  private parseRaidLine(line: string): ParsedEvent | null {
    try {
      // Format: "•Friday, 6/20; 9pm ET: Plane of Fear, Sleeper's Tomb"
      const match = line.match(/•([^;]+);\s*(\d+:\d+|\d+)\s*([ap]m)\s*(\w+)?:\s*(.+)/i);
      if (!match) return null;

      const [, dayTime, time, ampm, timezone, targets] = match;
      const fullTime = `${time}${ampm}`;
      
      // Parse the date and time
      const dateTime = this.parseDateTime(dayTime, fullTime, timezone || 'ET');
      if (!dateTime) return null;

      // Calculate end time (3 hours for raids)
      const endTime = new Date(dateTime.getTime() + (3 * 60 * 60 * 1000));

      return {
        title: `Raid Night: ${targets}`,
        description: this.generateRaidDescription(targets),
        startTime: dateTime,
        endTime: endTime,
        type: 'raid',
        channelId: this.config.raidChannelId || this.config.defaultRaidChannelId
      };
    } catch (error) {
      logger.error('Error parsing raid line:', line, error);
      return null;
    }
  }

  /**
   * Parse a single offnight line from offnight.txt
   */
  private parseOffnightLine(line: string): ParsedEvent | null {
    try {
      // Format: "Sunday 6/22 10:30 AM EST. We're Definitely Not Planning Something Mischievous. Hosted by Xanax/Xanathema/Xanamaniac/Xanti"
      const match = line.match(/(?:[A-Za-z]+)\s+(\d+\/\d+)\s+(\d+:\d+\s+[AP]M)\s+(\w+)\.\s*(.+?)(?:\.\s*Hosted by\s+(.+))?$/);
      if (!match) return null;

      let [, date, time, timezone, title, host] = match;
      
      // Treat specific timezones as their general equivalent to handle DST automatically
      if (timezone.toUpperCase() === 'EST' || timezone.toUpperCase() === 'EDT') {
        timezone = 'ET';
      }
      
      // Parse the date and time
      const dateTime = this.parseOffnightDateTime(date, time, timezone);
      if (!dateTime) return null;

      // Calculate end time (2 hours for offnight events)
      const endTime = new Date(dateTime.getTime() + (2 * 60 * 60 * 1000));

      const description = host ? `${title}. Hosted by ${host}` : title;

      // Determine event type based on title
      const eventType = title.toLowerCase().includes('halls of testing') ? 'Offnight Raid' : 'Static Group';

      return {
        title: `${eventType}: ${title}`,
        description: description,
        startTime: dateTime,
        endTime: endTime,
        type: 'offnight',
        channelId: this.config.offnightChannelId || this.config.defaultOffnightChannelId
      };
    } catch (error) {
      logger.error('Error parsing offnight line:', line, error);
      return null;
    }
  }

  /**
   * Parse date and time for raid events
   */
  private parseDateTime(dayTime: string, time: string, timezone: string): Date | null {
    try {
      const dayMatch = dayTime.match(/([A-Za-z]+),\s*(\d+)\/(\d+)/);
      if (!dayMatch) return null;

      const [, , month, day] = dayMatch;
      const eventYear = new Date().getFullYear();
      
      const timeMatch = time.match(/(\d+)(?::(\d+))?([ap]m)/i);
      if (!timeMatch) return null;

      let [_, hour, minutes, ampm] = timeMatch;
      let hourNum = parseInt(hour);
      const minNum = minutes ? parseInt(minutes) : 0;
      
      if (ampm.toLowerCase() === 'pm' && hourNum !== 12) {
        hourNum += 12;
      } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
        hourNum = 0;
      }

      const tzOffset = this.getTimezoneOffset(timezone, new Date(eventYear, parseInt(month) - 1, parseInt(day)));
      
      const eventDate = new Date(Date.UTC(eventYear, parseInt(month) - 1, parseInt(day), hourNum - tzOffset, minNum, 0));

      return eventDate;
    } catch (error) {
      logger.error('Error parsing date/time:', dayTime, time, timezone, error);
      return null;
    }
  }

  /**
   * Parse date and time for offnight events
   */
  private parseOffnightDateTime(date: string, time: string, timezone: string): Date | null {
    try {
      const dateMatch = date.match(/(\d+)\/(\d+)/);
      if (!dateMatch) return null;

      const [, month, dayNum] = dateMatch;
      const eventYear = new Date().getFullYear();
      
      const timeMatch = time.match(/(\d+):(\d+)\s+([AP]M)/i);
      if (!timeMatch) return null;

      let [_, hour, minutes, ampm] = timeMatch;
      let hourNum = parseInt(hour);
      const minNum = parseInt(minutes);

      if (ampm.toUpperCase() === 'PM' && hourNum !== 12) {
        hourNum += 12;
      } else if (ampm.toUpperCase() === 'AM' && hourNum === 12) {
        hourNum = 0;
      }

      const tzOffset = this.getTimezoneOffset(timezone, new Date(eventYear, parseInt(month) - 1, parseInt(dayNum)));
      
      const eventDate = new Date(Date.UTC(eventYear, parseInt(month) - 1, parseInt(dayNum), hourNum - tzOffset, minNum, 0));

      return eventDate;
    } catch (error) {
      logger.error('Error parsing offnight date/time:', date, time, timezone, error);
      return null;
    }
  }

  /**
   * Gets the timezone offset in hours from UTC
   */
  private getTimezoneOffset(timezone: string, eventDate: Date): number {
    // In North America, DST starts on the second Sunday in March and ends on the first Sunday in November.
    const year = eventDate.getFullYear();
    const dstStart = new Date(year, 2, 8, 2, 0, 0); // March 8th
    dstStart.setDate(dstStart.getDate() + (7 - dstStart.getDay()) % 7); // Second Sunday
    const dstEnd = new Date(year, 10, 1, 2, 0, 0); // November 1st
    dstEnd.setDate(dstEnd.getDate() + (7 - dstEnd.getDay()) % 7); // First Sunday

    const isDST = eventDate >= dstStart && eventDate < dstEnd;
    
    switch (timezone.toUpperCase()) {
      case 'ET':
        return isDST ? -4 : -5;
      case 'EDT':
        return -4;
      case 'EST':
        return -5;
      case 'CT':
        return isDST ? -5 : -6;
      case 'CDT':
        return -5;
      case 'CST':
        return -6;
      default:
        logger.warn(`Unexpected timezone: ${timezone}. Defaulting to ET.`);
        return isDST ? -4 : -5; // Default to ET
    }
  }

  /**
   * Generate raid description
   */
  private generateRaidDescription(targets: string): string {
    return `**Scheduled Raid Night: Minimum Lv55+ Required**\n\n**Targets:** ${targets}\n\n[DKP Rules Apply](https://formerglory.lol/aboutdkp/)\n\nJoin us at [formerglory.lol](https://formerglory.lol/)`;
  }

  /**
   * Get existing Discord events
   */
  private async getExistingEvents(): Promise<any[]> {
    try {
      const response = await this.makeDiscordRequest(
        `${this.baseUrl}/guilds/${this.config.guildId}/scheduled-events`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bot ${this.config.botToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`);
      }

      const events = await response.json();
      return events || [];
    } catch (error) {
      logger.error('Error fetching existing events:', error);
      return [];
    }
  }

  /**
   * Process events (create or update)
   */
  private async processEvents(events: ParsedEvent[], existingEvents: any[], eventType: 'raid' | 'offnight'): Promise<{ created: number; updated: number; skipped: number; deleted: number }> {
    const now = new Date();
    logger.info(`Processing ${events.length} ${eventType} events...`);
    
    const results = { created: 0, updated: 0, skipped: 0, deleted: 0 };

    for (const event of events) {
      try {
        // Skip events that are in the past
        if (event.startTime < now) {
          results.skipped++;
          continue;
        }

        // Verify event against source file
        const isAccurate = await this.verifyEventAgainstSource(event, eventType);
        if (!isAccurate) {
          logger.warn(`Event "${event.title}" not found in source file - skipping`);
          results.skipped++;
          continue;
        }

        const existingEvent = this.findMatchingEvent(event, existingEvents);

        if (existingEvent) {
          const needsUpdate = this.doesEventNeedUpdate(event, existingEvent);
          if (needsUpdate) {
            await this.updateEvent(existingEvent.id!, event, eventType);
            results.updated++;
            logger.info(`Updated ${eventType} event: ${event.title}`);
          } else {
            results.skipped++;
            continue; // Skip the delay if no update was needed
          }
        } else {
          await this.createEvent(event, eventType);
          results.created++;
          logger.info(`Created ${eventType} event: ${event.title}`);
        }
      } catch (error) {
        if (error instanceof Error) {
            logger.error(`Error processing ${eventType} event "${event.title}": ${error.message}`);
        } else {
            logger.error(`An unknown error occurred while processing ${eventType} event "${event.title}"`);
        }
      } finally {
        // Add a 15-second delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }

    return results;
  }

  /**
   * Checks if an existing Discord event needs to be updated.
   */
  private doesEventNeedUpdate(parsedEvent: ParsedEvent, existingEvent: any): boolean {
    const startTimeNeedsUpdate = new Date(existingEvent.scheduled_start_time).getTime() !== parsedEvent.startTime.getTime();
    const endTimeNeedsUpdate = new Date(existingEvent.scheduled_end_time).getTime() !== parsedEvent.endTime.getTime();

    const normalize = (str: string = '') => (str || '').replace(/\s/g, '').toLowerCase();

    const descriptionNeedsUpdate = normalize(existingEvent.description) !== normalize(parsedEvent.description);

    if (
      existingEvent.name !== parsedEvent.title ||
      descriptionNeedsUpdate ||
      startTimeNeedsUpdate ||
      endTimeNeedsUpdate
    ) {
      return true;
    }

    return false;
  }

  /**
   * Find matching existing event by comparing against source files
   */
  private findMatchingEvent(event: ParsedEvent, existingEvents: any[]): any | null {
    return existingEvents.find(existing => {
      // Match by exact title and start time (within 1 minute tolerance)
      const titleMatch = existing.name === event.title;
      const existingStart = new Date(existing.scheduled_start_time);
      const timeDiff = Math.abs(existingStart.getTime() - event.startTime.getTime());
      const timeMatch = timeDiff < (1 * 60 * 1000); // 1 minute tolerance
      
      return titleMatch && timeMatch;
    });
  }

  /**
   * Verify event accuracy against source files
   */
  private async verifyEventAgainstSource(event: ParsedEvent, eventType: 'raid' | 'offnight'): Promise<boolean> {
    try {
      const fs = require('fs').promises;
      const sourceFile = eventType === 'raid' ? 'assets/data/raids.txt' : 'assets/data/offnight.txt';
      const sourceContent = await fs.readFile(sourceFile, 'utf8');
      
      // For raid events, check if the targets match
      if (eventType === 'raid') {
        const targets = event.title.replace('Raid Night: ', '');
        return sourceContent.includes(targets);
      }
      
      // For offnight events, check if the title matches
      if (eventType === 'offnight') {
        const title = event.title.replace('Static Group: ', '').replace('Offnight Raid: ', '');
        return sourceContent.includes(title);
      }
      
      return false;
    } catch (error) {
      logger.error(`Error verifying event against source: ${error}`);
      return false;
    }
  }

  /**
   * Create new Discord event
   */
  private async createEvent(event: ParsedEvent, eventType: 'raid' | 'offnight'): Promise<void> {
    const discordEvent: DiscordEvent = {
      name: event.title,
      description: event.description,
      scheduled_start_time: event.startTime.toISOString(),
      scheduled_end_time: event.endTime.toISOString(),
      entity_type: event.channelId ? 2 : 3, // 2 = voice channel, 3 = external
      channel_id: event.channelId,
      privacy_level: 2, // Guild only
      send_start_notification: false // Silent creation
    };

    const imageUrl = getEventImageUrl(
      event.title,
      event.description,
      eventType,
      this.config.githubRepo,
      this.config.githubBranch
    );
    
    if (imageUrl && this.cacheManager) {
      logger.info(`Converting image URL to data URI: ${imageUrl}`);
      const dataUri = await githubImageToDataURI(imageUrl, this.cacheManager);
      if (dataUri) {
        discordEvent.image = dataUri;
        logger.info(`Successfully added image to event: ${event.title}`);
      } else {
        logger.warn(`Failed to convert image to data URI, skipping image for event: ${event.title}`);
      }
    }

    const response = await this.makeDiscordRequest(
      `${this.baseUrl}/guilds/${this.config.guildId}/scheduled-events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(discordEvent)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Discord API Error Response: ${errorBody}`);
      logger.error(`Failed Event Payload: ${JSON.stringify(discordEvent, null, 2)}`);
      throw new Error(`Failed to create event: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Update existing Discord event
   */
  private async updateEvent(eventId: string, event: ParsedEvent, eventType: 'raid' | 'offnight'): Promise<void> {
    const discordEvent: Partial<DiscordEvent> = {
      name: event.title,
      description: event.description,
      scheduled_start_time: event.startTime.toISOString(),
      scheduled_end_time: event.endTime.toISOString(),
      send_start_notification: false
    };

    const imageUrl = getEventImageUrl(
      event.title,
      event.description,
      eventType,
      this.config.githubRepo,
      this.config.githubBranch
    );
    
    if (imageUrl && this.cacheManager) {
      logger.info(`Converting image URL to data URI for update: ${imageUrl}`);
      const dataUri = await githubImageToDataURI(imageUrl, this.cacheManager);
      if (dataUri) {
        discordEvent.image = dataUri;
        logger.info(`Successfully added image to event update: ${event.title}`);
      } else {
        logger.warn(`Failed to convert image to data URI, skipping image for event update: ${event.title}`);
      }
    }

    const response = await this.makeDiscordRequest(
      `${this.baseUrl}/guilds/${this.config.guildId}/scheduled-events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(discordEvent)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Discord API Error Response: ${errorBody}`);
      logger.error(`Failed Event Payload: ${JSON.stringify(discordEvent, null, 2)}`);
      throw new Error(`Failed to update event: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Clean up old events that no longer exist in our files
   */
  private async cleanupOldEvents(raidEvents: ParsedEvent[], offnightEvents: ParsedEvent[], existingEvents: any[]): Promise<{ deleted: number }> {
    const allEvents = [...raidEvents, ...offnightEvents];
    const now = new Date();
    
    logger.info(`Checking ${existingEvents.length} existing Discord events for cleanup...`);
    
    const results = { deleted: 0 };

    for (const existingEvent of existingEvents) {
      try {
        const eventStart = new Date(existingEvent.scheduled_start_time);
        
        // Skip events that are in the past
        if (eventStart < now) {
          continue;
        }

        // Check if this event still exists in our source files
        const stillExists = allEvents.some(event => {
          const titleMatch = event.title === existingEvent.name;
          const timeMatch = Math.abs(event.startTime.getTime() - eventStart.getTime()) < (1 * 60 * 1000); // 1 minute tolerance
          return titleMatch && timeMatch;
        });

        if (!stillExists) {
          logger.info(`Deleting old event: ${existingEvent.name} (scheduled for ${eventStart.toLocaleString()})`);
          await this.deleteEvent(existingEvent.id);
          results.deleted++;
          logger.info(`Successfully deleted old event: ${existingEvent.name}`);
        }
      } catch (error) {
        logger.error(`Error cleaning up event ${existingEvent.name}:`, error);
      }
    }

    return results;
  }

  /**
   * Delete Discord event
   */
  private async deleteEvent(eventId: string): Promise<void> {
    const response = await this.makeDiscordRequest(
      `${this.baseUrl}/guilds/${this.config.guildId}/scheduled-events/${eventId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete event: ${response.status} ${response.statusText}`);
    }
  }
}

export default DiscordEventManager; 