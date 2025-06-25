interface Suggestion {
    id: string;
    name: string;
    type: string;
    status: string;
}
export declare class SuggestionsService {
    private sheetId;
    constructor(sheetId: string);
    getSuggestions(): Promise<Suggestion[]>;
    private readSuggestions;
}
export {};
