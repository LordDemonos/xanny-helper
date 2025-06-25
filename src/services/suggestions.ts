import fs from 'fs';
import { google } from 'googleapis';

interface Suggestion {
  id: string;
  name: string;
  type: string;
  status: string;
}

export class SuggestionsService {
  private sheetId: string;

  constructor(sheetId: string) {
    this.sheetId = sheetId;
  }

  public async getSuggestions(): Promise<Suggestion[]> {
    return this.readSuggestions();
  }

  private async readSuggestions(): Promise<Suggestion[]> {
    try {
      // Get the credentials file path from environment variable
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (!credentialsPath) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
      }

      // Log the credentials path for debugging
      console.log(`📋 [${new Date().toLocaleString()}] Using credentials file at: ${credentialsPath}`);

      // Read and parse the credentials file
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      if (!credentials) {
        throw new Error('Failed to parse credentials file');
      }

      // Create auth client with explicit credentials
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });

      // Create sheets client with explicit auth
      const sheets = google.sheets({ version: 'v4', auth });

      // Get the sheet data
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'Suggestions!A2:D'
      });

      const rows = response.data.values || [];
      return rows.map((row: any[]) => ({
        id: row[0] || '',
        name: row[1] || '',
        type: row[2] || '',
        status: row[3] || 'pending'
      }));
    } catch (error) {
      console.error(`❌ [${new Date().toLocaleString()}] Error reading suggestions:`, error);
      throw error;
    }
  }
} 