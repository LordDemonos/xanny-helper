/**
 * Discord Events Manager
 * Creates and manages Discord events based on raid and offnight schedules
 */
export interface DiscordEventConfig {
    guildId: string;
    botToken: string;
    githubRepo: string;
    githubBranch?: string;
    raidChannelId?: string;
    offnightChannelId?: string;
    defaultRaidChannelId?: string;
    defaultOffnightChannelId?: string;
    cacheManager?: any;
}
export interface DiscordEvent {
    id?: string;
    name: string;
    description?: string;
    scheduled_start_time: string;
    scheduled_end_time: string;
    entity_type: number;
    channel_id?: string;
    entity_metadata?: {
        location?: string;
    };
    image?: string;
    privacy_level?: number;
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
declare class DiscordEventManager {
    private config;
    private baseUrl;
    private baseDelay;
    private cacheManager;
    constructor(config: DiscordEventConfig);
    /**
     * Handle rate limiting with exponential backoff
     */
    private handleRateLimit;
    /**
     * Make a Discord API request with rate limit handling
     */
    private makeDiscordRequest;
    /**
     * Main method to sync Discord events from raid and offnight files
     */
    syncEventsFromFiles(): Promise<void>;
    /**
     * Parse raid events from raids.txt
     */
    private parseRaidEvents;
    /**
     * Parse offnight events from offnight.txt
     */
    private parseOffnightEvents;
    /**
     * Parse a single raid line from raids.txt
     */
    private parseRaidLine;
    /**
     * Parse a single offnight line from offnight.txt
     */
    private parseOffnightLine;
    /**
     * Parse date and time for raid events
     */
    private parseDateTime;
    /**
     * Parse date and time for offnight events
     */
    private parseOffnightDateTime;
    /**
     * Gets the timezone offset in hours from UTC
     */
    private getTimezoneOffset;
    /**
     * Generate raid description
     */
    private generateRaidDescription;
    /**
     * Get existing Discord events
     */
    private getExistingEvents;
    /**
     * Process events (create or update)
     */
    private processEvents;
    /**
     * Checks if an existing Discord event needs to be updated.
     */
    private doesEventNeedUpdate;
    /**
     * Find matching existing event by comparing against source files
     */
    private findMatchingEvent;
    /**
     * Verify event accuracy against source files
     */
    private verifyEventAgainstSource;
    /**
     * Create new Discord event
     */
    private createEvent;
    /**
     * Update existing Discord event
     */
    private updateEvent;
    /**
     * Clean up old events that no longer exist in our files
     */
    private cleanupOldEvents;
    /**
     * Delete Discord event
     */
    private deleteEvent;
}
export default DiscordEventManager;
