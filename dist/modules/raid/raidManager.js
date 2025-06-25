"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaidManager = void 0;
const logger_1 = require("../../utils/logger");
const promises_1 = __importDefault(require("fs/promises"));
const calendar_1 = require("../calendar/calendar");
class RaidManager {
    constructor(fileProcessor, cacheManager, raidSchedulePath, googleCalendarId) {
        this.fileProcessor = fileProcessor;
        this.cacheManager = cacheManager;
        this.raidSchedulePath = raidSchedulePath;
        this.googleCalendarId = googleCalendarId;
    }
    /**
     * Process the raid schedule file
     */
    async processRaidSchedule() {
        try {
            let scheduleContent = null;
            const cachedSchedule = this.cacheManager.getRaidSchedule();
            if (cachedSchedule?.content) {
                logger_1.logger.info('Processing raid schedule from cache...');
                scheduleContent = cachedSchedule.content;
            }
            else {
                logger_1.logger.info('No raid schedule in cache, attempting to read from file...');
                try {
                    scheduleContent = await promises_1.default.readFile(this.raidSchedulePath, 'utf-8');
                    if (scheduleContent) {
                        logger_1.logger.info('Successfully loaded schedule from file, repopulating cache.');
                        this.cacheManager.updateRaidSchedule(scheduleContent, Date.now());
                        await this.cacheManager.saveCache();
                    }
                }
                catch (error) {
                    if (error.code === 'ENOENT') {
                        logger_1.logger.info('raids.txt file not found, no schedule to process.');
                    }
                    else {
                        logger_1.logger.error(`Error reading raid schedule file: ${error.message}`);
                    }
                    return;
                }
            }
            if (!scheduleContent) {
                logger_1.logger.info('No raid schedule content available to process.');
                return;
            }
            // Debug: Print the first 500 characters and line count of scheduleContent
            logger_1.logger.info('DEBUG: scheduleContent length: ' + scheduleContent.length);
            logger_1.logger.info('DEBUG: scheduleContent (first 500 chars): ' + scheduleContent.substring(0, 500));
            logger_1.logger.info('DEBUG: scheduleContent line count: ' + scheduleContent.split('\n').length);
            // Always check and update calendar
            try {
                logger_1.logger.info('Checking and updating Google Calendar for raid events...');
                await (0, calendar_1.updateRaidCalendar)(scheduleContent, this.googleCalendarId);
                logger_1.logger.info('✅ Successfully updated Google Calendar with raid schedule.');
            }
            catch (error) {
                logger_1.logger.error(`❌ Failed to update raid calendar: ${error instanceof Error ? error.message : error}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`Error processing raid schedule: ${error instanceof Error ? error.message : error}`);
        }
    }
    /**
     * Process a new raid schedule from Discord
     */
    async processNewSchedule(content) {
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
                        logger_1.logger.info('Checking and updating Google Calendar...');
                        await (0, calendar_1.updateRaidCalendar)(content, this.googleCalendarId);
                        logger_1.logger.info('Successfully updated Google Calendar with raid schedule');
                    }
                    catch (error) {
                        logger_1.logger.error(`Failed to update Google Calendar: ${error instanceof Error ? error.message : error}`);
                    }
                }
                else {
                    logger_1.logger.error(`Failed to process raid schedule: ${result[0].error}`);
                }
            }
            else {
                logger_1.logger.info('Raid schedule content is up to date');
                // Even if content hasn't changed, still check calendar for missing events
                try {
                    logger_1.logger.info('Checking Google Calendar for missing events...');
                    await (0, calendar_1.updateRaidCalendar)(content, this.googleCalendarId);
                    logger_1.logger.info('Successfully checked Google Calendar for missing events');
                }
                catch (error) {
                    logger_1.logger.error(`Failed to check Google Calendar: ${error instanceof Error ? error.message : error}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Error processing new raid schedule: ${error instanceof Error ? error.message : error}`);
        }
    }
    /**
     * Get the current raid schedule content
     */
    async getCurrentSchedule() {
        try {
            const cachedSchedule = this.cacheManager.getRaidSchedule();
            if (cachedSchedule) {
                return cachedSchedule.content;
            }
            // If not in cache, try to read from file
            const content = await promises_1.default.readFile(this.raidSchedulePath, 'utf-8');
            return content;
        }
        catch (error) {
            logger_1.logger.error(`Error reading raid schedule: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }
}
exports.RaidManager = RaidManager;
//# sourceMappingURL=raidManager.js.map