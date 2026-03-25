/**
 * Parses Discord messages to extract boss kill information
 */
import { Message, TextChannel } from 'discord.js';
import { fromZonedTime } from 'date-fns-tz';
import { logger } from '../../utils/logger';
import { ParsedKillMessage } from './types';

// Discord timestamp extraction: <t:unix_timestamp:format>
const DISCORD_TIMESTAMP_REGEX = /<t:(\d+):[RFdDfTt]>/;

// Boss Tracker bracket long-date: [Saturday, February 14, 2026 11:26 PM] — Eastern (America/New_York, DST-aware)
const BRACKET_LONG_DATE_REGEX = /^\[\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,\s*(\w+)\s+(\d{1,2})\s*,\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\s*\]/i;

// Boss name can contain ` or Discord's ˋ (U+02CB) / curly quotes; include all so "Vyzh`dra" / "Vyzhˋdra" match
const BOSS_NAME_CHARS = '[\\w\\s`\u02CB\u2018\u2019]';
// Optional parenthetical (Note); allow fullwidth closing paren U+FF09 so we capture full "Name (Note)" from Discord
const OPTIONAL_NOTE_Paren = '(?:\\([^)\uFF09]*[)\uFF09]\\s*)?';

// Boss tracker standard kill format (with "was killed")
const BOSS_TRACKER_KILL_REGEX = new RegExp(`.*?(${BOSS_NAME_CHARS}+${OPTIONAL_NOTE_Paren})\\s+was killed in (.+?)!`, 'i');

// Boss tracker "has been slain" format (names e.g. Vyzh`dra the Cursed)
const BOSS_TRACKER_SLAIN_REGEX = new RegExp(`.*?(${BOSS_NAME_CHARS}+${OPTIONAL_NOTE_Paren})\\s+has been slain!`, 'i');

// Boss Tracker APP (bot): one message per kill. Image format:
//   [Saturday, February 14, 2026 11:01 PM] Boss Name (details) has been slain!
// Full day/month, 12h AM/PM, no seconds → parsed by BOSS_TRACKER_SLAIN_REGEX below.
// Direct variant with " in Location!": "[<t:timestamp:F>] BossName in Location!" or "BossName in Location!"
const BOSS_TRACKER_DIRECT_REGEX = new RegExp('(?:\\[<t:\\d+:[RFdDfTt]>\\]\\s*)?(' + BOSS_NAME_CHARS + '+' + OPTIONAL_NOTE_Paren + ')\\s+in\\s+(.+?)!', 'i');

// Boss tracker lockout format
const BOSS_TRACKER_LOCKOUT_REGEX = new RegExp(`.*?(${BOSS_NAME_CHARS}+${OPTIONAL_NOTE_Paren})\\s+lockout detected!`, 'i');

// Simple line format: human user multi-line posts (e.g. Velde/Wool).
// Image reference: one message with multiple lines, each line:
//   [Sun Feb 15 13:56:04 2026] Lady Vox in Permafrost Caverns
//   [Sun Feb 15 14:49:52 2026] Lord Nagafen in Nagafen's Lair
//   (pacific time)
// No exclamation; timestamp is plain text or Discord <t:unix:F>. Timezone from "(pacific time)" in message or author.
const SIMPLE_LINE_REGEX = /^\[([^\]]+)\]\s+(.+?)\s+in\s+(.+)$/;
// Plain text timestamp inside brackets: "Sun Feb 15 13:56:04 2026" (abbrev day/month, 24h with seconds)
const SIMPLE_TIMESTAMP_REGEX = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})$/i;

// Manual format variations (more flexible)
const MANUAL_KILL_REGEXES = [
  new RegExp(`.*?(${BOSS_NAME_CHARS}+${OPTIONAL_NOTE_Paren})\\s+was killed in (.+?)[!.]`, 'i'),
  new RegExp(`.*?killed\\s+(${BOSS_NAME_CHARS}+${OPTIONAL_NOTE_Paren})\\s+in\\s+(.+?)[!.]`, 'i'),
  new RegExp(`.*?(${BOSS_NAME_CHARS}+${OPTIONAL_NOTE_Paren})\\s+killed\\s+in\\s+(.+?)[!.]`, 'i'),
];

