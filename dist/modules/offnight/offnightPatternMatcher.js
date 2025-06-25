"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOffnightTitle = parseOffnightTitle;
exports.generateRecurringEvents = generateRecurringEvents;
exports.processOffnightThreads = processOffnightThreads;
exports.formatOffnightEvent = formatOffnightEvent;
exports.formatOffnightEvents = formatOffnightEvents;
const logger_1 = require("../../utils/logger");
// Constants for pattern matching
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PLURAL_DAYS = DAYS_OF_WEEK.map(day => day + 's');
const TIMEZONES = ['ET', 'EST', 'EDT', 'CT', 'CST', 'CDT', 'MT', 'MST', 'MDT', 'PT', 'PST', 'PDT'];
// Raid schedule constants
const RAID_SCHEDULE = {
    // Former Glory raids: Monday, Wednesday, Friday, Saturday 9:00 PM - 12:00 AM EST
    'Monday': { start: '9:00 PM EST', end: '12:00 AM EST', type: 'former_glory' },
    'Wednesday': { start: '9:00 PM EST', end: '12:00 AM EST', type: 'former_glory' },
    'Friday': { start: '9:00 PM EST', end: '12:00 AM EST', type: 'former_glory' },
    'Saturday': { start: '9:00 PM EST', end: '12:00 AM EST', type: 'former_glory' },
    // Xanax offnight raids: Tuesday 9:00 PM - 11:00 PM EST
    'Tuesday': { start: '9:00 PM EST', end: '11:00 PM EST', type: 'xanax_offnight' }
};
// Regular expressions for pattern matching
const FULL_DATE_PATTERN = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?/i;
const SHORT_DATE_PATTERN = /\d{1,2}\/\d{1,2}(?:\/\d{1,2})?/;
const DATE_WITH_YEAR = /\d{4}\/\d{1,2}\/\d{1,2}/;
const TIME_PATTERN = /(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s*(?:ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)|before\s+raid|after\s+raid)/i;
const TIME_RANGE_PATTERN = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)/i;
const APPROXIMATE_TIME = /~\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s*(?:ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)/i;
// Robust patterns for before/after raid
const BEFORE_RAID_PATTERNS = [/before raid/i, /pre[- ]?raid/i, /before the raid/i];
const AFTER_RAID_PATTERNS = [/after raid/i, /post[- ]?raid/i, /after the raid/i, /raid afterparty/i];
/**
 * Extracts the day of week from a title
 * @param title The thread title to parse
 * @returns The day of week if found, null otherwise
 */
function extractDay(title) {
    const day = DAYS_OF_WEEK.find(day => title.includes(day));
    return day || null;
}
/**
 * Extracts the timezone from a title
 * @param title The thread title to parse
 * @returns The timezone if found, 'EST' as default
 */
function extractTimezone(title) {
    const timezone = TIMEZONES.find(tz => title.toUpperCase().includes(tz.toUpperCase()));
    return timezone || 'EST';
}
/**
 * Converts time from one timezone to EST
 * @param timeStr The time string to convert
 * @param fromTimezone The source timezone
 * @returns The time converted to EST
 */
