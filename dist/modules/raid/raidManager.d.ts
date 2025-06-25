import { FileProcessor } from '../../utils/fileProcessor';
import { CacheManager } from '../cache/cacheManager';
export declare class RaidManager {
    private readonly fileProcessor;
    private readonly cacheManager;
    private readonly raidSchedulePath;
    private readonly googleCalendarId;
    constructor(fileProcessor: FileProcessor, cacheManager: CacheManager, raidSchedulePath: string, googleCalendarId: string);
    /**
     * Process the raid schedule file
     */
    processRaidSchedule(): Promise<void>;
    /**
     * Process a new raid schedule from Discord
     */
    processNewSchedule(content: string): Promise<void>;
    /**
     * Get the current raid schedule content
     */
    getCurrentSchedule(): Promise<string | null>;
}