// Manual kill format with date/time/timezone
// Matches: "Tuesday Feb 10 11:36am Cst, Royal Scribe Kaavin" or "Tues Feb 10 12:51 pm cst, Faydedar"
// Pattern: [Day] Month Day Time Timezone, BossName
// Handles: "11:36am", "12:51 pm", "1:07pm" (with or without space between time and am/pm)
// Timezone: 2-4 letter abbreviations (ET, CT, PT, EST, CST, PST, etc.)
const MANUAL_DATETIME_REGEX = /(?:Mon|Monday|Tue|Tues|Tuesday|Wed|Wednesday|Thu|Thur|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(am|pm)\s*([a-z]{2,4})\s*,\s*(.+)/i;

// Flexible format: "BossName - Date Time [ish] [Timezone]"
// Matches: "Lodi - 9pm ish CST" or "Naggy - Jan 8 12am ish" or "Scribe icewell - Jan 8, 1230 ish"
// Pattern: BossName - [Month Day] Time [ish] [Timezone]
// Handles: time with/without minutes, 12-hour and 24-hour formats, optional "ish", optional timezone
const FLEXIBLE_DATETIME_REGEX = /^([^-]+?)\s*-\s*(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,\s*)?\s*)?(\d{1,4})(?::(\d{2}))?\s*(am|pm|ish)?(?:\s+ish)?\s*(?:([a-z]{2,4})\s*)?/i;

// Author-based timezone for respawn: assume these users post in CST or PST (match author name/displayName, case-insensitive)
const CST_POSTER_SUBSTRINGS = ['velde', 'wool', 'cukazi', 'barakkas'];
const PST_POSTER_SUBSTRINGS = ['synth', 'pacific'];
// UTC offsets in hours (CST=-6, PST=-8, EST=-5)
const CST_OFFSET_HOURS = -6;
const PST_OFFSET_HOURS = -8;
const EST_OFFSET_HOURS = -5; // legacy; bracket long-date uses America/New_York (DST-aware) below
const EASTERN_TZ = 'America/New_York';

// When we only see a continuation line "Note in Location) has been slain!", map note → boss name (Ssraeshza Temple)
const SSRAESHZA_NOTE_TO_BOSS: Record<string, string> = {
  'Cursed 1': 'a glyph covered serpent',
  'Cursed 2': 'Vyzh`dra the Exiled',
  'Cursed 3': 'Vyzh`dra the Cursed',
  'Exiled': 'Vyzh`dra the Exiled',
  'Exiled 1': 'a glyph covered serpent',
  'Exiled 2': 'Vyzh`dra the Exiled',
  'Exiled 3': 'Vyzh`dra the Cursed',
  'Rhag 1': 'Rhag`Zhezum',
  'Rhag 2': 'Rhag`Mozdezh',
  'Rhag 3': 'Arch Lich Rhag`Zadune',
};

import { expandBossAbbreviation } from './bossAbbreviations';

export class MessageParser {
  /**
   * Extract Unix timestamp from Discord timestamp format
   */
  private extractDiscordTimestamp(content: string): number | null {
    const match = content.match(DISCORD_TIMESTAMP_REGEX);
    if (match && match[1]) {
      const unixTimestamp = parseInt(match[1], 10);
      if (!isNaN(unixTimestamp)) {
        logger.debug(`Extracted Discord timestamp: <t:${unixTimestamp}:*> -> ${new Date(unixTimestamp * 1000).toISOString()}`);
        return unixTimestamp;
      }
    }
    return null;
  }

  /**
   * Parse Boss Tracker bracket long-date (Eastern, DST-aware): "[Saturday, February 14, 2026 11:26 PM]"
   * Returns UTC Date or null. Used when message has no <t:unix:F> so we use content timestamp.
   */
  private parseBracketLongDate(content: string): Date | null {
    const match = content.match(BRACKET_LONG_DATE_REGEX);
    if (!match || !match[1]) return null;
    const monthNames: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    const month = monthNames[match[1].toLowerCase().substring(0, match[1].length)];
    if (month === undefined) return null;
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    let hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const ampm = (match[6] || '').toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    else if (ampm === 'AM' && hour === 12) hour = 0;
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
    const date = fromZonedTime(dateStr, EASTERN_TZ);
    if (isNaN(date.getTime())) return null;
    logger.debug(`Parsed bracket long-date (Eastern): ${date.toISOString()}`);
    return date;
  }

