import { logger } from '../../utils/logger';

// Constants for pattern matching
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMEZONES = ['ET', 'EST', 'EDT', 'CT', 'CST', 'CDT', 'MT', 'MST', 'MDT', 'PT', 'PST', 'PDT'];

// Regular expressions for pattern matching
const TIME_PATTERN = /(\d{1,2}(?::\d{2})?)\s*(?:am|pm|AM|PM)\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)/i;
const DATE_PATTERN = /\d{1,2}\/\d{1,2}/;

/**
 * Parses a date from a raid schedule line (format: M/D)
 * @param line The raid schedule line
 * @returns Date object or null if date cannot be parsed
 */
export function parseDateFromLine(line: string): Date | null {
  const dateMatch = line.match(/(\d{1,2})\/(\d{1,2})/);
  if (!dateMatch) {
    return null;
  }
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  
  // Get current date
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed
  
  // Determine year: if month is significantly in the past, assume next year
  // Otherwise assume current year
  let year = currentYear;
  if (month < currentMonth - 1) {
    // If the month is more than 1 month in the past, assume next year
    year = currentYear + 1;
  }
  
  const date = new Date(year, month - 1, day);
  
  // If the date is more than 3 months in the past, assume it's next year
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  if (date < threeMonthsAgo) {
    date.setFullYear(currentYear + 1);
  }
  
  return date;
}

/**
 * Sorts raid schedule lines by date and groups them by week with blank lines between weeks
 * @param lines Array of raid schedule lines (may include blank lines)
 * @returns Sorted array with blank lines between weeks
 */
export function sortRaidScheduleByDate(lines: string[]): string[] {
  // Separate blank lines from raid entries
  const raidEntries: { line: string; date: Date }[] = [];
  const blankLines: number[] = []; // Track positions of blank lines
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line === '') {
      blankLines.push(i);
    } else {
      // Ensure • is converted to - for consistency
      if (line.startsWith('•')) {
        line = '-' + line.substring(1).trim();
      }
      const date = parseDateFromLine(line);
      if (date) {
        raidEntries.push({ line, date });
      }
    }
  }
  
  // Sort raid entries by date
  raidEntries.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Group by week and add blank lines between weeks
  const sortedLines: string[] = [];
  let lastWeekStart: Date | null = null;
  
  for (const entry of raidEntries) {
    // Determine week start (Monday of the week)
    const weekStart = new Date(entry.date);
    const dayOfWeek = weekStart.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    weekStart.setDate(weekStart.getDate() - daysToMonday);
    weekStart.setHours(0, 0, 0, 0);
    
    // Add blank line if this is a new week
    if (lastWeekStart !== null && weekStart.getTime() !== lastWeekStart.getTime()) {
      sortedLines.push('');
    }
    
    sortedLines.push(entry.line);
    lastWeekStart = weekStart;
  }
  
  return sortedLines;
}

/**
 * Validates a timezone format in a raid schedule line
 * @param timezone The timezone string to validate
 * @returns boolean indicating if the timezone is valid
 */
function isValidTimezone(timezone: string): boolean {
  return TIMEZONES.some(tz => tz.toLowerCase() === timezone.toLowerCase());
}

/**
 * Processes a message to extract valid raid schedule lines
 * @param message The message content to process
 * @returns Array of valid raid schedule lines (preserves blank lines for week separation)
 */
export function processRaidScheduleMessage(message: string): string[] {
  // First try splitting by newlines
  let lines = message.split('\n');
  
  // If we only got one line but it contains multiple dash-separated items, 
  // split on the pattern " - " (space dash space) which is common in Discord messages
  if (lines.length === 1 && lines[0].includes(' - ')) {
    lines = lines[0].split(' - ');
  }
  
  // Process each line to extract valid raid schedule entries
  const validLines: string[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip markdown headers (e.g., ## February)
    if (trimmedLine.startsWith('##')) {
      continue;
    }
    
    // Preserve empty lines to maintain week separation
    if (!trimmedLine) {
      validLines.push('');
      continue;
    }
    
    // Check if line starts with a list marker (- or •) or if it looks like a raid schedule entry
    const isListLine = trimmedLine.startsWith('-') || trimmedLine.startsWith('•');
    const looksLikeRaidEntry = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(trimmedLine);
    
    if (isListLine || looksLikeRaidEntry) {
      // Normalize whitespace but preserve the original dash prefix
      let processedLine = trimmedLine
        .replace(/\s+/g, ' ') // collapse multiple spaces
        .trim();
      
      // If it starts with •, convert to - for consistency
      if (processedLine.startsWith('•')) {
        processedLine = '-' + processedLine.substring(1).trim();
      }
      
      // Ensure it starts with - if it's a list line
      if (isListLine && !processedLine.startsWith('-')) {
        processedLine = '- ' + processedLine;
      }
      
      // Skip if empty after processing
      if (!processedLine || processedLine === '-') continue;
      
      // Validate the line (validate without the dash prefix)
      const lineToValidate = processedLine.startsWith('-') 
        ? processedLine.substring(1).trim() 
        : processedLine;
      
      if (isValidRaidScheduleLine(lineToValidate)) {
        validLines.push(processedLine);
      }
    }
  }
  
  return validLines;
}

/**
 * Validates if a line is a valid raid schedule entry
 * @param line The line to validate
 * @returns boolean indicating if the line is valid
 */
function isValidRaidScheduleLine(line: string): boolean {
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
    logger.debug(`Warning: Line missing day of week: '${line}'`);
  }

  return true;
}

export interface ParsedScheduleLine {
  date: Date | null;
  targets: string[];
}

/**
 * Parses a single raid schedule line into date and target tokens (zones/bosses after the colon).
 * Handles lines with or without leading "- " or "• ".
 * @param line The raid schedule line (e.g. "Monday, 2/16, 9pm ET: Vex Thal + Aten Ha Ra")
 * @returns Object with date (or null) and targets array (trimmed, after colon, split by "+")
 */
export function parseScheduleLine(line: string): ParsedScheduleLine {
  const trimmed = line.trim().replace(/^[-•]\s*/, '');
  const date = parseDateFromLine(trimmed);
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1 || colonIdx === trimmed.length - 1) {
    return { date, targets: [] };
  }
  const afterColon = trimmed.slice(colonIdx + 1).trim();
  const targets = afterColon
    .split(/\s*\+\s*/)
    .map(t => t.trim())
    .filter(Boolean);
  return { date, targets };
} 