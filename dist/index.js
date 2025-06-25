"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGithubFile = updateGithubFile;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const logger_1 = require("./utils/logger");
const cacheManager_1 = require("./modules/cache/cacheManager");
const path_1 = __importDefault(require("path"));
const discordEventManager_1 = __importDefault(require("./modules/discord-events/discordEventManager"));
// This IIFE handles startup flags immediately, before the bot does anything else.
(async () => {
    if (process.argv.includes('--clear-offnight-cache')) {
        logger_1.logger.info('Received --clear-offnight-cache flag. Clearing cache and exiting...');
        const CACHE_FILE_PATH = process.env.CACHE_FILE_PATH || path_1.default.join(__dirname, '..', 'cache', 'content-cache.json');
        const cacheManager = new cacheManager_1.CacheManager(CACHE_FILE_PATH);
        await cacheManager.loadCache();
        cacheManager.clearOffnightCache();
        await cacheManager.saveCache();
        logger_1.logger.info('Offnight cache cleared successfully. Exiting now.');
        process.exit(0);
    }
})();
// These are now initialized here and will be assigned in main()
let suggestionsService = null;
let discordEventManager = null;
const discord_js_1 = require("discord.js");
const rest_1 = require("@octokit/rest");
const fs_1 = __importDefault(require("fs"));
const verification_1 = require("./utils/verification");
const crypto_1 = require("crypto");
const fileProcessor_1 = require("./utils/fileProcessor");
const inventoryManager_1 = require("./modules/inventory/inventoryManager");
const raidManager_1 = require("./modules/raid/raidManager");
const offnightManager_1 = require("./modules/offnight/offnightManager");
const suggestionsService_1 = require("./features/suggestions/suggestionsService");
const raidPatternMatcher_1 = require("./modules/raid/raidPatternMatcher");
const { DISCORD_TOKEN, GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = 'master', GOOGLE_CALENDAR_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, INVENTORY_CHANNEL_ID, RAID_SCHEDULE_CHANNEL_ID, OFFNIGHT_CHANNEL_ID, OFFNIGHT_FILE_PATH, SUGGESTIONS_CHANNEL_ID, SUGGESTIONS_SHEET_ID, SUGGESTIONS_CREDENTIALS_PATH = './GOOGLE_CREDENTIALS.json', RAID_FILE_PATH, DISCORD_GUILD_ID, DISCORD_RAID_CHANNEL_ID, DISCORD_OFFNIGHT_CHANNEL_ID } = process.env;
// Extract owner and repo from GITHUB_REPO
const [GITHUB_OWNER, GITHUB_REPO_NAME] = GITHUB_REPO.split('/');
// Validate GitHub configuration
if (!GITHUB_OWNER || !GITHUB_REPO_NAME) {
    throw new Error('Invalid GITHUB_REPO format. Expected format: owner/repo');
}
if (!DISCORD_TOKEN || !RAID_SCHEDULE_CHANNEL_ID || !INVENTORY_CHANNEL_ID || !GITHUB_TOKEN || !GITHUB_REPO || !RAID_FILE_PATH || !GOOGLE_CALENDAR_ID || !SUGGESTIONS_CHANNEL_ID || !SUGGESTIONS_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !OFFNIGHT_CHANNEL_ID || !OFFNIGHT_FILE_PATH || !DISCORD_GUILD_ID || !DISCORD_RAID_CHANNEL_ID || !DISCORD_OFFNIGHT_CHANNEL_ID) {
    throw new Error('Missing required environment variables.');
}
// Add type assertion for RAID_FILE_PATH
const RAID_FILE_PATH_STR = RAID_FILE_PATH;
const client = new discord_js_1.Client({ intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages, discord_js_1.GatewayIntentBits.MessageContent] });
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
// Initialize cache
let contentCache = {
    raidSchedule: null,
    inventoryFiles: {}
};
// Cache file path
const CACHE_FILE_PATH = process.env.CACHE_FILE_PATH || path_1.default.join(__dirname, 'cache', 'content-cache.json');
// Cache cleanup settings
const CACHE_CLEANUP_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
// Ensure cache directory exists
function ensureCacheDirectory() {
    const cacheDir = path_1.default.dirname(CACHE_FILE_PATH);
    if (!fs_1.default.existsSync(cacheDir)) {
        try {
            fs_1.default.mkdirSync(cacheDir, { recursive: true });
            logger_1.logger.info('Created cache directory');
        }
        catch (error) {
            logger_1.logger.error(`Failed to create cache directory: ${error instanceof Error ? error.message : error}`);
            throw error; // Re-throw to handle in the calling function
        }
    }
}
// Initialize file processor with proper error handling
const fileProcessor = new fileProcessor_1.FileProcessor(octokit, GITHUB_OWNER, GITHUB_REPO_NAME, GITHUB_BRANCH);
// Test GitHub connection
octokit.repos.get({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO_NAME
}).then(() => {
    log('GitHub connection test successful', 'success');
}).catch(error => {
    log(`GitHub connection error: ${error.message}`, 'error');
    log('Please check your GITHUB_TOKEN and GITHUB_REPO configuration', 'warning');
    log('Bot will continue running but GitHub operations may fail', 'warning');
    // Don't exit the process - let the bot continue running
});
// Initialize managers
const cacheManager = new cacheManager_1.CacheManager(CACHE_FILE_PATH);
// Initialize managers
let inventoryManager;
let raidManager;
let offnightManager;
// Logging utility
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleString();
    const prefix = {
        // Status/Progress
        info: '📋', // General information
        debug: '🔍', // Detailed debugging (reduced verbosity)
        // Success
        success: '✅', // Operation completed successfully
        // Warnings
        warning: '⚠️', // Warning about potential issues
        // Errors
        error: '❌', // Operation failed
        // Special categories
        bot: '🤖', // Bot status messages
        cache: '💾', // Cache operations
        file: '📄', // File operations
        github: '🔗', // GitHub operations
        calendar: '📅', // Calendar operations
        discord: '💬', // Discord operations
        time: '⏰', // Time-related messages
        search: '🔎', // Search operations
        verify: '✓', // Verification operations
        update: '🔄', // Update operations
        stats: '📊' // Statistics/summary
    }[type];
    const messageText = message instanceof Error ? message.message : message;
    // Only log info and debug messages if explicitly requested or in development
    if (type === 'info' || type === 'debug') {
        // In production, these would be filtered out or sent to debug level
        // For now, we'll keep them but they can be easily removed
        console.log(`${prefix} [${timestamp}] ${messageText}`);
    }
    else {
        console.log(`${prefix} [${timestamp}] ${messageText}`);
    }
    if (message instanceof Error && message.stack) {
        console.log(`${prefix} [${timestamp}] Stack: ${message.stack}`);
    }
}
// Function to clean up old cache entries
function cleanupCache() {
    const now = Date.now();
    let cleanedCount = 0;
    // Clean up inventory files
    Object.entries(contentCache.inventoryFiles).forEach(([path, data]) => {
        if (now - data.timestamp > CACHE_CLEANUP_THRESHOLD) {
            delete contentCache.inventoryFiles[path];
            cleanedCount++;
        }
    });
    // Clean up raid schedule if it's old
    if (contentCache.raidSchedule && now - contentCache.raidSchedule.timestamp > CACHE_CLEANUP_THRESHOLD) {
        contentCache.raidSchedule = null;
        cleanedCount++;
    }
    if (cleanedCount > 0) {
        logger_1.logger.info(`Cleaned up ${cleanedCount} old cache entries`);
    }
}
// Save cache to file
async function saveCache() {
    try {
        ensureCacheDirectory();
        cleanupCache(); // Clean up old entries before saving
        await fs_1.default.promises.writeFile(CACHE_FILE_PATH, JSON.stringify(contentCache, null, 2));
    }
    catch (error) {
        logger_1.logger.error(`Failed to save cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Function to check if raid schedule has changed
function hasRaidScheduleChanged(newSchedule) {
    // Normalize the content by trimming whitespace and normalizing line endings
    const normalizeContent = (content) => content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
    const normalizedNew = normalizeContent(newSchedule);
    const normalizedCache = contentCache.raidSchedule ? normalizeContent(contentCache.raidSchedule.content) : '';
    const hasChanged = !contentCache.raidSchedule || normalizedNew !== normalizedCache;
    if (hasChanged) {
        log('Raid Schedule Changes Detected:', 'success');
        if (!contentCache.raidSchedule) {
            log('No previous schedule in cache - this is a new schedule', 'info');
        }
        else {
            log(`Cache timestamp: ${new Date(contentCache.raidSchedule.timestamp).toLocaleString()}`, 'debug');
            // Compare events
            const oldEvents = normalizedCache.split('\n').filter(line => line.includes('•'));
            const newEvents = normalizedNew.split('\n').filter(line => line.includes('•'));
            // Find added events
            const addedEvents = newEvents.filter(event => !oldEvents.includes(event));
            if (addedEvents.length > 0) {
                log(`Added ${addedEvents.length} events:`, 'success');
                addedEvents.forEach(event => log(`  - ${event.trim()}`, 'debug'));
            }
            // Find removed events
            const removedEvents = oldEvents.filter(event => !newEvents.includes(event));
            if (removedEvents.length > 0) {
                log(`Removed ${removedEvents.length} events:`, 'warning');
                removedEvents.forEach(event => log(`  - ${event.trim()}`, 'debug'));
            }
            // Find modified events
            const modifiedEvents = newEvents.filter(newEvent => {
                const oldEvent = oldEvents.find(old => old.split(':')[0] === newEvent.split(':')[0] &&
                    old !== newEvent);
                return oldEvent !== undefined;
            });
            if (modifiedEvents.length > 0) {
                log(`Modified ${modifiedEvents.length} events:`, 'warning');
                modifiedEvents.forEach(event => log(`  - ${event.trim()}`, 'debug'));
            }
            // Summary
            log(`Raid schedule changes: ${addedEvents.length} added, ${removedEvents.length} removed, ${modifiedEvents.length} modified`, 'stats');
        }
    }
    else {
        log('No changes detected in raid schedule content', 'debug');
        if (contentCache.raidSchedule) {
            log(`Cache timestamp: ${new Date(contentCache.raidSchedule.timestamp).toLocaleString()}`, 'debug');
        }
    }
    return hasChanged;
}
async function updateGithubFile(path, content, append = false, force = false) {
    try {
        // Check if content has changed
        const cacheKey = path;
        const cachedData = contentCache.inventoryFiles[cacheKey];
        const currentChecksum = (0, crypto_1.createHash)('sha256').update(content).digest('hex');
        // Skip cache check for raid schedule unless force is true
        if (!force) {
            if (path === RAID_FILE_PATH_STR) {
                if (contentCache.raidSchedule?.content === content) {
                    logger_1.logger.info(`Skipping update for ${path} - content unchanged`);
                    return false;
                }
            }
            else if (cachedData?.verification?.checksum === currentChecksum) {
                logger_1.logger.info(`Skipping update for ${path} - content unchanged`);
                return false;
            }
        }
        // Wrap the upload operation in retry logic
        const result = await (0, verification_1.retryWithBackoff)(async () => {
            // Get current file SHA and content if it exists
            let currentSha;
            let existingContent = '';
            try {
                const { data } = await octokit.repos.getContent({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO_NAME,
                    path,
                    ref: GITHUB_BRANCH
                });
                if (Array.isArray(data)) {
                    throw new Error('Path is a directory');
                }
                if (data.type === 'file') {
                    currentSha = data.sha;
                    if (data.encoding === 'base64' && data.content) {
                        existingContent = Buffer.from(data.content, 'base64').toString();
                    }
                }
            }
            catch (error) {
                if (error.status !== 404) {
                    throw error;
                }
            }
            // Combine content if append is true
            const finalContent = append ? existingContent + content : content;
            // Create or update the file
            await octokit.repos.createOrUpdateFileContents({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO_NAME,
                path,
                message: `Update ${path}`,
                content: Buffer.from(finalContent).toString('base64'),
                sha: currentSha,
                branch: GITHUB_BRANCH
            });
            // Verify the upload
            const verification = await (0, verification_1.verifyGitHubUpload)(octokit, GITHUB_OWNER, GITHUB_REPO_NAME, path, finalContent, cachedData?.verification, GITHUB_BRANCH);
            if (!verification.success) {
                throw new Error(`Verification failed: ${verification.error}`);
            }
            // Update cache with verification data
            if (path === RAID_FILE_PATH_STR) {
                contentCache.raidSchedule = {
                    content: finalContent,
                    timestamp: Date.now()
                };
            }
            else {
                contentCache.inventoryFiles[cacheKey] = {
                    content: finalContent,
                    timestamp: Date.now(),
                    verification: {
                        checksum: verification.checksum,
                        lastVerified: Date.now(),
                        status: 'success'
                    }
                };
            }
            await saveCache();
            return true;
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger_1.logger.error(`Failed to update ${path}: ${errorMessage}`);
        // Update cache with failed verification
        if (path === RAID_FILE_PATH_STR) {
            contentCache.raidSchedule = {
                content,
                timestamp: Date.now()
            };
        }
        else {
            const cacheKey = path;
            contentCache.inventoryFiles[cacheKey] = {
                content,
                timestamp: Date.now(),
                verification: {
                    checksum: (0, crypto_1.createHash)('sha256').update(content).digest('hex'),
                    lastVerified: Date.now(),
                    status: 'failed',
                    error: errorMessage
                }
            };
        }
        await saveCache();
        return false;
    }
}
// Function to verify GitHub state against cache
async function verifyGitHubState() {
    try {
        log('Starting GitHub state verification...', 'debug');
        const inventoryFiles = {
            'Fggems-Inventory.txt': 'assets/data/Fggems-Inventory.txt',
            'Fsbank-Inventory.txt': 'assets/data/Fsbank-Inventory.txt',
            'Fgspells-Inventory.txt': 'assets/data/Fgspells-Inventory.txt'
        };
        let verifiedCount = 0;
        let updatedCount = 0;
        let createdCount = 0;
        let missingCount = 0;
        for (const [filename, githubPath] of Object.entries(inventoryFiles)) {
            log(`Verifying ${filename}...`, 'debug');
            const cacheKey = `inventory_${filename}`;
            const cachedData = contentCache.inventoryFiles[cacheKey];
            try {
                // Get current GitHub content with commit history
                log(`Fetching ${filename} from GitHub...`, 'debug');
                const { data: contentData } = await octokit.repos.getContent({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO_NAME,
                    path: githubPath,
                    ref: GITHUB_BRANCH
                });
                if (Array.isArray(contentData)) {
                    throw new Error('Path is a directory');
                }
                // Get commit history for this file
                const { data: commitData } = await octokit.repos.listCommits({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO_NAME,
                    path: githubPath,
                    per_page: 1
                });
                if (commitData.length === 0) {
                    throw new Error('No commit history found');
                }
                const lastCommit = commitData[0];
                const githubTimestamp = new Date(lastCommit.commit.author?.date || '').getTime();
                if (contentData.type === 'file' && contentData.encoding === 'base64') {
                    const githubContent = Buffer.from(contentData.content, 'base64').toString();
                    // If we have cached data, verify it matches GitHub
                    if (cachedData) {
                        if (cachedData.content !== githubContent || cachedData.timestamp !== githubTimestamp) {
                            log(`Cache mismatch detected for ${filename}`, 'warning');
                            log(`GitHub version: ${new Date(githubTimestamp).toLocaleString()}`, 'debug');
                            log(`Cache version: ${new Date(cachedData.timestamp).toLocaleString()}`, 'debug');
                            log('Updating cache with GitHub content...', 'debug');
                            contentCache.inventoryFiles[cacheKey] = {
                                content: githubContent,
                                timestamp: githubTimestamp
                            };
                            updatedCount++;
                            log(`Cache updated for ${filename}`, 'success');
                        }
                        else {
                            log(`Cache verified for ${filename} - content and timestamp match GitHub`, 'success');
                            log(`Last updated: ${new Date(githubTimestamp).toLocaleString()}`, 'debug');
                            verifiedCount++;
                        }
                    }
                    else {
                        // No cache entry, create one from GitHub content
                        log(`No cache entry found for ${filename}`, 'debug');
                        log(`GitHub version: ${new Date(githubTimestamp).toLocaleString()}`, 'debug');
                        log('Creating new cache entry from GitHub content...', 'debug');
                        contentCache.inventoryFiles[cacheKey] = {
                            content: githubContent,
                            timestamp: githubTimestamp
                        };
                        createdCount++;
                        log(`Cache entry created for ${filename}`, 'success');
                    }
                }
            }
            catch (error) {
                if (error.status === 404) {
                    log(`File ${filename} not found in GitHub repository`, 'warning');
                    log('Will look for this file in Discord channel', 'debug');
                    missingCount++;
                }
                else {
                    log(`Error verifying ${filename}: ${error.message}`, 'error');
                    log('Stack trace:', 'error');
                    log(error.stack || 'No stack trace available', 'error');
                }
            }
        }
        // Save updated cache
        log('Saving updated cache...', 'debug');
        await saveCache();
        // Log verification summary
        log(`GitHub Verification Summary: ${verifiedCount} verified, ${updatedCount} updated, ${createdCount} created, ${missingCount} missing`, 'stats');
    }
    catch (error) {
        log('Error during GitHub verification:', 'error');
        log(`Message: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        log('Stack trace:', 'error');
        log(error instanceof Error ? error.stack || 'No stack trace available' : 'No stack trace available', 'error');
    }
}
// Function to find latest inventory files in Discord channel
async function findLatestInventoryFiles(channel) {
    try {
        // First verify GitHub state against cache
        await verifyGitHubState();
        log('Starting inventory file search...', 'debug');
        const inventoryFiles = {
            'Fggems-Inventory.txt': 'assets/data/Fggems-Inventory.txt',
            'Fsbank-Inventory.txt': 'assets/data/Fsbank-Inventory.txt',
            'Fgspells-Inventory.txt': 'assets/data/Fgspells-Inventory.txt'
        };
        // Initialize Map to store latest message and timestamp for each file
        const latestFiles = new Map();
        // Initialize with null values for each file type
        Object.keys(inventoryFiles).forEach(filename => {
            latestFiles.set(filename, { message: null, timestamp: 0 });
        });
        let lastId;
        let scannedCount = 0;
        let processedCount = 0;
        const BATCH_SIZE = 100;
        const MAX_MESSAGES = 5000;
        while (scannedCount < MAX_MESSAGES) {
            const options = { limit: BATCH_SIZE };
            if (lastId) {
                options.before = lastId;
            }
            const messages = await channel.messages.fetch(options);
            if (messages.size === 0)
                break;
            let foundNewFile = false;
            for (const message of messages.values()) {
                scannedCount++;
                if (scannedCount % 1000 === 0) {
                    log(`Scanned ${scannedCount} messages so far...`, 'debug');
                }
                // Check for attachments
                if (message.attachments.size > 0) {
                    for (const [_, attachment] of message.attachments) {
                        const filename = attachment.name;
                        if (filename in inventoryFiles) {
                            const messageTimestamp = message.createdTimestamp;
                            const currentLatest = latestFiles.get(filename);
                            // Always set the message if we haven't found one yet for this file type
                            if (!currentLatest?.message) {
                                latestFiles.set(filename, { message, timestamp: messageTimestamp });
                                log(`Found first instance of ${filename} from ${new Date(messageTimestamp).toLocaleString()}`, 'debug');
                            }
                            // Only update if this message is newer than what we have
                            if (!currentLatest || messageTimestamp > currentLatest.timestamp) {
                                const cachedData = contentCache.inventoryFiles[`inventory_${filename}`];
                                // Only process if the message is newer than our cached version
                                if (!cachedData || messageTimestamp > cachedData.timestamp) {
                                    log(`Found newer file: ${filename} from ${new Date(messageTimestamp).toLocaleString()}`, 'debug');
                                    latestFiles.set(filename, { message, timestamp: messageTimestamp });
                                    foundNewFile = true;
                                }
                                else {
                                    log(`Found older file: ${filename} from ${new Date(messageTimestamp).toLocaleString()}`, 'debug');
                                    log(`Cache version is newer: ${new Date(cachedData.timestamp).toLocaleString()}`, 'debug');
                                }
                            }
                        }
                    }
                }
            }
            // Check if we've found all files
            const allFilesFound = Array.from(latestFiles.values()).every(file => file.message !== null);
            if (allFilesFound) {
                log('Found at least one instance of all inventory files, stopping search', 'success');
                break;
            }
            // If we haven't found any new files in the last batch and we've scanned enough messages,
            // we can assume we won't find newer versions
            if (!foundNewFile && scannedCount >= 1000) {
                log('No new files found in last 1000 messages, stopping search', 'debug');
                break;
            }
            const lastMessage = messages.last();
            if (lastMessage) {
                lastId = lastMessage.id;
            }
        }
        // Process any new files found
        for (const [filename, { message, timestamp }] of latestFiles.entries()) {
            if (message) {
                const attachment = message.attachments.find(a => a.name === filename);
                if (attachment) {
                    const cachedData = contentCache.inventoryFiles[`inventory_${filename}`];
                    if (!cachedData || timestamp > cachedData.timestamp) {
                        log(`Processing new version of ${filename}`, 'success');
                        log(`Message timestamp: ${new Date(timestamp).toLocaleString()}`, 'debug');
                        if (cachedData) {
                            log(`Cache timestamp: ${new Date(cachedData.timestamp).toLocaleString()}`, 'debug');
                        }
                        await inventoryManager.processNewFile(filename, attachment.url);
                        processedCount++;
                    }
                    else {
                        log(`Skipping ${filename} - cache version is newer`, 'debug');
                        log(`Message timestamp: ${new Date(timestamp).toLocaleString()}`, 'debug');
                        log(`Cache timestamp: ${new Date(cachedData.timestamp).toLocaleString()}`, 'debug');
                    }
                }
            }
        }
        log(`Inventory file search complete. Scanned ${scannedCount} messages, processed ${processedCount} new files`, 'stats');
    }
    catch (error) {
        log(`Error searching for inventory files: ${error instanceof Error ? error.message : error}`, 'error');
    }
}
// Function to find the latest raid schedule
async function findLatestRaidSchedule(channel) {
    try {
        log('Starting raid schedule search...', 'debug');
        // Verify channel access
        try {
            await channel.messages.fetch({ limit: 1 });
        }
        catch (error) {
            log(`Error accessing raid schedule channel: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
            log('Please check if the bot has proper permissions in the raid schedule channel', 'warning');
            return;
        }
        let latestMessages = [];
        let totalMessagesScanned = 0;
        let lastMessageId;
        while (totalMessagesScanned < 5000) {
            const options = {
                limit: 100,
                before: lastMessageId
            };
            try {
                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) {
                    log('No more messages to scan in raid schedule channel', 'debug');
                    break;
                }
                totalMessagesScanned += messages.size;
                if (totalMessagesScanned % 1000 === 0) {
                    log(`Scanned ${totalMessagesScanned} messages so far...`, 'debug');
                }
                for (const message of messages.values()) {
                    // Skip bot's own messages
                    if (message.author.id === client.user?.id)
                        continue;
                    // Check for raid schedule in message content
                    const validLines = (0, raidPatternMatcher_1.processRaidScheduleMessage)(message.content);
                    if (validLines.length > 0) {
                        const messageTimestamp = message.createdTimestamp;
                        log(`Found raid schedule from ${message.author.tag} at ${new Date(messageTimestamp).toLocaleString()}`, 'debug');
                        log(`Found ${validLines.length} valid lines in this schedule`, 'debug');
                        latestMessages.push({ message, timestamp: messageTimestamp });
                    }
                }
                lastMessageId = messages.last()?.id;
            }
            catch (error) {
                log(`Error fetching messages: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
                break;
            }
        }
        // Sort messages by timestamp (newest first)
        latestMessages.sort((a, b) => b.timestamp - a.timestamp);
        if (latestMessages.length > 0) {
            // Collect all valid lines from all messages
            const allValidLines = [];
            for (const { message } of latestMessages) {
                const validLines = (0, raidPatternMatcher_1.processRaidScheduleMessage)(message.content);
                allValidLines.push(...validLines);
            }
            // Normalize: trim each event and join with single newlines
            const combinedContent = allValidLines.map(line => line.trim()).join('\n');
            const totalLines = allValidLines.length;
            log(`Combined ${latestMessages.length} raid schedule posts with ${totalLines} total lines`, 'debug');
            try {
                // Check if content has changed
                if (hasRaidScheduleChanged(combinedContent)) {
                    log('New raid schedule found!', 'success');
                    log(`Schedule from: ${latestMessages[0].message.author.tag}`, 'debug');
                    log(`Posted at: ${new Date(latestMessages[0].timestamp).toLocaleString()}`, 'debug');
                    log(`Total events: ${totalLines}`, 'debug');
                    // Update cache
                    contentCache.raidSchedule = {
                        content: combinedContent,
                        timestamp: latestMessages[0].timestamp
                    };
                    await saveCache();
                    // Update local raid schedule file
                    const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, combinedContent);
                    if (updateSuccess) {
                        log('Successfully updated raid schedule file', 'success');
                    }
                    else {
                        log('Raid schedule file unchanged or update failed', 'debug');
                    }
                    // Always process the schedule and update calendar, regardless of file update status
                    await raidManager.processRaidSchedule();
                }
                else {
                    log('No changes detected in raid schedule', 'debug');
                    log(`Current cache has ${contentCache.raidSchedule?.content.split('\n').filter(line => line.trim().length > 0).length || 0} lines`, 'debug');
                    // Even if schedule hasn't changed, still check calendar
                    log('Checking calendar for missing events...', 'debug');
                    await raidManager.processRaidSchedule();
                }
            }
            catch (error) {
                log(`Error processing raid schedule: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
            }
        }
        else {
            log('No raid schedule found in the last 5000 messages', 'warning');
            log(`Current cache has ${contentCache.raidSchedule?.content.split('\n').filter(line => line.trim().length > 0).length || 0} lines`, 'debug');
            log('Please ensure raid schedules are posted with valid format (day, date, time, and targets)', 'info');
        }
        log(`Raid schedule search complete. Scanned ${totalMessagesScanned} messages, found ${latestMessages.length} schedule posts`, 'stats');
    }
    catch (error) {
        log(`Error finding latest raid schedule: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
}
// Function to verify that the raid schedule on GitHub matches the cache, and re-upload if not
async function verifyRaidScheduleOnGitHub() {
    try {
        log('🔍 Verifying raid schedule on GitHub against cache...', 'github');
        const cachedSchedule = contentCache.raidSchedule;
        if (!cachedSchedule) {
            log('No raid schedule in cache to verify.', 'warning');
            return;
        }
        // Fetch the file from GitHub
        let githubContent = '';
        try {
            const { data } = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO_NAME,
                path: RAID_FILE_PATH_STR,
                ref: GITHUB_BRANCH
            });
            if (Array.isArray(data)) {
                log('Raid schedule path on GitHub is a directory, not a file.', 'error');
                return;
            }
            if (data.type === 'file' && data.encoding === 'base64' && data.content) {
                githubContent = Buffer.from(data.content, 'base64').toString();
            }
        }
        catch (error) {
            if (error.status === 404) {
                log('Raid schedule file not found on GitHub, will create it.', 'github');
            }
            else {
                log(`Error fetching raid schedule from GitHub: ${error.message}`, 'error');
                return;
            }
        }
        // Normalize both contents for comparison
        const normalize = (str) => str.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
        if (normalize(githubContent) !== normalize(cachedSchedule.content)) {
            log('Raid schedule on GitHub does not match cache. Re-uploading...', 'github');
            const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, cachedSchedule.content, false, true);
            if (updateSuccess) {
                log('✅ Successfully updated raid schedule on GitHub to match cache.', 'success');
            }
            else {
                log('❌ Failed to update raid schedule on GitHub.', 'error');
            }
        }
        else {
            log('✅ Raid schedule on GitHub matches cache.', 'success');
        }
    }
    catch (error) {
        log(`Error during GitHub raid schedule verification: ${error instanceof Error ? error.message : error}`, 'error');
    }
}
// Main execution block
async function main() {
    client.once('ready', async () => {
        try {
            log('🤖 Bot is ready!');
            // Load cache
            await cacheManager.loadCache();
            // Initialize managers
            const inventoryChannel = await client.channels.fetch(INVENTORY_CHANNEL_ID);
            if (!inventoryChannel) {
                throw new Error('Inventory channel not found');
            }
            const raidChannel = await client.channels.fetch(RAID_SCHEDULE_CHANNEL_ID);
            if (!raidChannel) {
                throw new Error('Raid schedule channel not found');
            }
            const suggestionsChannel = await client.channels.fetch(SUGGESTIONS_CHANNEL_ID);
            if (!suggestionsChannel) {
                throw new Error('Suggestions channel not found');
            }
            const offnightChannel = await client.channels.fetch(OFFNIGHT_CHANNEL_ID);
            if (!offnightChannel) {
                throw new Error('Offnight channel not found');
            }
            inventoryManager = new inventoryManager_1.InventoryManager(fileProcessor, cacheManager, inventoryChannel);
            raidManager = new raidManager_1.RaidManager(fileProcessor, cacheManager, RAID_FILE_PATH_STR, GOOGLE_CALENDAR_ID);
            offnightManager = new offnightManager_1.OffnightManager(OFFNIGHT_CHANNEL_ID, OFFNIGHT_FILE_PATH, cacheManager, GOOGLE_CALENDAR_ID);
            // Initialize suggestions service
            suggestionsService = new suggestionsService_1.SuggestionsService(client, SUGGESTIONS_CHANNEL_ID, {
                keyFile: SUGGESTIONS_CREDENTIALS_PATH,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
            }, SUGGESTIONS_SHEET_ID);
            log('✅ Suggestions service initialized', 'success');
            // Process raid schedule
            log('Starting raid schedule sync...', 'debug');
            await findLatestRaidSchedule(raidChannel);
            log('Raid schedule sync completed', 'success');
            // Periodic GitHub verification for raid schedule (on startup)
            log('Starting GitHub verification...', 'debug');
            await verifyRaidScheduleOnGitHub();
            log('GitHub verification completed', 'success');
            // Process inventory files
            log('Starting inventory sync...', 'debug');
            await findLatestInventoryFiles(inventoryChannel);
            log('Inventory sync completed', 'success');
            // Process offnight threads
            log('Starting offnight sync...', 'debug');
            await offnightManager.findLatestOffnightThreads(offnightChannel);
            log('Offnight sync completed', 'success');
            // Initialize Discord events manager
            discordEventManager = new discordEventManager_1.default({
                guildId: DISCORD_GUILD_ID,
                botToken: DISCORD_TOKEN,
                githubRepo: GITHUB_REPO,
                githubBranch: GITHUB_BRANCH,
                raidChannelId: DISCORD_RAID_CHANNEL_ID,
                offnightChannelId: DISCORD_OFFNIGHT_CHANNEL_ID,
                cacheManager: cacheManager
            });
            // Sync Discord events after all other processes have completed
            try {
                log('Starting Discord events sync...', 'debug');
                await discordEventManager.syncEventsFromFiles();
                log('Discord events sync completed', 'success');
            }
            catch (error) {
                log(`Error syncing Discord events: ${error instanceof Error ? error.message : error}`, 'error');
            }
            // Save cache after all processing is complete
            try {
                await saveCache();
                log('Cache saved after processing', 'success');
            }
            catch (error) {
                log(`Error saving cache: ${error instanceof Error ? error.message : error}`, 'error');
            }
            // Final startup summary
            log('Bot startup completed successfully - all syncs finished', 'success');
            // Set up message handlers
            setupMessageHandlers(inventoryChannel, raidChannel, inventoryManager, raidManager);
            // Set up intervals
            setupIntervals(inventoryManager, raidManager, offnightManager, offnightChannel);
        }
        catch (error) {
            log(`Error during startup: ${error instanceof Error ? error.message : error}`, 'error');
        }
    });
    client.login(DISCORD_TOKEN);
}
main().catch(error => {
    log(`Unhandled error in main execution: ${error instanceof Error ? error.message : error}`, 'error');
    log('Bot will attempt to continue running despite the error', 'warning');
    // Don't exit the process - let it attempt to recover
});
// Cleanup function to be called on shutdown
process.on('SIGINT', () => {
    if (suggestionsService) {
        suggestionsService.stopChecking();
        log('Suggestions service stopped.', 'info');
    }
    if (discordEventManager) {
        log('Discord events manager stopped.', 'info');
    }
    // Save cache before exiting
    saveCache().catch(error => {
        logger_1.logger.error(`Error saving cache during shutdown: ${error instanceof Error ? error.message : error}`);
    });
    log('Bot shutting down gracefully.', 'bot');
    process.exit();
});
function setupMessageHandlers(inventoryChannel, raidChannel, inventoryManager, raidManager) {
    // Handle inventory file updates
    client.on('messageCreate', async (message) => {
        if (message.channel.id !== inventoryChannel.id)
            return;
        if (message.author.id === client.user?.id)
            return; // Skip bot's own messages
        const attachments = message.attachments;
        for (const [_, attachment] of attachments) {
            if (attachment.name?.endsWith('.txt')) {
                try {
                    const response = await fetch(attachment.url);
                    const content = await response.text();
                    await inventoryManager.processNewFile(attachment.name, content);
                }
                catch (error) {
                    log(`Error processing inventory file: ${error instanceof Error ? error.message : error}`, 'error');
                }
            }
        }
    });
    // Handle raid schedule updates
    client.on('messageCreate', async (message) => {
        if (message.channel.id !== raidChannel.id)
            return;
        if (message.author.id === client.user?.id)
            return; // Skip bot's own messages
        // Process raid schedule content
        try {
            await raidManager.processNewSchedule(message.content);
        }
        catch (error) {
            log(`Error processing raid schedule: ${error instanceof Error ? error.message : error}`, 'error');
        }
    });
    // Handle message edits
    client.on('messageUpdate', async (oldMessage, newMessage) => {
        // Ignore if either message is partial or from a bot
        if (oldMessage.partial || newMessage.partial || oldMessage.author?.bot || newMessage.author?.bot)
            return;
        // Handle edited raid schedule messages
        if (newMessage.channel.id === raidChannel.id) {
            log(`\n📝 Raid message edited in #${newMessage.channel.name} by ${newMessage.author.tag}`);
            try {
                await raidManager.processNewSchedule(newMessage.content);
                log('✅ Updated raid schedule after edit.', 'success');
            }
            catch (err) {
                log(`Failed to update raid schedule after edit: ${err instanceof Error ? err.message : err}`, 'error');
            }
        }
        // Handle edited inventory files
        if (newMessage.channel.id === inventoryChannel.id) {
            log(`\n📝 Inventory message edited in #${newMessage.channel.name} by ${newMessage.author.tag}`);
            const attachments = newMessage.attachments;
            for (const [_, attachment] of attachments) {
                if (attachment.name?.endsWith('.txt')) {
                    try {
                        const response = await fetch(attachment.url);
                        const content = await response.text();
                        await inventoryManager.processNewFile(attachment.name, content);
                        log('✅ Updated inventory file after edit.', 'success');
                    }
                    catch (error) {
                        log(`Error processing edited inventory file: ${error instanceof Error ? error.message : error}`, 'error');
                    }
                }
            }
        }
    });
}
function setupIntervals(inventoryManager, raidManager, offnightManager, offnightChannel) {
    // Set up cache cleanup interval
    setInterval(() => {
        cleanupCache(); // Use the local cleanupCache function
        saveCache().catch(error => {
            logger_1.logger.error(`Error saving cache during cleanup: ${error instanceof Error ? error.message : error}`);
        });
    }, 24 * 60 * 60 * 1000); // Run cleanup daily
    // Set up inventory check interval - changed to 30 minutes
    setInterval(async () => {
        try {
            await inventoryManager.processInventoryFiles();
        }
        catch (error) {
            logger_1.logger.error(`Error processing inventory files: ${error instanceof Error ? error.message : error}`);
        }
    }, 30 * 60 * 1000); // Check every 30 minutes
    // Set up raid schedule check interval
    setInterval(async () => {
        try {
            await raidManager.processRaidSchedule();
            // Calendar update happens inside processRaidSchedule, so it will run after the raid schedule is processed
        }
        catch (error) {
            logger_1.logger.error(`Error processing raid schedule: ${error instanceof Error ? error.message : error}`);
        }
    }, 30 * 60 * 1000); // Check every 30 minutes
    // Set up periodic GitHub verification for raid schedule (every 90 minutes)
    setInterval(async () => {
        await verifyRaidScheduleOnGitHub();
    }, 90 * 60 * 1000); // 90 minutes
    // Set up offnight check interval
    setInterval(async () => {
        try {
            await offnightManager.findLatestOffnightThreads(offnightChannel);
        }
        catch (error) {
            logger_1.logger.error(`Error processing offnight threads: ${error instanceof Error ? error.message : error}`);
        }
    }, 60 * 60 * 1000); // Check every 1 hour
    // Set up Discord events sync interval (runs after offnight processing)
    setInterval(async () => {
        if (discordEventManager) {
            try {
                await discordEventManager.syncEventsFromFiles();
                log('✅ Discord events sync completed', 'success');
            }
            catch (error) {
                logger_1.logger.error(`Error syncing Discord events: ${error instanceof Error ? error.message : error}`);
            }
        }
    }, 60 * 60 * 1000); // Check every 1 hour, runs after offnight processing
}
//# sourceMappingURL=index.js.map