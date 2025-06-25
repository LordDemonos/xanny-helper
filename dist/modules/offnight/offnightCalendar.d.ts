export interface OffnightEvent {
    date: string;
    day: string;
    description: string;
    location?: string;
    startTime: string;
    endTime: string;
    host?: string;
    isRecurring: boolean;
    originalThreadId?: string;
    isManual: boolean;
}
export interface CalendarEvent {
    id?: string;
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
 * Parse offnight events from the offnight.txt file content
 */
export declare function parseOffnightSchedule(scheduleText: string): OffnightEvent[];
/**
 * Main function to update the offnight Google Calendar
 */
export declare function updateOffnightCalendar(scheduleText: string, calendarId: string): Promise<void>;
