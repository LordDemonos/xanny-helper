export interface ParsedOffnightEvent {
    title: string;
    day?: string;
    date: Date;
    time: string;
    timeRange?: string;
    isRecurring: boolean;
    timezone: string;
    originalThreadId?: string;
    threadCreatedAt?: Date;
    threadCreator?: string;
}
/**
 * Parses an offnight thread title to extract event information with context awareness
 * @param title The thread title to parse
 * @param threadCreatedAt When the thread was created (optional)
 * @returns Parsed event information or null if invalid
 */
export declare function parseOffnightTitle(title: string, threadCreatedAt?: Date): ParsedOffnightEvent | null;
/**
 * Generates recurring events for the next 4 occurrences
 * @param event The base event to generate recurring events from
 * @returns Array of generated events
 */
export declare function generateRecurringEvents(event: ParsedOffnightEvent): ParsedOffnightEvent[];
/**
 * Processes a list of thread titles to extract valid offnight events
 * @param threads Array of thread objects with name property
 * @returns Array of valid parsed events
 */
export declare function processOffnightThreads(threads: {
    name: string;
    id: string;
}[]): ParsedOffnightEvent[];
/**
 * Formats a single offnight event into a string for file output
 * @param event The parsed offnight event
 */
export declare function formatOffnightEvent(event: ParsedOffnightEvent): string;
/**
 * Formats multiple offnight events to match the offnight.txt file format
 * @param events Array of parsed offnight events
 * @returns Formatted string for offnight.txt
 */
export declare function formatOffnightEvents(events: ParsedOffnightEvent[]): string;
