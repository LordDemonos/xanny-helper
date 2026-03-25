import { google } from 'googleapis';
import { logger } from '../../utils/logger';

// Use a robust date/time library for timezone handling
import { toZonedTime, format } from 'date-fns-tz';

// Interfaces
export interface OffnightEvent {
  date: string;           // YYYY-MM-DD format
  day: string;           // Day of week
  description: string;   // Event description
  location?: string;     // Where the event takes place (for manual events)
  startTime: string;     // HH:MM format
  endTime: string;       // HH:MM format
  host?: string;         // Optional host name
  isRecurring: boolean;  // Whether this is a recurring event
  originalThreadId?: string; // Discord thread ID for tracking
  isManual: boolean;     // Whether this is a manual entry or bot-generated
}

export interface CalendarEvent {
  id?: string; // Only present for events fetched from Google Calendar
  summary: string;
  description: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  reminders: {
    useDefault: boolean;
    overrides: Array<{
      method: string;
      minutes: number;
    }>;
  };
}

// Initialize Google Auth client
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || 
           process.env.GOOGLE_SERVICE_ACCOUNT_PATH || 
           './google-service-account.json',
  scopes: ['https://www.googleapis.com/auth/calendar']
});

// Initialize Google Calendar API
const calendar = google.calendar({ version: 'v3', auth });

/**
 * Create a calendar event from an offnight event
 */
function createOffnightCalendarEvent(offnightEvent: OffnightEvent): CalendarEvent {
  const timeZone = 'America/New_York';

  // Combine date and time strings
  const startDateTimeStr = `${offnightEvent.date} ${offnightEvent.startTime}`;
  const endDateTimeStr = `${offnightEvent.date} ${offnightEvent.endTime}`;

  // Create Date objects correctly in the target timezone
  const startDateTime = toZonedTime(startDateTimeStr, timeZone);
  const endDateTime = toZonedTime(endDateTimeStr, timeZone);

  const eventType = offnightEvent.isManual ? 'Offnight Raid' : 'Static Group';

  let description = '';
  if (offnightEvent.isManual) {
    description = `Raid Leader: Xanax`;
  } else {
    description = `Hosted by: ${offnightEvent.host || 'Unknown'}\nSign up in Discord #static-group-signups channel`;
  }
  description += `\n\nJoin us at formerglory.lol`;

  return {
    summary: `${eventType}: ${offnightEvent.description}`,
    description: description,
    start: {
      dateTime: format(startDateTime, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      timeZone: timeZone
    },
    end: {
      dateTime: format(endDateTime, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      timeZone: timeZone
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 }
      ]
    }
  };
}

/**
 * Parse offnight events from the offnight.txt file content
 */
export function parseOffnightSchedule(scheduleText: string): OffnightEvent[] {
  const events: OffnightEvent[] = [];
  const lines = scheduleText.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const parts = line.split('. ');
    if (parts.length < 2) continue;

    const dateTimePart = parts[0];
    const titlePart = parts.slice(1).join('. ');

    const dateTimeMatch = dateTimePart.match(/^(\w+)\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)/);
    if (!dateTimeMatch) continue;

    const [_, day, month, date, hour, minute, period] = dateTimeMatch;

    let description = titlePart;
    let host: string | undefined;
    const isManual = !titlePart.includes('Hosted by');

    if (!isManual) {
      const titleMatch = titlePart.match(/(.+)\s+Hosted by\s+(.+)/);
      if (titleMatch) {
        description = titleMatch[1];
        host = titleMatch[2];
      }
    }

    let hour24 = parseInt(hour);
    if (period.toUpperCase() === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period.toUpperCase() === 'AM' && hour24 === 12) {
      hour24 = 0;
    }

    const currentYear = new Date().getFullYear();
    const eventDate = new Date(currentYear, parseInt(month) - 1, parseInt(date));
    // Handle year rollover for events in the next year
    if (eventDate < new Date() && eventDate.getMonth() < new Date().getMonth() - 1) {
      eventDate.setFullYear(currentYear + 1);
    }
    
    const formattedDate = format(eventDate, 'yyyy-MM-dd');
    const startTime = `${String(hour24).padStart(2, '0')}:${minute}`;
    const endTime = `${String((hour24 + 2) % 24).padStart(2, '0')}:${minute}`;

    events.push({
      date: formattedDate,
      day,
      description,
      startTime,
      endTime,
      host,
      isManual,
      isRecurring: false, 
    });
  }

  return events;
}

