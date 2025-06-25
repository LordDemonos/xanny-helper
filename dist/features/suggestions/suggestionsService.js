"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuggestionsService = void 0;
const logger_1 = require("../../utils/logger");
const googleapis_1 = require("googleapis");
class SuggestionsService {
    constructor(client, channelId, credentials, spreadsheetId) {
        this.checkInterval = null;
        this.SUGGESTION_PREFIX = 'Feedback & Suggestions Bot:';
        const { keyFile } = credentials;
        // Validate credentials file exists
        const fs = require('fs');
        if (!fs.existsSync(keyFile)) {
            throw new Error(`Google credentials file not found: ${keyFile}`);
        }
        this.auth = new googleapis_1.google.auth.GoogleAuth({
            keyFile,
            scopes: credentials.scopes
        });
        this.sheets = googleapis_1.google.sheets({ version: 'v4', auth: this.auth });
        this.spreadsheetId = spreadsheetId;
        this.channel = client.channels.cache.get(channelId);
        if (!this.channel) {
            throw new Error(`Channel ${channelId} not found`);
        }
        // Start checking for new suggestions
        this.startChecking();
    }
    startChecking() {
        // Clear any existing interval
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        // Check for new suggestions every 15 minutes
        this.checkInterval = setInterval(async () => {
            try {
                await this.checkForNewSuggestions();
            }
            catch (error) {
                logger_1.logger.error('Error checking for new suggestions:', error);
            }
        }, 15 * 60 * 1000); // 15 minutes in milliseconds
        // Do an initial check
        this.checkForNewSuggestions().catch(error => {
            logger_1.logger.error('Error during initial suggestions check:', error);
        });
    }
    stopChecking() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
    async checkForNewSuggestions() {
        try {
            // Get all suggestions from sheet
            const suggestions = await this.readSuggestions();
            // Get previously posted suggestions
            const postedSuggestions = await this.getPostedSuggestions();
            // Filter out already posted suggestions
            const newSuggestions = suggestions.filter(suggestion => !postedSuggestions.has(suggestion.timestamp));
            if (newSuggestions.length === 0) {
                logger_1.logger.info('No new suggestions to post');
                return;
            }
            // Post new suggestions
            for (const suggestion of newSuggestions) {
                const filterReason = this.filterSuggestion(suggestion);
                if (filterReason) {
                    logger_1.logger.warn(`Suggestion from [${suggestion.timestamp}] filtered: ${filterReason}`);
                    continue;
                }
                const message = this.formatSuggestion(suggestion);
                await this.channel.send(message);
                logger_1.logger.info(`Posted new suggestion from [${suggestion.timestamp}] to Discord`);
                // Rate limit: wait 15 seconds before next post
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
            logger_1.logger.info(`Finished posting ${newSuggestions.length} new suggestion(s) to Discord`);
        }
        catch (error) {
            logger_1.logger.error('Error checking for new suggestions:', error);
            throw error;
        }
    }
    async readSuggestions() {
        const maxRetries = 3;
        const retryDelay = 5000; // 5 seconds
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger_1.logger.info(`Reading suggestions from Google Sheet: ${this.spreadsheetId} (attempt ${attempt}/${maxRetries})`);
                // Use the existing auth instance directly instead of creating a new client
                const response = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Form Responses 1!A:D',
                });
                const rows = response.data.values;
                if (!rows || rows.length === 0) {
                    logger_1.logger.info('No suggestions found in sheet');
                    return [];
                }
                logger_1.logger.info(`Found ${rows.length - 1} suggestions in sheet`);
                return rows.slice(1).map((row) => ({
                    timestamp: row[0],
                    suggestion: row[1],
                    imageUrl: row[2] || undefined,
                }));
            }
            catch (error) {
                logger_1.logger.error(`Error reading suggestions (attempt ${attempt}/${maxRetries}):`, error);
                // Add more detailed error information for debugging
                if (error instanceof Error) {
                    if (error.message.includes('ENOTFOUND') || error.message.includes('EHOSTUNREACH')) {
                        logger_1.logger.warn(`Network connectivity issue detected: ${error.message}`);
                    }
                    else if (error.message.includes('timeout')) {
                        logger_1.logger.warn(`Request timeout detected: ${error.message}`);
                    }
                    else if (error.message.includes('ECONNRESET')) {
                        logger_1.logger.warn(`Connection reset detected: ${error.message}`);
                    }
                }
                if (attempt === maxRetries) {
                    // Final attempt failed, throw the error
                    throw error;
                }
                // Wait before retrying
                logger_1.logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
        // This should never be reached, but TypeScript requires it
        throw new Error('Failed to read suggestions after all retry attempts');
    }
    async getPostedSuggestions() {
        try {
            logger_1.logger.info(`Fetching previously posted suggestions from Discord channel: ${this.channel.id}`);
            const messages = await this.channel.messages.fetch({ limit: 100 });
            const postedSuggestions = new Set();
            let count = 0;
            messages.forEach(message => {
                if (message.content.startsWith(this.SUGGESTION_PREFIX)) {
                    const timestampMatch = message.content.match(/\[(.*?)\]/);
                    if (timestampMatch) {
                        postedSuggestions.add(timestampMatch[1]);
                        count++;
                    }
                }
            });
            logger_1.logger.info(`Found ${count} previously posted suggestions in Discord channel`);
            return postedSuggestions;
        }
        catch (error) {
            logger_1.logger.error('Error fetching posted suggestions from Discord:', error);
            throw error;
        }
    }
    formatSuggestion(suggestion) {
        let message = `${this.SUGGESTION_PREFIX}\n`;
        message += `[${suggestion.timestamp}]\n`;
        message += `\`\`\`\n${suggestion.suggestion}\n\`\`\``;
        if (suggestion.imageUrl) {
            message += `\nImage: ${suggestion.imageUrl}`;
        }
        return message;
    }
    filterSuggestion(suggestion) {
        const { suggestion: text, imageUrl } = suggestion;
        const lower = text.toLowerCase();
        // Block code injection and suspicious patterns
        if (/<script|<\/script|eval\(|require\(|import |process\.|child_process|exec\(|spawn\(/.test(lower)) {
            return 'Blocked: Contains potentially malicious code';
        }
        // Block Discord invites
        if (/discord\.gg\//.test(lower)) {
            return 'Blocked: Contains Discord invite link';
        }
        // Block mass mentions
        if (/@everyone|@here/.test(text)) {
            return 'Blocked: Contains mass mention';
        }
        // Block very long messages
        if (text.length > 2000) {
            return 'Blocked: Suggestion is too long';
        }
        // Block suspicious image URLs
        if (imageUrl && !/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(imageUrl)) {
            return 'Blocked: Image URL is not a valid image';
        }
        return null;
    }
}
exports.SuggestionsService = SuggestionsService;
//# sourceMappingURL=suggestionsService.js.map