function convertToEST(timeStr, fromTimezone) {
    // Remove timezone from time string
    const timeWithoutTz = timeStr.replace(/\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)/i, '').trim();
    // If already EST/EDT, return as is
    if (fromTimezone.toUpperCase() === 'EST' || fromTimezone.toUpperCase() === 'EDT') {
        return `${timeWithoutTz} EST`;
    }
    // For now, we'll use a simple offset conversion
    // In a production system, you'd want to use a proper timezone library like moment-timezone
    const timezoneOffsets = {
        'CST': 1, // CST is 1 hour behind EST
        'CDT': 0, // CDT is same as EDT
        'MST': 2, // MST is 2 hours behind EST
        'MDT': 1, // MDT is 1 hour behind EST
        'PST': 3, // PST is 3 hours behind EST
        'PDT': 2, // PDT is 2 hours behind EST
        'CT': 1, // Central Time
        'MT': 2, // Mountain Time
        'PT': 3 // Pacific Time
    };
    const offset = timezoneOffsets[fromTimezone.toUpperCase()] || 0;
    // Parse the time and add the offset
    const timeMatch = timeWithoutTz.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)/i);
    if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const period = timeMatch[3].toUpperCase();
        // Convert to 24-hour format
        if (period === 'PM' && hour !== 12)
            hour += 12;
        if (period === 'AM' && hour === 12)
            hour = 0;
        // Add offset
        hour += offset;
        // Handle day wrap-around
        if (hour >= 24)
            hour -= 24;
        if (hour < 0)
            hour += 24;
        // Convert back to 12-hour format
        const newPeriod = hour >= 12 ? 'PM' : 'AM';
        if (hour > 12)
            hour -= 12;
        if (hour === 0)
            hour = 12;
        const formattedTime = minutes > 0 ? `${hour}:${minutes.toString().padStart(2, '0')} ${newPeriod}` : `${hour} ${newPeriod}`;
        return `${formattedTime} EST`;
    }
    // If parsing fails, return original time with EST
    return `${timeWithoutTz} EST`;
}
/**
 * Parses time from a title, handling relative times and time ranges
 * @param title The thread title to parse
 * @param eventDate The date of the event (for intelligent raid time inference)
 * @returns Object with time and optional timeRange
 */
function parseTime(title, eventDate) {
    const isBeforeRaid = BEFORE_RAID_PATTERNS.some(re => re.test(title));
    const isAfterRaid = AFTER_RAID_PATTERNS.some(re => re.test(title));
    // Handle relative times with intelligent inference
    if (isBeforeRaid || isAfterRaid) {
        if (eventDate) {
            const inferredTime = inferRaidTime(eventDate, isBeforeRaid, isAfterRaid);
            return { time: inferredTime };
        }
        else {
            // Fallback to default times if no event date available
            if (isBeforeRaid)
                return { time: '7:00 PM EST' };
            if (isAfterRaid)
                return { time: '11:30 PM EST' };
        }
    }
    // Handle time ranges first (e.g., "10am - 3pm CST")
    const rangeMatch = title.match(TIME_RANGE_PATTERN);
    if (rangeMatch) {
        const startTime = rangeMatch[1].trim();
        const endTime = rangeMatch[2].trim();
        const timezone = rangeMatch[3];
        // Convert both times to EST
        const startEST = convertToEST(startTime, timezone);
        const endEST = convertToEST(endTime, timezone);
        // Return the start time for the main event time and full range
        return {
            time: startEST,
            timeRange: `${startEST} - ${endEST}`
        };
    }
    // Handle approximate times
    const approxMatch = title.match(APPROXIMATE_TIME);
    if (approxMatch) {
        const timeStr = approxMatch[0].replace('~', '').trim();
        const timezone = extractTimezone(title);
        return { time: convertToEST(timeStr, timezone) };
    }
    // Handle standard single times
    const timeMatch = title.match(TIME_PATTERN);
    if (timeMatch) {
        const timeStr = timeMatch[0].trim();
        const timezone = extractTimezone(title);
        return { time: convertToEST(timeStr, timezone) };
    }
    return { time: '8:00 PM EST' }; // Default time
}
/**
 * Intelligently parses dates with context awareness
 * @param title The thread title to parse
 * @param threadCreatedAt When the thread was created (optional)
 * @returns Array of parsed dates with context
 */
