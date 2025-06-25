import { Client } from 'discord.js';
export declare class SuggestionsService {
    private readonly auth;
    private readonly sheets;
    private readonly spreadsheetId;
    private readonly channel;
    private checkInterval;
    private readonly SUGGESTION_PREFIX;
    constructor(client: Client, channelId: string, credentials: {
        keyFile: string;
        scopes: string[];
    }, spreadsheetId: string);
    private startChecking;
    stopChecking(): void;
    private checkForNewSuggestions;
    private readSuggestions;
    private getPostedSuggestions;
    private formatSuggestion;
    private filterSuggestion;
}
