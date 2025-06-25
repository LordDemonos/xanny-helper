/**
 * Gets the appropriate image name for a Discord event
 */
export declare function getEventImageName(eventTitle: string, eventDescription?: string, eventType?: 'raid' | 'offnight'): string;
/**
 * Generates a GitHub URL for an image
 */
export declare function getImageUrl(imageName: string, githubRepo: string, branch?: string): string;
/**
 * Gets the complete image URL for a Discord event
 */
export declare function getEventImageUrl(eventTitle: string, eventDescription?: string, eventType?: 'raid' | 'offnight', githubRepo?: string, branch?: string): string | null;
/**
 * Test function to see what image would be matched for a given event
 */
export declare function testEventImage(eventTitle: string, eventDescription?: string, eventType?: 'raid' | 'offnight'): {
    imageName: string;
    matchedText?: string;
};
/**
 * Convert a GitHub image URL to a data URI with caching
 */
export declare function githubImageToDataURI(imageUrl: string, cacheManager: any): Promise<string | null>;