function parseDatesWithContext(title, threadCreatedAt) {
    const dates = [];
    const now = new Date();
    // Use thread creation date as reference, fallback to current date
    const referenceDate = threadCreatedAt || now;
    const referenceYear = referenceDate.getFullYear();
    const referenceMonth = referenceDate.getMonth();
    // Handle full date format (e.g., "June 15th")
    const fullDateMatch = title.match(FULL_DATE_PATTERN);
    if (fullDateMatch) {
        const dateStr = fullDateMatch[0];
        // Try current year first, then next year if date is in the past
        let date = new Date(`${dateStr} ${referenceYear}`);
        if (date < now && date.getMonth() < referenceMonth) {
            // If date is in the past relative to reference, try next year
            date = new Date(`${dateStr} ${referenceYear + 1}`);
        }
        if (!isNaN(date.getTime())) {
            dates.push(date);
        }
    }
    // Handle short date format (e.g., "5/11" or "11/5")
    const shortDateMatch = title.match(SHORT_DATE_PATTERN);
    if (shortDateMatch) {
        const dateStr = shortDateMatch[0];
        const parts = dateStr.split('/');
        if (parts.length >= 2) {
            const num1 = parseInt(parts[0]);
            const num2 = parseInt(parts[1]);
            const year = parts[2] ? parseInt(parts[2]) : referenceYear;
            // Intelligent parsing: determine if it's month/day or day/month
            let month, day;
            if (num1 <= 12 && num2 <= 31) {
                // Could be either format, need to be smart about it
                if (num1 <= 12 && num2 <= 12) {
                    // Both could be months, use context
                    const daysSinceReference = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysSinceReference < 7) {
                        // Recent thread, likely referring to near future
                        // Assume month/day format for dates in current/next month
                        if (num1 === referenceMonth + 1 || num1 === referenceMonth + 2) {
                            month = num1 - 1;
                            day = num2;
                        }
                        else if (num2 === referenceMonth + 1 || num2 === referenceMonth + 2) {
                            month = num2 - 1;
                            day = num1;
                        }
                        else {
                            // Default to month/day for US format
                            month = num1 - 1;
                            day = num2;
                        }
                    }
                    else {
                        // Default to month/day for US format
                        month = num1 - 1;
                        day = num2;
                    }
                }
                else if (num1 <= 12) {
                    // num1 is month, num2 is day
                    month = num1 - 1;
                    day = num2;
                }
                else {
                    // num1 is day, num2 is month
                    month = num2 - 1;
                    day = num1;
                }
            }
            else if (num1 <= 12) {
                // num1 is month, num2 is day
                month = num1 - 1;
                day = num2;
            }
            else {
                // num1 is day, num2 is month
                month = num2 - 1;
                day = num1;
            }
            // Create date and adjust year if needed
            let date = new Date(year, month, day);
            // If date is in the past relative to reference, try next year
            if (date < referenceDate && date.getMonth() < referenceMonth) {
                date = new Date(year + 1, month, day);
            }
            if (!isNaN(date.getTime())) {
                dates.push(date);
            }
        }
    }
    // Handle date with year format (e.g., "2024/3/22")
    const yearDateMatch = title.match(DATE_WITH_YEAR);
    if (yearDateMatch) {
        const dateStr = yearDateMatch[0];
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const day = parseInt(parts[2]);
            const date = new Date(year, month, day);
            if (!isNaN(date.getTime())) {
                dates.push(date);
            }
        }
    }
    return dates;
}
/**
 * Intelligently infers day of week from context
 * @param title The thread title to parse
 * @param threadCreatedAt When the thread was created (optional)
 * @returns The inferred day of week or null
 */
function inferDayFromContext(title, threadCreatedAt) {
    // First try to infer from explicit dates
    const dates = parseDatesWithContext(title, threadCreatedAt);
    if (dates.length > 0) {
        const dayIndex = dates[0].getDay();
        return DAYS_OF_WEEK[dayIndex];
    }
    // If no explicit date, try to infer from day names with context
    const dayMatch = DAYS_OF_WEEK.find(day => title.toLowerCase().includes(day.toLowerCase()));
    if (dayMatch) {
        return dayMatch;
    }
    // If still no day, try to infer from recurring patterns
    const pluralDayMatch = PLURAL_DAYS.find(day => title.toLowerCase().includes(day.toLowerCase()));
    if (pluralDayMatch) {
        // Extract the singular form
        const singularDay = pluralDayMatch.replace(/s$/, '');
        if (DAYS_OF_WEEK.includes(singularDay)) {
            return singularDay;
        }
    }
    return null;
}
/**
 * Finds the next occurrence of a day within a reasonable timeframe
 * @param dayName The day of the week
 * @param referenceDate Reference date to start from
 * @param maxWeeks Maximum weeks to look ahead (default: 8 weeks)
 * @returns The next occurrence date or null
 */
