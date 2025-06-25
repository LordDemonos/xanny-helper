"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processRaidScheduleMessage = processRaidScheduleMessage;
const logger_1 = require("../../utils/logger");
// Constants for pattern matching
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMEZONES = ['ET', 'EST', 'EDT', 'CT', 'CST', 'CDT', 'MT', 'MST', 'MDT', 'PT', 'PST', 'PDT'];
// Regular expressions for pattern matching
const TIME_PATTERN = /(\d{1,2}(?::\d{2})?)\s*(?:am|pm|AM|PM)\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)/i;
const DATE_PATTERN = /\d{1,2}\/\d{1,2}/;
/**
 * Validates a timezone format in a raid schedule line
 * @param timezone The timezone string to validate
 * @returns boolean indicating if the timezone is valid
 */
function isValidTimezone(timezone) {
    return TIMEZONES.some(tz => tz.toLowerCase() === timezone.toLowerCase());
}
/**
 * Processes a message to extract valid raid schedule lines
 * @param message The message content to process
 * @returns Array of valid raid schedule lines
 */
function processRaidScheduleMessage(message) {
    // Split on bullet, normalize whitespace, strip strikethroughs, re-add bullet, and filter
    return message
        .split('•')
        .map(line => line.replace(/\s+/g, ' ').trim()) // collapse multiple spaces and trim
        .map(line => line.replace(/~~.*?~~/g, '')) // remove strikethroughs
        .map(line => line.replace(/,\s*,/g, ',').replace(/,\s*$/, '').replace(/^,\s*/, '').trim()) // clean up extra commas
        .filter(line => line.length > 0)
        .map(line => '•' + line)
        .filter(line => {
        // Check if line contains a date
        const hasDate = DATE_PATTERN.test(line);
        if (!hasDate) {
            return false;
        }
        // Check if line contains a valid time with timezone
        const timeMatch = line.match(TIME_PATTERN);
        if (!timeMatch) {
            return false;
        }
        // Validate the timezone
        const timezone = timeMatch[2];
        if (!isValidTimezone(timezone)) {
            return false;
        }
        // Check if line contains a colon (separator between time and targets)
        const hasColon = line.includes(':');
        if (!hasColon) {
            return false;
        }
        // Check if there's content after the colon
        const parts = line.split(':');
        if (parts.length < 2 || !parts[1].trim()) {
            return false;
        }
        // (Optional) Warn if day of week is missing
        const hasDay = DAYS_OF_WEEK.some(day => line.includes(day));
        if (!hasDay) {
            logger_1.logger.debug(`Warning: Line missing day of week: '${line}'`);
        }
        return true;
    });
}
//# sourceMappingURL=raidPatternMatcher.js.map