  /**
   * Parse manual datetime format with timezone
   * Examples:
   * - "Tuesday Feb 10 11:36am Cst, Royal Scribe Kaavin"
   * - "Tues Feb 10 12:51 pm cst, Faydedar"
   * - "Tues Feb 10 1:07pm cst, Talendor"
   */
  private parseManualDateTime(content: string): { bossName: string; killTime: Date; location?: string; note?: string } | null {
    const match = content.match(MANUAL_DATETIME_REGEX);
    if (!match) {
      return null;
    }

    try {
      // Extract components from regex match
      const monthAbbr = match[1].toLowerCase().substring(0, 3); // "feb", "jan", etc.
      const day = parseInt(match[2], 10);
      const hour12 = parseInt(match[3], 10);
      const minute = parseInt(match[4], 10);
      const ampm = match[5].toLowerCase();
      const timezoneAbbr = match[6].toLowerCase();
      const bossNameWithNote = match[7].trim();

      // Convert 12-hour to 24-hour format
      let hour24 = hour12;
      if (ampm === 'pm' && hour24 !== 12) {
        hour24 += 12;
      } else if (ampm === 'am' && hour24 === 12) {
        hour24 = 0;
      }

      // Map month abbreviations to numbers (0-11)
      const monthMap: { [key: string]: number } = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
        'may': 4, 'jun': 5, 'jul': 6, 'aug': 7,
        'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
      };
      const month = monthMap[monthAbbr];
      if (month === undefined) {
        logger.debug(`Invalid month abbreviation: ${monthAbbr}`);
        return null;
      }

      // Map timezone abbreviations to UTC offsets (in hours)
      // Common US timezones (3-letter and 2-letter abbreviations)
      // Note: ET/CT/PT are ambiguous (could be standard or daylight time)
      // We'll use standard time offsets as defaults, but users should specify EST/CST/PST for precision
      const timezoneMap: { [key: string]: number } = {
        // 3-letter standard time
        'est': -5, 'cst': -6, 'mst': -7, 'pst': -8, 'akst': -9, 'hst': -10,
        // 3-letter daylight time
        'edt': -4, 'cdt': -5, 'mdt': -6, 'pdt': -7, 'akdt': -8,
        // 2-letter abbreviations (default to standard time)
        'et': -5, 'ct': -6, 'mt': -7, 'pt': -8, 'ak': -9, 'ht': -10
      };
      const utcOffset = timezoneMap[timezoneAbbr];
      if (utcOffset === undefined) {
        logger.debug(`Unknown timezone abbreviation: ${timezoneAbbr}, defaulting to UTC`);
        // Default to UTC if unknown
        const killTime = new Date(Date.UTC(new Date().getFullYear(), month, day, hour24, minute));
        const parsed = this.extractNoteFromBossName(bossNameWithNote);
        return {
          bossName: parsed.name,
          killTime: killTime,
          note: parsed.note,
        };
      }

      // Create date in the specified timezone, then convert to UTC
      // UTC offset is negative (e.g., CST = -6), meaning CST is 6 hours behind UTC
      // Example: 12:51 PM CST (UTC-6) = 18:51 UTC (12:51 + 6 hours)
      const currentYear = new Date().getFullYear();
      
      // Create a date representing the local time in the specified timezone
      // Then convert to UTC by subtracting the offset
      // Formula: UTC = localTime - offset
      // For CST (offset = -6): UTC = 12:51 - (-6) = 12:51 + 6 = 18:51 ✓
      const utcDate = new Date(Date.UTC(currentYear, month, day, hour24, minute, 0));
      // Subtract the offset (which is negative, so this effectively adds hours)
      const killTime = new Date(utcDate.getTime() - (utcOffset * 60 * 60 * 1000));

      // Extract boss name and note
      const parsed = this.extractNoteFromBossName(bossNameWithNote);

      logger.debug(`Parsed manual datetime: ${bossNameWithNote} -> ${killTime.toISOString()} (timezone: ${timezoneAbbr}, UTC offset: ${utcOffset})`);

      return {
        bossName: parsed.name,
        killTime: killTime,
        note: parsed.note,
      };
    } catch (error) {
      logger.debug(`Error parsing manual datetime format: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Parse boss name, location, and note from message content
   * Notes can appear in formats like:
   * - "Boss Name (North) was killed..."
   * - "Boss Name North was killed..."
   */
  private parseBossName(content: string): { bossName: string; location?: string; note?: string } | null {
    // Try "has been slain" before "Boss in Location" so "Name (Note in Location) has been slain!" is not split on " in "
    if (content.includes('has been slain')) {
      const match = content.match(BOSS_TRACKER_SLAIN_REGEX);
      if (match && match[1]) {
        const bossNameWithNote = match[1].trim();
        const parsed = this.extractNoteFromBossName(bossNameWithNote);
        const locationMatch = content.match(/(?:in|at)\s+([^!]+?)\s+has been slain!/i);
        const location = locationMatch ? locationMatch[1].trim() : undefined;
        return {
          bossName: parsed.name,
          location,
          note: parsed.note,
        };
      }
    }

    // Try "was killed in" before generic "Boss in Location!" so "Name (Note in Location) was killed in Location!" is not split on first " in "
    if (content.includes('was killed in')) {
      const match = content.match(BOSS_TRACKER_KILL_REGEX);
      if (match && match[1] && match[2]) {
        const bossNameWithNote = match[1].trim();
        const parsed = this.extractNoteFromBossName(bossNameWithNote);
        return {
          bossName: parsed.name,
          location: match[2].trim(),
          note: parsed.note,
        };
      }
    }

    // Line is a continuation fragment "Note in Location) has been slain!" — resolve note to boss so we still record the kill
    const continuationMatch = content.trim().match(/^(.+?)\s+in\s+(.+?)\)\s*has been slain!\s*$/i);
    if (continuationMatch) {
      const notePart = continuationMatch[1].trim();
      const locationPart = continuationMatch[2].trim();
      const bossName = SSRAESHZA_NOTE_TO_BOSS[notePart] ?? SSRAESHZA_NOTE_TO_BOSS[notePart.replace(/\s+/g, ' ')];
      if (bossName) {
        return { bossName, location: locationPart, note: notePart };
      }
      return null; // unknown note, skip so we don't record e.g. "Cursed 3" as boss name
    }

    // Try boss tracker direct format (from Boss Tracker APP bot): "[<t:timestamp:F>] BossName in Location!"
    let match = content.match(BOSS_TRACKER_DIRECT_REGEX);
    if (match && match[1] && match[2]) {
      const bossNameWithNote = match[1].trim();
      const parsed = this.extractNoteFromBossName(bossNameWithNote);
      return {
        bossName: parsed.name,
        location: match[2].trim(),
        note: parsed.note,
      };
    }

    match = content.match(BOSS_TRACKER_LOCKOUT_REGEX);
    if (match && match[1]) {
      const bossNameWithNote = match[1].trim();
      const parsed = this.extractNoteFromBossName(bossNameWithNote);
      return {
        bossName: parsed.name,
        location: 'Lockouts',
        note: parsed.note,
      };
    }

    // Try manual formats
    for (const regex of MANUAL_KILL_REGEXES) {
      match = content.match(regex);
      if (match && match[1]) {
        const bossNameWithNote = match[1].trim();
        const parsed = this.extractNoteFromBossName(bossNameWithNote);
        return {
          bossName: parsed.name,
          location: match[2]?.trim(),
          note: parsed.note,
        };
      }
    }

    return null;
  }

  /**
   * Extract note from boss name string
   * Handles formats like:
   * - "Thall Va Xakra (North)"
   * - "Thall Va Xakra North"
   * - "Kaas Thox Xi Aten Ha Ra (South)"
   */
  private extractNoteFromBossName(bossNameWithNote: string): { name: string; note?: string } {
    // Try parentheses format: "Name (Note)" or "Name (Nickname in Location)"; allow ASCII or fullwidth parens (U+FF08/FF09)
    const parenMatch = bossNameWithNote.match(/^(.+?)\s*[(\uFF08]([^)\uFF09]+)[)\uFF09]\s*$/);
    if (parenMatch) {
      let note = parenMatch[2].trim();
      // Store only the nickname for keying: "Cursed 3 in Ssraeshza Temple" -> "Cursed 3" so it matches Discord choice
      const inLocation = note.match(/^(.+?)\s+in\s+(.+)$/i);
      if (inLocation) note = inLocation[1].trim();
      return {
        name: parenMatch[1].trim(),
        note: note || undefined,
      };
    }

    // Try last word as note (common patterns: North, South, etc.)
    const words = bossNameWithNote.trim().split(/\s+/);
    if (words.length > 1) {
      const lastWord = words[words.length - 1];
      const commonNotes = ['north', 'south', 'east', 'west', 'n', 's', 'e', 'w'];
      
      if (commonNotes.includes(lastWord.toLowerCase())) {
        return {
          name: words.slice(0, -1).join(' '),
          note: lastWord,
        };
      }
      
      // Check for patterns like "F1 North", "F2 South", etc.
      const notePattern = /^(F\d+\s+)?(North|South|East|West|N|S|E|W)$/i;
      if (notePattern.test(lastWord)) {
        return {
          name: words.slice(0, -1).join(' '),
          note: lastWord,
        };
      }
    }

    // No note found
    return { name: bossNameWithNote.trim() };
  }

  /**
   * Get UTC offset (hours) for message author for respawn detection.
   * Velde/Cukazi = CST (-6), Synth = PST (-8), else EST (-5).
   * If message content contains "(pacific time)" we use PST for that message.
   */
  private getAuthorTimezoneOffset(message: Message): number {
    const content = (message.content ?? '').toLowerCase();
    if (content.includes('(pacific time)') || content.includes('pacific time)')) {
      return PST_OFFSET_HOURS;
    }
    const name = (message.author.username ?? '').toLowerCase();
    const display = (message.author.displayName ?? '').toLowerCase();
    const combined = `${name} ${display}`;
    if (CST_POSTER_SUBSTRINGS.some((s) => combined.includes(s))) {
      return CST_OFFSET_HOURS;
    }
    if (PST_POSTER_SUBSTRINGS.some((s) => combined.includes(s))) {
      return PST_OFFSET_HOURS;
    }
    return EST_OFFSET_HOURS;
  }

  /**
   * Parse simple line format: [Sun Feb 15 13:56:04 2026] Lady Vox in Permafrost Caverns
   * Uses author-based timezone (Velde/Cukazi=CST, Synth=PST, else EST) for respawn detection.
   */
  private parseSimpleLine(line: string, message: Message): ParsedKillMessage | null {
    const content = line.trim();
    if (!content || content.startsWith('(')) {
      return null;
    }
    // Don't treat Boss Tracker "has been slain" lines as simple "Boss in Location" (they'd get wrong split)
    if (content.includes('has been slain')) {
      return null;
    }
    const match = content.match(SIMPLE_LINE_REGEX);
    if (!match || !match[1] || !match[2] || !match[3]) {
      return null;
    }
    const timestampStr = match[1].trim();
    const bossNameWithNote = match[2].trim();
    const location = match[3].trim().replace(/\s*\([^)]*time\)\s*$/i, '').trim();

    let killTime: Date;

    // Discord timestamp inside brackets: [<t:unix:F>] Boss in Location (e.g. from Discord's date picker)
    const discordTsMatch = timestampStr.match(DISCORD_TIMESTAMP_REGEX);
    if (discordTsMatch && discordTsMatch[1]) {
      const unixSec = parseInt(discordTsMatch[1], 10);
      if (!isNaN(unixSec)) {
        killTime = new Date(unixSec * 1000);
      } else {
        return null;
      }
    } else {
      // Plain text timestamp: [Sun Feb 15 13:56:04 2026]
      const tsMatch = timestampStr.match(SIMPLE_TIMESTAMP_REGEX);
      if (!tsMatch) {
        // Fallback: still record the kill using message time so we don't drop it; log for debugging
        logger.info(
          `Simple line timestamp not parsed (using message time): bracket content="${timestampStr.substring(0, 80)}${timestampStr.length > 80 ? '...' : ''}" boss="${bossNameWithNote}"`
        );
        killTime = new Date(message.createdTimestamp);
      } else {
        const monthMap: { [key: string]: number } = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        };
        const month = monthMap[tsMatch[1].toLowerCase().substring(0, 3)];
        if (month === undefined) {
          logger.info(`Simple line invalid month in bracket: "${timestampStr.substring(0, 60)}"`);
          killTime = new Date(message.createdTimestamp);
        } else {
          const day = parseInt(tsMatch[2], 10);
          const hour = parseInt(tsMatch[3], 10);
          const minute = parseInt(tsMatch[4], 10);
          const second = parseInt(tsMatch[5], 10);
          const year = parseInt(tsMatch[6], 10);

          const offsetHours = this.getAuthorTimezoneOffset(message);
          const utcMs =
            Date.UTC(year, month, day, hour, minute, second) - offsetHours * 60 * 60 * 1000;
          killTime = new Date(utcMs);
        }
      }
    }

    const parsed = this.extractNoteFromBossName(bossNameWithNote);
    logger.debug(
      `Parsed simple line: ${parsed.name} in ${location} at ${killTime.toISOString()}`
    );
    return {
      bossName: parsed.name,
      location,
      killTime,
      source: 'manual',
      note: parsed.note,
    };
  }

  /**
   * Parse flexible datetime format
   * Examples:
   * - "Lodi - 9pm ish CST"
   * - "Naggy - Jan 8 12am ish"
   * - "Scribe icewell - Jan 8, 1230 ish"
   */
  private parseFlexibleDateTime(content: string, messageTimestamp: number): { bossName: string; killTime: Date; location?: string; note?: string } | null {
    const match = content.match(FLEXIBLE_DATETIME_REGEX);
    if (!match) {
      return null;
    }

    try {
      const bossNameRaw = match[1].trim();
      const monthAbbr = match[2]?.toLowerCase().substring(0, 3);
      const day = match[3] ? parseInt(match[3], 10) : null;
      const hourOrTime = parseInt(match[4], 10);
      const minute = match[5] ? parseInt(match[5], 10) : 0;
      const ampmOrIsh = match[6]?.toLowerCase();
      const timezoneAbbr = match[7]?.toLowerCase();

      // Determine if we have a date or just time
      const hasDate = monthAbbr && day !== null;
      const hasAmPm = ampmOrIsh === 'am' || ampmOrIsh === 'pm';
      const hasIsh = ampmOrIsh === 'ish' || content.toLowerCase().includes('ish');

      // Expand boss name abbreviation
      let bossName = expandBossAbbreviation(bossNameRaw);
      
      // Extract location/note from boss name (e.g., "Scribe icewell" -> "Royal Scribe Kaavin" with location "Icewell Keep")
      const bossParts = bossNameRaw.split(/\s+/);
      if (bossParts.length > 1) {
        const lastPart = bossParts[bossParts.length - 1].toLowerCase();
        // Check if last part is a location hint
        if (lastPart === 'icewell') {
          bossName = 'Royal Scribe Kaavin';
          // Note: We could add location here, but it's optional
        }
      }

      // Parse time
      let hour24: number;
      let parsedMinute = minute;

      if (hasAmPm) {
        // 12-hour format: "9pm", "12am"
        hour24 = hourOrTime;
        if (ampmOrIsh === 'pm' && hour24 !== 12) {
          hour24 += 12;
        } else if (ampmOrIsh === 'am' && hour24 === 12) {
          hour24 = 0;
        }
      } else if (hourOrTime >= 100 && hourOrTime < 2400) {
        // 24-hour format: "1230" = 12:30, "9" = 9:00
        if (hourOrTime >= 1000) {
          // 4-digit: "1230"
          hour24 = Math.floor(hourOrTime / 100);
          parsedMinute = hourOrTime % 100;
        } else if (hourOrTime >= 100) {
          // 3-digit: "930" = 9:30
          hour24 = Math.floor(hourOrTime / 100);
          parsedMinute = hourOrTime % 100;
        } else {
          // 1-2 digit: assume hour only, default to PM
          hour24 = hourOrTime;
          if (hour24 < 12) {
            hour24 += 12; // Default to PM for times like "9"
          }
        }
      } else {
        // Single or double digit without am/pm: assume hour, default to PM
        hour24 = hourOrTime;
        if (hour24 < 12) {
          hour24 += 12; // Default to PM for times like "9"
        }
      }

      // Get date (use message date if not specified)
      const now = new Date(messageTimestamp);
      let year = now.getFullYear();
      let month = now.getMonth();
      let dayNum = now.getDate();

      if (hasDate) {
        const monthMap: { [key: string]: number } = {
          'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
          'may': 4, 'jun': 5, 'jul': 6, 'aug': 7,
          'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        const parsedMonth = monthMap[monthAbbr!];
        if (parsedMonth !== undefined) {
          month = parsedMonth;
          dayNum = day!;
        }
      }

      // Handle timezone (if missing, we'll use message timestamp as fallback)
      let utcOffset: number | null = null;
      if (timezoneAbbr) {
        const timezoneMap: { [key: string]: number } = {
          'est': -5, 'cst': -6, 'mst': -7, 'pst': -8, 'akst': -9, 'hst': -10,
          'edt': -4, 'cdt': -5, 'mdt': -6, 'pdt': -7, 'akdt': -8,
          'et': -5, 'ct': -6, 'mt': -7, 'pt': -8, 'ak': -9, 'ht': -10
        };
        utcOffset = timezoneMap[timezoneAbbr] ?? null;
      }

      // Create kill time
      let killTime: Date;
      if (utcOffset !== null && hasDate) {
        // We have both date and timezone, use them
        const utcDate = new Date(Date.UTC(year, month, dayNum, hour24, parsedMinute, 0));
        killTime = new Date(utcDate.getTime() - (utcOffset * 60 * 60 * 1000));
      } else if (hasDate) {
        // We have date but no timezone - use message timestamp's timezone context
        // Create date in local timezone, then adjust
        const localDate = new Date(year, month, dayNum, hour24, parsedMinute, 0);
        killTime = localDate;
        logger.debug(`No timezone specified, using local timezone for date: ${killTime.toISOString()}`);
      } else {
        // No date specified - use message timestamp but adjust time
        const msgDate = new Date(messageTimestamp);
        killTime = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate(), hour24, parsedMinute, 0);
        if (utcOffset !== null) {
          // Adjust for timezone
          const utcDate = new Date(Date.UTC(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate(), hour24, parsedMinute, 0));
          killTime = new Date(utcDate.getTime() - (utcOffset * 60 * 60 * 1000));
        }
        logger.debug(`No date specified, using message date with parsed time: ${killTime.toISOString()}`);
      }

      logger.debug(`Parsed flexible datetime: ${bossNameRaw} -> ${bossName} at ${killTime.toISOString()} (timezone: ${timezoneAbbr || 'none'}, hasDate: ${hasDate}, hasIsh: ${hasIsh})`);

      return {
        bossName,
        killTime,
        note: hasIsh ? 'ish' : undefined, // Store "ish" as note for reference
      };
    } catch (error) {
      logger.debug(`Error parsing flexible datetime format: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Parse a single line of content for kill information
   * Used internally to handle multi-line messages
   */
  private parseKillLine(line: string, message: Message): ParsedKillMessage | null {
    const content = line.trim();
    if (!content) {
      return null;
    }

    const messageTimestamp = message.createdTimestamp;

    // Simple format first: [Sun Feb 15 13:56:04 2026] Lady Vox in Permafrost Caverns (author TZ: Velde/Cukazi=CST, Synth=PST)
    const simpleParsed = this.parseSimpleLine(content, message);
    if (simpleParsed) {
      return simpleParsed;
    }

    // Then check for flexible format (e.g., "Lodi - 9pm ish CST")
    const flexibleDateTime = this.parseFlexibleDateTime(content, messageTimestamp);
    if (flexibleDateTime) {
      logger.debug(`Using flexible datetime format: ${flexibleDateTime.killTime.toISOString()}`);
      const result: ParsedKillMessage = {
        bossName: flexibleDateTime.bossName,
        location: flexibleDateTime.location,
        killTime: flexibleDateTime.killTime,
        source: 'manual',
        note: flexibleDateTime.note,
      };
      const noteStr = result.note ? `, note: ${result.note}` : '';
      logger.debug(`Extracted boss: ${result.bossName}${noteStr}, timestamp: ${result.killTime.toISOString()}, source: ${result.source}`);
      return result;
    }

    // Then check for manual datetime format (e.g., "Tues Feb 10 12:51 pm cst, Faydedar")
    const manualDateTime = this.parseManualDateTime(content);
    if (manualDateTime) {
      logger.debug(`Using manual datetime format: ${manualDateTime.killTime.toISOString()}`);
      const result: ParsedKillMessage = {
        bossName: manualDateTime.bossName,
        location: manualDateTime.location,
        killTime: manualDateTime.killTime,
        source: 'manual',
        note: manualDateTime.note,
      };
      const noteStr = result.note ? `, note: ${result.note}` : '';
      logger.debug(`Extracted boss: ${result.bossName}${noteStr}, timestamp: ${result.killTime.toISOString()}, source: ${result.source}`);
      return result;
    }

    // Extract boss name and location (for other formats)
    const bossInfo = this.parseBossName(content);
    if (!bossInfo) {
      return null;
    }

    // Extract timestamp: prefer Discord <t:unix:F>, then bracket long-date [Saturday, February 14, 2026 11:26 PM] (EST), then message.createdTimestamp
    let killTime: Date;
    let source: 'boss_tracker' | 'manual';

    const discordTimestamp = this.extractDiscordTimestamp(content);
    if (discordTimestamp !== null) {
      killTime = new Date(discordTimestamp * 1000);
      source = 'boss_tracker';
      logger.debug(`Using Discord timestamp: ${killTime.toISOString()}`);
    } else {
      const bracketDate = this.parseBracketLongDate(content);
      if (bracketDate !== null) {
        killTime = bracketDate;
        source = 'boss_tracker';
        logger.debug(`Using bracket long-date (EST): ${killTime.toISOString()}`);
      } else {
        killTime = new Date(messageTimestamp);
        source = 'manual';
        logger.debug(`Using fallback timestamp (message.createdTimestamp): ${killTime.toISOString()}`);
      }
    }

    const result: ParsedKillMessage = {
      bossName: bossInfo.bossName,
      location: bossInfo.location,
      killTime,
      source,
      note: bossInfo.note,
    };

    const noteStr = result.note ? `, note: ${result.note}` : '';
    logger.debug(`Extracted boss: ${result.bossName}, location: ${result.location}${noteStr}, timestamp: ${result.killTime.toISOString()}, source: ${result.source}`);

    return result;
  }

  /**
   * Merge lines that were split after "Name (" so "Note in Location) has been slain!" becomes one line.
   * Boss Tracker (or Discord) sometimes splits e.g. "Vyzh`dra the Cursed (\nCursed 3 in Ssraeshza Temple) has been slain!"
   */
  private mergeContinuationLines(lines: string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const next = lines[i + 1];
      if (
        next &&
        (line.endsWith(' (') || line.endsWith('(') || line.endsWith('（')) &&
        /\)\s*has been slain!\s*$/i.test(next.trim())
      ) {
        out.push(line + next.trim());
        i += 2;
      } else {
        out.push(line);
        i += 1;
      }
    }
    return out;
  }