function findNextOccurrence(dayName, referenceDate, maxWeeks = 8) {
    const targetDayIndex = DAYS_OF_WEEK.indexOf(dayName);
    if (targetDayIndex === -1)
        return null;
    const maxDate = new Date(referenceDate);
    maxDate.setDate(maxDate.getDate() + (maxWeeks * 7));
    let nextDate = new Date(referenceDate);
    // Find the next occurrence of this day
    while (nextDate.getDay() !== targetDayIndex) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    // If we found a date within the reasonable timeframe, return it
    if (nextDate <= maxDate) {
        return nextDate;
    }
    return null;
}
/**
 * Extracts the event title from a thread title
 * @param title The thread title to parse
 * @returns The extracted event title
 */
function extractTitle(title) {
    // Remove date and time patterns to get the title
    let cleanTitle = title
        .replace(FULL_DATE_PATTERN, '')
        .replace(SHORT_DATE_PATTERN, '')
        .replace(DATE_WITH_YEAR, '')
        .replace(TIME_PATTERN, '')
        .replace(APPROXIMATE_TIME, '')
        .replace(/\s+/g, ' ')
        .trim();
    // Remove day names (both singular and plural)
    DAYS_OF_WEEK.forEach(day => {
        cleanTitle = cleanTitle.replace(new RegExp(day, 'gi'), '');
    });
    PLURAL_DAYS.forEach(day => {
        cleanTitle = cleanTitle.replace(new RegExp(day, 'gi'), '');
    });
    // Clean up common artifacts
    cleanTitle = cleanTitle
        .replace(/^\s*[-–—]\s*/, '') // Remove leading dashes
        .replace(/\s*[-–—]\s*$/, '') // Remove trailing dashes
        .replace(/^\s*\(\s*/, '') // Remove leading parentheses
        .replace(/\s*\)\s*$/, '') // Remove trailing parentheses
        .replace(/\s*\/\s*\d+\s*$/, '') // Remove trailing "/number" patterns
        .replace(/\s*,\s*$/, '') // Remove trailing commas
        .replace(/\s*@\s*$/, '') // Remove trailing @ symbols
        .replace(/\s*-\s*s\s*$/, '') // Remove trailing "- s" artifacts from plural days
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
    return cleanTitle;
}
/**
 * Parses an offnight thread title to extract event information with context awareness
 * @param title The thread title to parse
 * @param threadCreatedAt When the thread was created (optional)
 * @returns Parsed event information or null if invalid
 */
