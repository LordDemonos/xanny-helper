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
/**
 * Parse raid schedule text into RaidEvent objects
 */
export declare function parseRaidSchedule(scheduleText: string): RaidEvent[];
/**
 * Create a calendar event from a raid event
 */
export declare function createCalendarEvent(raidEvent: RaidEvent): CalendarEvent;
/**
 * Update the raid calendar with new events
 */
export declare function updateRaidCalendar(scheduleText: string, calendarId: string): Promise<void>;
