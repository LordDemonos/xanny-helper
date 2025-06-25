import { TextChannel } from 'discord.js';
import { ParsedOffnightEvent } from './offnightPatternMatcher';
import { CacheManager } from '../cache/cacheManager';
export declare class OffnightManager {
    private readonly offnightChannelId;
    private readonly googleCalendarId?;
    private fileManager;
    constructor(offnightChannelId: string, offnightFilePath: string, cacheManager: CacheManager, googleCalendarId?: string | undefined);
    /**
     * Finds and processes the latest offnight threads
     */
    findLatestOffnightThreads(channel: TextChannel): Promise<void>;
    /**
     * Process offnight threads with context awareness
     */
    private processOffnightThreadsWithContext;
    /**
     * Generate recurring events with context awareness
     */
    private generateRecurringEventsWithContext;
    /**
     * Process a single thread title (for testing)
     */
    processSingleThread(title: string): Promise<void>;
    /**
     * Get the current offnight channel
     */
    getOffnightChannel(client: any): Promise<TextChannel | null>;
    /**
     * Processes offnight threads and updates the file
     */
    processAndUpdateEvents(events: ParsedOffnightEvent[]): Promise<boolean>;
    /**
     * Manually cleans up past bot events from the offnight.txt file
     * This can be called independently of the normal processing flow
     */
    cleanupPastEvents(): Promise<{
        removedCount: number;
        preservedCount: number;
    }>;
}