function parseOffnightTitle(title, threadCreatedAt) {
    try {
        // Extract and validate components
        const hasDay = DAYS_OF_WEEK.some(day => title.includes(day));
        const isRecurring = PLURAL_DAYS.some(day => title.includes(day));
        const hasDate = FULL_DATE_PATTERN.test(title) || SHORT_DATE_PATTERN.test(title) || DATE_WITH_YEAR.test(title);
        const hasTime = TIME_PATTERN.test(title) || APPROXIMATE_TIME.test(title);
        // Use context-aware day inference
        let inferredDay = !hasDay ? inferDayFromContext(title, threadCreatedAt) : null;
        let finalDay = hasDay ? extractDay(title) : inferredDay;
        // If plural day (recurring), always set finalDay to singular form
        if (isRecurring && !finalDay) {
            const pluralDayMatch = PLURAL_DAYS.find(day => title.toLowerCase().includes(day.toLowerCase()));
            if (pluralDayMatch) {
                const singularDay = pluralDayMatch.replace(/s$/, '');
                if (DAYS_OF_WEEK.includes(singularDay)) {
                    finalDay = singularDay;
                }
            }
        }
        // Parse date with context awareness first
        const dates = parseDatesWithContext(title, threadCreatedAt);
        let eventDate = dates[0];
        const now = new Date();
        // If we have a day but no specific date, find the next occurrence
        if (finalDay && !eventDate && !isRecurring) {
            const referenceDate = threadCreatedAt || now;
            const nextOccurrence = findNextOccurrence(finalDay, referenceDate);
            if (nextOccurrence) {
                eventDate = nextOccurrence;
            }
        }
        // If the event has a date and it's in the past, skip it (unless recurring)
        if (eventDate && eventDate < now && !isRecurring) {
            return null;
        }
        // Now parse time with the event date for intelligent raid time inference
        const { time, timeRange } = parseTime(title, eventDate);
        // RELAXED VALIDATION: For recurring events, allow if (finalDay && hasTime)
        if ((isRecurring && finalDay && hasTime) ||
            ((finalDay || isRecurring) && (hasDate || isRecurring || eventDate) && hasTime)) {
            // Ensure we have a valid date
            const finalDate = eventDate || (isRecurring ? now : null);
            if (!finalDate) {
                logger_1.logger.warn(`No valid date found for event: ${title}`);
                return null;
            }
            const event = {
                title: extractTitle(title),
                day: finalDay || undefined,
                date: finalDate,
                time: time,
                timeRange: timeRange,
                isRecurring: isRecurring,
                timezone: extractTimezone(title),
                threadCreatedAt: threadCreatedAt
            };
            return event;
        }
        return null;
    }
    catch (error) {
        logger_1.logger.error(`Error parsing offnight title "${title}": ${error instanceof Error ? error.message : error}`);
        return null;
    }
}
/**
 * Generates recurring events for the next 4 occurrences
 * @param event The base event to generate recurring events from
 * @returns Array of generated events
 */
