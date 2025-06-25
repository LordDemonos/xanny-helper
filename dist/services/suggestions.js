"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuggestionsService = void 0;
const fs_1 = __importDefault(require("fs"));
const googleapis_1 = require("googleapis");
class SuggestionsService {
    constructor(sheetId) {
        this.sheetId = sheetId;
    }
    async getSuggestions() {
        return this.readSuggestions();
    }
    async readSuggestions() {
        try {
            // Get the credentials file path from environment variable
            const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
            if (!credentialsPath) {
                throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
            }
            // Log the credentials path for debugging
            console.log(`📋 [${new Date().toLocaleString()}] Using credentials file at: ${credentialsPath}`);
            // Read and parse the credentials file
            const credentials = JSON.parse(fs_1.default.readFileSync(credentialsPath, 'utf8'));
            if (!credentials) {
                throw new Error('Failed to parse credentials file');
            }
            // Create auth client with explicit credentials
            const auth = new googleapis_1.google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
            });
            // Create sheets client with explicit auth
            const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
            // Get the sheet data
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Suggestions!A2:D'
            });
            const rows = response.data.values || [];
            return rows.map((row) => ({
                id: row[0] || '',
                name: row[1] || '',
                type: row[2] || '',
                status: row[3] || 'pending'
            }));
        }
        catch (error) {
            console.error(`❌ [${new Date().toLocaleString()}] Error reading suggestions:`, error);
            throw error;
        }
    }
}
exports.SuggestionsService = SuggestionsService;
//# sourceMappingURL=suggestions.js.map