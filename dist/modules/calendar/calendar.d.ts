export interface RaidEvent {
    date: string;
    day: string;
    description: string;
    targets: string[];
    startTime: string;
    endTime: string;
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
export declare function parseRaidSchedule(scheduleText: string): RaidEvent[];
export declare function updateRaidCalendar(scheduleText: string, calendarId: string): Promise<void>;