function generateRecurringEvents(event) {
    if (!event.isRecurring)
        return [event];
    const events = [];
    const currentDate = new Date();
    // For recurring events, we need to find the next occurrence of the specified day
    let nextDate = new Date(currentDate);
    // If we have a specific day, find the next occurrence of that day
    if (event.day) {
        const targetDayIndex = DAYS_OF_WEEK.indexOf(event.day);
        if (targetDayIndex === -1) {
            logger_1.logger.warn(`Invalid day for recurring event: ${event.day}`);
            return [event];
        }
        // Find the next occurrence of this day
        while (nextDate.getDay() !== targetDayIndex) {
            nextDate.setDate(nextDate.getDate() + 1);
        }
    }
    else {
        // If no specific day, use the current date as starting point
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
 * Processes a list of thread titles to extract valid offnight events
 * @param threads Array of thread objects with name property
 * @returns Array of valid parsed events
 */
function processOffnightThreads(threads) {
    const validEvents = [];
    const currentDate = new Date();
    logger_1.logger.info(`Processing ${threads.length} offnight threads`);
    for (const thread of threads) {
        const parsedEvent = parseOffnightTitle(thread.name);
        if (!parsedEvent)
            continue;
        // Skip past events
        if (parsedEvent.date < currentDate && !parsedEvent.isRecurring) {
            logger_1.logger.info(`Skipping past event: ${thread.name}`);
            continue;
        }
        // Generate events (including recurring ones)
        const events = generateRecurringEvents(parsedEvent);
        // Add to valid events
        events.forEach(event => {
            if (event.date >= currentDate) {
                validEvents.push({
                    ...event,
                    originalThreadId: thread.id
                });
            }
        });
    }
    logger_1.logger.info(`Found ${validEvents.length} valid offnight events`);
    return validEvents;
}
/**
 * Formats a single offnight event into a string for file output
 * @param event The parsed offnight event
 */
function formatOffnightEvent(event) {
    // Use a modern date formatting approach
    const dateOptions = { weekday: 'long', month: 'numeric', day: 'numeric' };
    const dateStr = new Date(event.date).toLocaleDateString('en-US', dateOptions).replace(/,/g, '');
    let titlePart = event.title;
    if (event.isRecurring && event.threadCreator) {
        // Prevent double-appending "Hosted by"
        if (!titlePart.includes('Hosted by')) {
            titlePart = `${titlePart}. Hosted by ${event.threadCreator}`;
        }
    }
    // Format: "Sunday 6/22 10:30 AM EST. We're Definitely Not Planning Something Mischievous. Hosted by Xanax"
    return `${dateStr} ${event.time}. ${titlePart}`;
}
/**
 * Formats multiple offnight events to match the offnight.txt file format
 * @param events Array of parsed offnight events
 * @returns Formatted string for offnight.txt
 */
function formatOffnightEvents(events) {
    // Sort events by date
    const sortedEvents = events.sort((a, b) => a.date.getTime() - b.date.getTime());
    // Format each event and join with newlines
    return sortedEvents.map(event => formatOffnightEvent(event)).join('\n');
}
/**
 * Intelligently infers raid times based on the event date and relative timing
 * @param eventDate The date of the event
 * @param isBeforeRaid Whether this is a "before raid" event
 * @param isAfterRaid Whether this is an "after raid" event
 * @returns The inferred time for the event
 */
function inferRaidTime(eventDate, isBeforeRaid, isAfterRaid) {
    const dayName = DAYS_OF_WEEK[eventDate.getDay()];
    const raidInfo = RAID_SCHEDULE[dayName];
    if (!raidInfo) {
        // No scheduled raid on this day, use default times
        if (isBeforeRaid)
            return '7:00 PM EST';
        if (isAfterRaid)
            return '11:30 PM EST';
        return '8:00 PM EST';
    }
    if (isBeforeRaid) {
        // Before raid: 2 hours before raid start time
        // This gives 1 hour for the event + 1 hour for gathering
        const raidStart = raidInfo.start;
        const timeMatch = raidStart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*EST/);
        if (timeMatch) {
            let hour = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const period = timeMatch[3];
            // Convert to 24-hour format
            if (period === 'PM' && hour !== 12)
                hour += 12;
            if (period === 'AM' && hour === 12)
                hour = 0;
            // Subtract 2 hours
            hour -= 2;
            // Handle day wrap-around
            if (hour < 0)
                hour += 24;
            // Convert back to 12-hour format
            const newPeriod = hour >= 12 ? 'PM' : 'AM';
            if (hour > 12)
                hour -= 12;
            if (hour === 0)
                hour = 12;
            return `${hour}:${minutes.toString().padStart(2, '0')} ${newPeriod} EST`;
        }
        return '7:00 PM EST'; // Fallback
    }
    if (isAfterRaid) {
        // After raid: 1 hour after raid end time
        const raidEnd = raidInfo.end;
        const timeMatch = raidEnd.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*EST/);
        if (timeMatch) {
            let hour = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const period = timeMatch[3];
            // Convert to 24-hour format
            if (period === 'PM' && hour !== 12)
                hour += 12;
            if (period === 'AM' && hour === 12)
                hour = 0;
            // Add 1 hour
            hour += 1;
            // Handle day wrap-around
            if (hour >= 24)
                hour -= 24;
            // Convert back to 12-hour format
            const newPeriod = hour >= 12 ? 'PM' : 'AM';
            if (hour > 12)
                hour -= 12;
            if (hour === 0)
                hour = 12;
            return `${hour}:${minutes.toString().padStart(2, '0')} ${newPeriod} EST`;
        }
        return '11:30 PM EST'; // Fallback
    }
    return '8:00 PM EST'; // Default fallback
}
//# sourceMappingURL=offnightPatternMatcher.js.map