  /**
   * Parse kill message from Discord message
   * Allows bot messages since Boss Tracker APP posts kill messages
   * Handles multi-line messages by parsing each line separately
   * Returns the first successfully parsed kill (or null if none found)
   */
  parseKillMessage(message: Message): ParsedKillMessage | null {
    // Log message details for debugging
    logger.debug(`parseKillMessage: Processing message from ${message.author.tag} (bot: ${message.author.bot}, ID: ${message.author.id})`);
    logger.debug(`parseKillMessage: Message content: "${message.content.substring(0, 200)}"`);
    logger.debug(`parseKillMessage: Message timestamp: ${new Date(message.createdTimestamp).toISOString()}`);
    
    // NOTE: We allow bot messages because Boss Tracker APP posts kill messages as a bot
    // Previously we skipped all bot messages, but that prevented parsing Boss Tracker messages

    const content = message.content.trim();
    if (!content) {
      return null;
    }

    logger.debug(`Parsing kill message: ${content.substring(0, 100)}...`);

    const rawLines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    const lines = this.mergeContinuationLines(rawLines);

    for (const line of lines) {
      const parsed = this.parseKillLine(line, message);
      if (parsed) {
        return parsed;
      }
    }

    // If no line matched, return null
    logger.debug(`Message doesn't match any kill pattern: ${content.substring(0, 100)}...`);
    return null;
  }

