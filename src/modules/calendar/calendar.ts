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
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './google-service-account.json', // Use env variable or default for local
  scopes: ['https://www.googleapis.com/auth/calendar']
});

// Initialize Google Calendar API
const calendar = google.calendar({ version: 'v3', auth });

/**
 * Create a calendar event from a raid event
 */
function createCalendarEvent(raidEvent: RaidEvent): CalendarEvent {
  // Always set official raid nights to 9pm-12am ET (21:00-00:00)
  const startTime = '21:00';
  const endTime = '00:00';
  const startDateTime = `${raidEvent.date}T${startTime}:00`;

  // Handle end time that might be on the next day
  let endDateTime: string;
  const startHour = parseInt(startTime.split(':')[0]);
  const endHour = parseInt(endTime.split(':')[0]);
  if (endHour < startHour) {
    // End time is on the next day
    const nextDay = new Date(raidEvent.date);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];
    endDateTime = `${nextDayStr}T${endTime}:00`;
  } else {
    endDateTime = `${raidEvent.date}T${endTime}:00`;
  }

  // Use the first target as the main location if available
  const mainTarget = raidEvent.targets[0] || 'TBD';

  // Detailed description template
  const description = `Raid Details:\n- Location: ${mainTarget}\n- Duration: 3 hours\n- Required: Mains only, alts with officer approval\n- Minimum Level: 55+\n- Loot Rules: Standard DKP rules apply\n- Raid Leaders: Talamild and Xanax\n- Discord Channel: Raid Night!!\n\nTargets:\n${raidEvent.targets.map(t => `• ${t}`).join('\n')}\n\nJoin us at https://formerglory.lol`;

  return {
    summary: `Raid Night: ${raidEvent.targets.join(', ')}`,
    description,
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

export function parseRaidSchedule(scheduleText: string): RaidEvent[] {
  const events: RaidEvent[] = [];
  const lines = scheduleText.split('\n');

  for (const line of lines) {
    if (line.includes('•')) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const datePart = parts[0].trim();
        const descriptionPart = parts[1].trim();

        // Parse date and time - updated to match our format: "Monday, 6/23; 9pm ET:"
        const dateMatch = datePart.match(/(\w+),\s*(\d+)\/(\d+);\s*(\d+)pm\s*ET:?/i);
        if (dateMatch) {
          const [_, day, month, date, hour] = dateMatch;
          const currentYear = new Date().getFullYear();
          const formattedDate = `${currentYear}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`;
          
          // Convert hour to 24-hour format
          const hour24 = (parseInt(hour) % 12) + 12;
          const startTime = `${hour24.toString().padStart(2, '0')}:00`;
          
          // Calculate end time (3 hours later)
          const endHour24 = (hour24 + 3) % 24;
          const endTime = `${endHour24.toString().padStart(2, '0')}:00`;

          events.push({
            date: formattedDate,
            day,
            description: descriptionPart,
            targets: descriptionPart.split(',').map(t => t.trim()),
            startTime,
            endTime
          });
        }
      }
    }
  }
  return events;
}

// Update the event matching logic in updateRaidCalendar
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

    return (response.data.items || []).map((event: any) => ({
      id: event.id, // Add this to help with updates/deletes
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

// Update the event matching logic in updateRaidCalendar
export async function updateRaidCalendar(scheduleText: string, calendarId: string): Promise<void> {
  try {
    console.log('Starting calendar update process...');
    
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
    let updatedCount = 0;
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

        // Find existing event on the same date
        const existingEvent = existingEvents.find(existingEvent => {
          const existingStart = new Date(existingEvent.start.dateTime);
          const raidStart = new Date(`${raidEvent.date}T${raidEvent.startTime}`);
          return existingStart.toDateString() === raidStart.toDateString();
        });

        const calendarEvent = createCalendarEvent(raidEvent);

        if (!existingEvent) {
          // Create new event
          console.log(`Creating new event: ${calendarEvent.summary} at ${calendarEvent.start.dateTime}`);
          await calendar.events.insert({
            auth,
            calendarId,
            requestBody: calendarEvent
          });
          console.log(`Successfully created event: ${calendarEvent.summary}`);
          createdCount++;
        } else {
          // Compare summary and description
          const summaryDiffers = existingEvent.summary !== calendarEvent.summary;
          const descriptionDiffers = existingEvent.description !== calendarEvent.description;
          if (summaryDiffers || descriptionDiffers) {
            // Update event
            await calendar.events.update({
              auth,
              calendarId,
              eventId: existingEvent.id,
              requestBody: calendarEvent
            });
            console.log(`Updated event: ${calendarEvent.summary}`);
            updatedCount++;
          } else {
            console.log(`No changes needed for ${raidEvent.date}: ${calendarEvent.summary}`);
            skippedCount++;
          }
        }
      } catch (error) {
        console.error(`Error processing event ${raidEvent.description}:`, error);
        errorCount++;
      }
    }

    console.log('\nCalendar update summary:');
    console.log(`- Total events processed: ${raidEvents.length}`);
    console.log(`- New events created: ${createdCount}`);
    console.log(`- Events updated: ${updatedCount}`);
    console.log(`- Events skipped (past or existing): ${skippedCount}`);
    console.log(`- Errors encountered: ${errorCount}`);

  } catch (error) {
    console.error('Error updating calendar:', error);
    throw error;
  }
} 