/**
 * Get existing calendar events within a date range
 */
async function getExistingOffnightEvents(startDate: string, endDate: string, calendarId: string): Promise<CalendarEvent[]> {
  try {
    const response = await calendar.events.list({
      auth,
      calendarId,
      timeMin: `${startDate}T00:00:00Z`,
      timeMax: `${endDate}T23:59:59Z`,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return (response.data.items || []).map((event: any) => ({
      id: event.id,
      summary: event.summary || 'Untitled Event',
      description: event.description || '',
      start: {
        dateTime: event.start?.dateTime || event.start?.date || '',
        timeZone: event.start?.timeZone || 'America/New_York'
      },
      end: {
        dateTime: event.end?.dateTime || event.end?.date || '',
        timeZone: event.end?.timeZone || 'America/New_York'
      },
      reminders: {
        useDefault: event.reminders?.useDefault || false,
        overrides: (event.reminders?.overrides || []).map((override: any) => ({
          method: override.method || 'email',
          minutes: override.minutes || 0
        }))
      }
    }));
  } catch (error) {
    logger.error('Error fetching existing offnight events:', error);
    return [];
  }
}

async function eventExists(event: CalendarEvent, existingEvents: CalendarEvent[]): Promise<string | null> {
  for (const existingEvent of existingEvents) {
    if (existingEvent.summary === event.summary) {
      const existingStart = new Date(existingEvent.start.dateTime).getTime();
      const newStart = new Date(event.start.dateTime).getTime();
      if (existingStart === newStart) {
        return existingEvent.id || null;
      }
    }
  }
  return null;
}

/**
 * Main function to update the offnight Google Calendar
 */
export async function updateOffnightCalendar(scheduleText: string, calendarId: string): Promise<void> {
  logger.info('Starting offnight calendar update process...');
  const offnightEvents = parseOffnightSchedule(scheduleText);
  logger.info(`Parsed ${offnightEvents.length} offnight events from schedule`);

  if (offnightEvents.length === 0) {
    logger.info('No offnight events to process.');
    return;
  }

  const today = new Date();
  const startDate = format(today, 'yyyy-MM-dd');
  const endDate = format(new Date(today.setFullYear(today.getFullYear() + 1)), 'yyyy-MM-dd');
  
  logger.info(`Checking for offnight events between ${startDate} and ${endDate}`);
  const existingEvents = await getExistingOffnightEvents(startDate, endDate, calendarId);
  logger.info(`Found ${existingEvents.length} existing offnight events in calendar`);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;

  for (const offnightEvent of offnightEvents) {
    const eventDate = new Date(offnightEvent.date);
    if (eventDate < new Date(startDate)) {
        skippedCount++;
        continue;
    }

    const calendarEvent = createOffnightCalendarEvent(offnightEvent);
    const existingEventId = await eventExists(calendarEvent, existingEvents);

    if (existingEventId) {
      // Check if update is needed
      const existingEvent = existingEvents.find(e => e.id === existingEventId);
      if (existingEvent?.description !== calendarEvent.description) {
        logger.info(`Updating existing offnight event: ${calendarEvent.summary}`);
        await calendar.events.update({
          auth,
          calendarId,
          eventId: existingEventId,
          requestBody: calendarEvent,
        });
        updatedCount++;
      } else {
        // No changes needed
      }
    } else {
      logger.info(`Creating new offnight event: ${calendarEvent.summary} at ${calendarEvent.start.dateTime}`);
      await calendar.events.insert({
        auth,
        calendarId,
        requestBody: calendarEvent,
      });
      createdCount++;
    }
  }

  // Optional: Clean up old events not in the new schedule
  for (const existingEvent of existingEvents) {
    // Do not delete official raid nights
    if (existingEvent.summary && existingEvent.summary.startsWith('Raid Night:')) {
      continue;
    }
    const isStillScheduled = offnightEvents.some(offnightEvent => {
      const calEvent = createOffnightCalendarEvent(offnightEvent);
      return calEvent.summary === existingEvent.summary && new Date(calEvent.start.dateTime).getTime() === new Date(existingEvent.start.dateTime).getTime();
    });

    if (!isStillScheduled) {
      logger.info(`Deleting old offnight event: ${existingEvent.summary} on ${existingEvent.start.dateTime}`);
      await calendar.events.delete({ auth, calendarId, eventId: existingEvent.id! });
      deletedCount++;
    }
  }

  logger.info(`✅ Offnight calendar update complete: ${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted, ${skippedCount} skipped`);
} 