  /**
   * Parse all kill messages from a Discord message (handles multi-line)
   * Returns an array of all successfully parsed kills
   */
  parseKillMessages(message: Message): ParsedKillMessage[] {
    const content = message.content.trim();
    if (!content) {
      return [];
    }

    const rawLines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    const lines = this.mergeContinuationLines(rawLines);
    const kills: ParsedKillMessage[] = [];

    for (const line of lines) {
      const parsed = this.parseKillLine(line, message);
      if (parsed) {
        kills.push(parsed);
      }
    }

    return kills;
  }


  /**
   * Scan channel history for kill messages (last N days)
   */
  async scanChannelHistory(channel: TextChannel, days: number): Promise<ParsedKillMessage[]> {
    const startTime = Date.now();
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const cutoffDate = new Date(cutoffTime);
    const kills: ParsedKillMessage[] = [];
    let messageCount = 0;
    let botMessageCount = 0;
    let lastMessageId: string | undefined;

    logger.info(`Starting startup scan of target-tracking channel (last ${days} days)...`);
    logger.info(`Scan cutoff time: ${cutoffDate.toISOString()} (${days} days ago)`);

    try {
      while (true) {
        const options: { limit: number; before?: string } = { limit: 100 };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) {
          logger.debug(`No more messages to fetch. Breaking scan loop.`);
          break;
        }

        // If the newest message in this batch is already before cutoff, we're done
        const newestInBatch = messages.first();
        if (newestInBatch && newestInBatch.createdTimestamp < cutoffTime) {
          logger.debug(`Batch starts before cutoff. Scan complete.`);
          lastMessageId = undefined;
          break;
        }

        messageCount += messages.size;
        logger.debug(`Fetched batch of ${messages.size} messages. Total scanned: ${messageCount}`);

        for (const message of messages.values()) {
          // Track bot messages
          if (message.author.bot) {
            botMessageCount++;
            logger.debug(`Processing bot message from ${message.author.tag} (ID: ${message.author.id}): "${message.content.substring(0, 100)}"`);
          }
          
          // Past cutoff: stop processing this batch and fetch next (older) batch
          if (message.createdTimestamp < cutoffTime) {
            logger.debug(`Reached cutoff time. Message timestamp: ${new Date(message.createdTimestamp).toISOString()}, Cutoff: ${cutoffDate.toISOString()}. Will fetch older batch.`);
            lastMessageId = message.id;
            break;
          }

          // Parse all kills from this message (handles multi-line messages)
          const parsedKills = this.parseKillMessages(message);
          for (const parsed of parsedKills) {
            logger.info(`Found kill during scan: ${parsed.bossName}${parsed.note ? ` (${parsed.note})` : ''} at ${parsed.killTime.toISOString()} (source: ${parsed.source})`);
            kills.push(parsed);
          }

          lastMessageId = message.id;
        }

        // Break if we've processed all messages
        if (!lastMessageId) {
          break;
        }

        // Log progress every 1000 messages
        if (messageCount % 1000 === 0) {
          logger.debug(`Scanned ${messageCount} messages, found ${kills.length} kills so far...`);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Scanned ${messageCount} messages (${botMessageCount} from bots, ${messageCount - botMessageCount} from users), found ${kills.length} boss kills`);
      logger.info(`Startup scan completed in ${duration}ms`);
      
      if (kills.length === 0 && messageCount > 0) {
        logger.warn(`⚠️ No kills found during startup scan, but ${messageCount} messages were scanned. This might indicate:`);
        logger.warn(`  1. All kill messages are from bots (currently skipped)`);
        logger.warn(`  2. Message format doesn't match expected patterns`);
        logger.warn(`  3. All messages are older than ${days} days`);
      }

      return kills;
    } catch (error) {
      logger.error(`Failed to scan channel history: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }
}
