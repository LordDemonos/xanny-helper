import { google } from 'googleapis';

// Move and export interfaces from calendar.d.ts
export interface RaidEvent {
  date: string;
  day: string;
  description: string;
  targets: string[];
  startTime: string;
  endTime: string;
}

export interface CalendarEvent {
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
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

// Initialize Google Calendar API
const calendar = google.calendar({ version: 'v3', auth });

/**
 * Parse raid schedule text into RaidEvent objects
 */
export function parseRaidSchedule(scheduleText: string): RaidEvent[] {
  const events: RaidEvent[] = [];
  const lines = scheduleText.split('\n');

  console.log('=== DEBUG: parseRaidSchedule called ===');
  console.log('Schedule text length:', scheduleText.length);
  console.log('Schedule text (first 500 chars):', scheduleText.substring(0, 500));
  console.log('Total lines:', lines.length);
  console.log('First 5 lines:');
  lines.slice(0, 5).forEach((line, index) => {
    console.log(`  Line ${index + 1}: "${line}"`);
  });

  for (const line of lines) {
    console.log('Debug: Processing line:', `"${line}"`);
    if (line.includes('•')) {
      console.log('Debug: Line contains bullet point');
      const parts = line.split(':');
      console.log('Debug: Split parts:', parts);
      if (parts.length >= 2) {
        const datePart = parts[0].trim();
        const descriptionPart = parts[1].trim();
        console.log('Debug: Date part:', `"${datePart}"`);
        console.log('Debug: Description part:', `"${descriptionPart}"`);

        // Parse date and time
        // Format: "Friday, 6/20; 9pm ET" -> extract day, month, day
        const dateMatch = datePart.match(/(\w+),\s*(\d+)\/(\d+)/);
        console.log('Debug: Date match result:', dateMatch);
        if (dateMatch) {
          const [_, dayName, month, day] = dateMatch;
          console.log('Debug: Extracted dayName:', dayName, 'month:', month, 'day:', day);
          // Assume current year for the date
          const currentYear = new Date().getFullYear();
          const date = `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          console.log('Debug: Generated date:', date);

          // Parse time if available (look for time in the datePart)
          const timeMatch = datePart.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
          console.log('Debug: Time match result:', timeMatch);
          let startTime = '21:00'; // Default start time (9pm)
          let endTime = '23:00';   // Default end time (11pm)

          if (timeMatch) {
            const [_, hours, minutes = '00', period] = timeMatch;
            const hour = parseInt(hours) + (period.toUpperCase() === 'PM' && parseInt(hours) !== 12 ? 12 : 0);
            startTime = `${hour.toString().padStart(2, '0')}:${minutes}`;
            endTime = `${(hour + 2).toString().padStart(2, '0')}:${minutes}`; // 2 hour duration
            console.log('Debug: Parsed time - start:', startTime, 'end:', endTime);
          }

          events.push({
            date,
            day: dayName,
            description: descriptionPart,
            targets: descriptionPart.split(',').map(t => t.trim()),
            startTime,
            endTime
          });
          console.log('Debug: Added event:', events[events.length - 1]);
        } else {
          console.log('Debug: Date regex did not match');
        }
      } else {
        console.log('Debug: Line does not have enough parts after splitting by colon');
      }
    } else {
      console.log('Debug: Line does not contain bullet point');
    }
  }
  console.log('Debug: Total events parsed:', events.length);
  console.log('=== END DEBUG: parseRaidSchedule ===');
  return events;
}

/**
 * Create a calendar event from a raid event
 */
export function createCalendarEvent(raidEvent: RaidEvent): CalendarEvent {
  const startDateTime = `${raidEvent.date}T${raidEvent.startTime}:00`;
  const endDateTime = `${raidEvent.date}T${raidEvent.endTime}:00`;

  return {
    summary: `Raid: ${raidEvent.targets.join(', ')}`,
    description: raidEvent.description,
    start: {
      dateTime: startDateTime,
      timeZone: 'America/New_York'
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'America/New_York'
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 }  // 1 hour before
      ]
    }
  };
}

/**
 * Get existing calendar events for a date range
 */
async function getExistingEvents(startDate: string, endDate: string, calendarId: string): Promise<CalendarEvent[]> {
  try {
    const response = await calendar.events.list({
      auth,
      calendarId,
      timeMin: `${startDate}T00:00:00Z`,
      timeMax: `${endDate}T23:59:59Z`,
      singleEvents: true,
      orderBy: 'startTime'
    });

    // Convert Google Calendar events to our CalendarEvent type
    return (response.data.items || []).map((event: any) => ({
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
    console.error('Error fetching existing events:', error);
    return [];
  }
}

/**
 * Update the raid calendar with new events
 */
export async function updateRaidCalendar(scheduleText: string, calendarId: string): Promise<void> {
  try {
    console.log('=== TEST: Console.log is working ===');
    console.log('Starting calendar update process...');
    console.log('Schedule text length:', scheduleText.length);
    console.log('Calendar ID:', calendarId);
    
    // Parse raid events from schedule
    const raidEvents = parseRaidSchedule(scheduleText);
    console.log(`Parsed ${raidEvents.length} raid events from schedule`);
    
    if (raidEvents.length === 0) {
      console.log('No raid events found in schedule');
      return;
    }

    // Get date range for existing events
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const endDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .split('T')[0];
    
    console.log(`Checking for events between ${startDate} and ${endDate}`);

    // Get existing events
    const existingEvents = await getExistingEvents(startDate, endDate, calendarId);
    console.log(`Found ${existingEvents.length} existing events in calendar`);

    // Process each raid event
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const raidEvent of raidEvents) {
      try {
        // Skip past events
        const eventDate = new Date(raidEvent.date);
        if (eventDate < today) {
          console.log(`Skipping past event: ${raidEvent.description} (${raidEvent.date})`);
          skippedCount++;
          continue;
        }

        console.log(`Processing event: ${raidEvent.description} (${raidEvent.date} ${raidEvent.startTime})`);

        // Check if event already exists
        const eventExists = existingEvents.some(existingEvent => {
          const existingStart = new Date(existingEvent.start.dateTime);
          const raidStart = new Date(`${raidEvent.date}T${raidEvent.startTime}`);
          const exists = existingStart.getTime() === raidStart.getTime() && 
                        existingEvent.summary.includes(raidEvent.targets[0]);
          if (exists) {
            console.log(`Found matching event: ${existingEvent.summary} at ${existingStart.toLocaleString()}`);
          }
          return exists;
        });

        if (!eventExists) {
          // Create new event
          const calendarEvent = createCalendarEvent(raidEvent);
          console.log(`Creating new event: ${calendarEvent.summary} at ${calendarEvent.start.dateTime}`);
          
          await calendar.events.insert({
            auth,
            calendarId,
            requestBody: calendarEvent
          });
          
          createdCount++;
          console.log(`✅ Created event: ${calendarEvent.summary}`);
        } else {
          console.log(`⏭️ Skipping existing event: ${raidEvent.description}`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing event ${raidEvent.description}:`, error);
        errorCount++;
      }
    }

    console.log(`Calendar update complete: ${createdCount} created, ${skippedCount} skipped, ${errorCount} errors`);
  } catch (error) {
    console.error('❌ Error in updateRaidCalendar:', error);
    throw error;
  }
} 