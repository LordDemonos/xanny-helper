import * as dotenv from 'dotenv';
dotenv.config();

import { logger } from './utils/logger';
import { CacheManager } from './modules/cache/cacheManager';
import path from 'path';
import DiscordEventManager from './modules/discord-events/discordEventManager';

// This IIFE handles startup flags immediately, before the bot does anything else.
(async () => {
  const CACHE_FILE_PATH_STARTUP = process.env.CACHE_FILE_PATH || path.join(process.cwd(), 'cache', 'content-cache.json');
  if (process.argv.includes('--clear-offnight-cache')) {
    logger.info('Received --clear-offnight-cache flag. Clearing cache and exiting...');
    const cacheManager = new CacheManager(CACHE_FILE_PATH_STARTUP);
    await cacheManager.loadCache();
    cacheManager.clearOffnightCache();
    await cacheManager.saveCache();
    logger.info('Offnight cache cleared successfully. Exiting now.');
    process.exit(0);
  }
  if (process.argv.includes('--clear-raid-cache')) {
    logger.info('Received --clear-raid-cache flag. Clearing raid schedule from cache and exiting...');
    const cacheManager = new CacheManager(CACHE_FILE_PATH_STARTUP);
    await cacheManager.loadCache();
    cacheManager.clearRaidCache();
    await cacheManager.saveCache();
    logger.info('Raid schedule cache cleared successfully. Exiting now.');
    process.exit(0);
  }
})();

// These are now initialized here and will be assigned in main()
let suggestionsService: SuggestionsService | null = null;
let discordEventManager: DiscordEventManager | null = null;
let respawnCommandHandler: RespawnCommandHandler | null = null;
let respawnCalculator: RespawnCalculator | null = null;

import { Client, GatewayIntentBits, TextChannel, Message } from 'discord.js';
import { Octokit } from '@octokit/rest';
import fs from 'fs';
import { verifyGitHubUpload, retryWithBackoff } from './utils/verification';
import { createHash } from 'crypto';
import { FileProcessor } from './utils/fileProcessor';
import { InventoryManager } from './modules/inventory/inventoryManager';
import { RaidManager } from './modules/raid/raidManager';
import { OffnightManager } from './modules/offnight/offnightManager';
import { SuggestionsService } from './features/suggestions/suggestionsService';
import { processRaidScheduleMessage, sortRaidScheduleByDate } from './modules/raid/raidPatternMatcher';
import { BossDataManager } from './modules/boss-respawn/bossDataManager';
import { MessageParser } from './modules/boss-respawn/messageParser';
import { RespawnCalculator } from './modules/boss-respawn/respawnCalculator';
import { RespawnCommandHandler } from './modules/boss-respawn/respawnCommand';
import { NoteCache } from './modules/boss-respawn/noteCache';
import { getTodayESTDateString, isRaidDay, getRaidNightLockouts } from './modules/raid/raidNightLockouts';

const {
  DISCORD_TOKEN,
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_BRANCH = 'master',
  GOOGLE_CALENDAR_ID,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  INVENTORY_CHANNEL_ID,
  RAID_SCHEDULE_CHANNEL_ID,
  OFFNIGHT_CHANNEL_ID,
  OFFNIGHT_FILE_PATH,
  SUGGESTIONS_CHANNEL_ID,
  SUGGESTIONS_SHEET_ID,
  SUGGESTIONS_CREDENTIALS_PATH = './GOOGLE_CREDENTIALS.json',
  RAID_FILE_PATH,
  DISCORD_GUILD_ID,
  DISCORD_RAID_CHANNEL_ID,
  DISCORD_OFFNIGHT_CHANNEL_ID,
  ENABLE_CALENDAR_FUNCTIONS = 'true',
  ENABLE_OFFNIGHT_FILE_OPERATIONS = 'true',
  DISCORD_EVENTS_ENABLED = 'true',
  TARGET_TRACKING_CHANNEL_ID,
  BOSS_TRACKER_DATA_PATH,
  BOSS_COMMAND_CHANNELS
} = process.env;

// Extract owner and repo from GITHUB_REPO
const [GITHUB_OWNER, GITHUB_REPO_NAME] = GITHUB_REPO!.split('/');

// Feature flags - robust parsing for Docker environment variables
const CALENDAR_FUNCTIONS_ENABLED = ENABLE_CALENDAR_FUNCTIONS?.toLowerCase().trim() === 'true';
const OFFNIGHT_FILE_OPERATIONS_ENABLED = ENABLE_OFFNIGHT_FILE_OPERATIONS?.toLowerCase().trim() === 'true';
const DISCORD_EVENTS_ENABLED_FLAG = DISCORD_EVENTS_ENABLED?.toLowerCase().trim() === 'true';

// Debug logging for environment variables (can be removed after testing)
// console.log('🔧 Environment Variables Debug:');
// console.log(`  ENABLE_OFFNIGHT_FILE_OPERATIONS (raw): "${ENABLE_OFFNIGHT_FILE_OPERATIONS}"`);
// console.log(`  ENABLE_OFFNIGHT_FILE_OPERATIONS (processed): ${OFFNIGHT_FILE_OPERATIONS_ENABLED}`);
// console.log(`  DISCORD_EVENTS_ENABLED (raw): "${DISCORD_EVENTS_ENABLED}"`);
// console.log(`  DISCORD_EVENTS_ENABLED (processed): ${DISCORD_EVENTS_ENABLED_FLAG}`);

// Validate GitHub configuration
if (!GITHUB_OWNER || !GITHUB_REPO_NAME) {
  throw new Error('Invalid GITHUB_REPO format. Expected format: owner/repo');
}

if (!DISCORD_TOKEN || !RAID_SCHEDULE_CHANNEL_ID || !INVENTORY_CHANNEL_ID || !GITHUB_TOKEN || !GITHUB_REPO || !RAID_FILE_PATH || !GOOGLE_CALENDAR_ID || !SUGGESTIONS_CHANNEL_ID || !SUGGESTIONS_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !OFFNIGHT_CHANNEL_ID || !OFFNIGHT_FILE_PATH || !DISCORD_GUILD_ID || !DISCORD_RAID_CHANNEL_ID || !DISCORD_OFFNIGHT_CHANNEL_ID) {
  throw new Error('Missing required environment variables.');
}

// Add type assertion for RAID_FILE_PATH
const RAID_FILE_PATH_STR = RAID_FILE_PATH as string;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Cache structure
interface ContentCache {
  raidSchedule: {
    content: string;
    timestamp: number;
    verification?: {
      checksum: string;
      lastVerified: number;
      status: 'success' | 'failed';
      error?: string;
    };
  } | null;
  inventoryFiles: {
    [key: string]: {
      content: string;
      timestamp: number;
      verification?: {
        checksum: string;
        lastVerified: number;
        status: 'success' | 'failed';
        error?: string;
      };
    };
  };
}

// Initialize cache
let contentCache: ContentCache = {
  raidSchedule: null,
  inventoryFiles: {}
};

// Cache file path (use process.cwd() so it's stable across restarts and ts-node vs node)
const CACHE_FILE_PATH = process.env.CACHE_FILE_PATH || path.join(process.cwd(), 'cache', 'content-cache.json');

// Cache cleanup settings
const CACHE_CLEANUP_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Ensure cache directory exists
function ensureCacheDirectory(): void {
  const cacheDir = path.dirname(CACHE_FILE_PATH);
  if (!fs.existsSync(cacheDir)) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      logger.info('Created cache directory');
    } catch (error) {
      logger.error(`Failed to create cache directory: ${error instanceof Error ? error.message : error}`);
      throw error; // Re-throw to handle in the calling function
    }
  }
}

// Initialize file processor with proper error handling
const fileProcessor = new FileProcessor(
  octokit,
  GITHUB_OWNER,
  GITHUB_REPO_NAME,
  GITHUB_BRANCH
);

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
const cacheManager = new CacheManager(CACHE_FILE_PATH);

// Initialize managers
let inventoryManager: InventoryManager;
let raidManager: RaidManager;
let offnightManager: OffnightManager;

// Logging utility
function log(message: string | Error, type: 'info' | 'error' | 'success' | 'warning' | 'bot' | 'cache' | 'file' | 'github' | 'calendar' | 'discord' | 'time' | 'search' | 'verify' | 'update' | 'stats' | 'debug' = 'info'): void {
  const timestamp = new Date().toLocaleString();
  const prefix = {
    // Status/Progress
    info: '📋',      // General information
    debug: '🔍',     // Detailed debugging (reduced verbosity)
    
    // Success
    success: '✅',    // Operation completed successfully
    
    // Warnings
    warning: '⚠️',    // Warning about potential issues
    
    // Errors
    error: '❌',      // Operation failed
    
    // Special categories
    bot: '🤖',       // Bot status messages
    cache: '💾',     // Cache operations
    file: '📄',      // File operations
    github: '🔗',    // GitHub operations
    calendar: '📅',  // Calendar operations
    discord: '💬',   // Discord operations
    time: '⏰',      // Time-related messages
    search: '🔎',    // Search operations
    verify: '✓',     // Verification operations
    update: '🔄',    // Update operations
    stats: '📊'      // Statistics/summary
  }[type];
  
  const messageText = message instanceof Error ? message.message : message;
  
  // Only log info and debug messages if explicitly requested or in development
  if (type === 'info' || type === 'debug') {
    // In production, these would be filtered out or sent to debug level
    // For now, we'll keep them but they can be easily removed
    console.log(`${prefix} [${timestamp}] ${messageText}`);
  } else {
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
    logger.info(`Cleaned up ${cleanedCount} old cache entries`);
  }
}

// Save cache to file (merge contentCache with cacheManager so raidNightSchedules etc. are preserved)
async function saveCache() {
  try {
    ensureCacheDirectory();
    cleanupCache(); // Clean up old entries before saving
    const full = cacheManager.getCache();
    if (contentCache.raidSchedule != null) full.raidSchedule = contentCache.raidSchedule;
    if (contentCache.inventoryFiles && Object.keys(contentCache.inventoryFiles).length > 0) {
      full.inventoryFiles = contentCache.inventoryFiles;
    }
    // Always write current raid night schedules so they persist across restarts
    const raidSchedules = cacheManager.getRaidNightSchedules();
    full.raidNightSchedules = raidSchedules.length ? Object.fromEntries(raidSchedules.map(e => [e.id, e])) : {};
    await fs.promises.writeFile(
      CACHE_FILE_PATH,
      JSON.stringify(full, null, 2)
    );
  } catch (error) {
    logger.error(`Failed to save cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

const EST_TZ = 'America/New_York';

/** Get hour and minute in EST (America/New_York) for a given Date. Clamped to 0–23 and 0–59. */
function getTimeESTFor(date: Date): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: EST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  // Some locales format midnight as "24" in 24h mode; treat as 0 so we don't think it's 11 PM
  if (hour === 24) hour = 0;
  hour = Math.min(23, Math.max(0, hour));
  const minute = Math.min(59, Math.max(0, parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)));
  return { hour, minute };
}

/** Get current hour and minute in EST (America/New_York). Clamped to 0–23 and 0–59. */
function getCurrentTimeEST(): { hour: number; minute: number } {
  return getTimeESTFor(new Date());
}

/** Minutes since midnight EST (0–1439). Used for reliable "has scheduled time passed?" check. */
function getCurrentMinutesSinceMidnightEST(): number {
  const { hour, minute } = getCurrentTimeEST();
  return hour * 60 + minute;
}

/** Minutes since midnight EST (0–1439) for an arbitrary timestamp. */
function getMinutesSinceMidnightESTFromTimestamp(ms: number): number {
  const { hour, minute } = getTimeESTFor(new Date(ms));
  return hour * 60 + minute;
}

/** Date string in EST (YYYY-MM-DD) for an arbitrary timestamp. */
function getDateStringESTFromTimestamp(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: EST_TZ });
}

/** Format minutes since midnight (0–1439) as "H:MM AM/PM" for logging. */
function formatMinutesAsEST(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  if (h === 0) return `12:${String(m).padStart(2, '0')} AM`;
  if (h < 12) return `${h}:${String(m).padStart(2, '0')} AM`;
  if (h === 12) return `12:${String(m).padStart(2, '0')} PM`;
  return `${h - 12}:${String(m).padStart(2, '0')} PM`;
}

/** Grace period after scheduler start: don't post in the first N ms (avoids posting on startup). */
const RAID_NIGHT_SCHEDULER_GRACE_MS = 2 * 60 * 1000;

/**
 * One tick of the raid night scheduler: post lockouts to scheduled channels when it's a raid day and time has been reached.
 */
async function runRaidNightSchedulerTick(
  client: Client,
  cacheManager: CacheManager,
  bossDataManager: BossDataManager,
  respawnCalculator: RespawnCalculator,
  schedulerStartedAt: number
): Promise<void> {
  const scheduleContent = cacheManager.getRaidSchedule()?.content ?? null;
  if (!scheduleContent?.trim()) return;
  const todayStr = getTodayESTDateString();
  if (!isRaidDay(scheduleContent, todayStr)) {
    logger.debug(`Raid night scheduler: skipping (today ${todayStr} is not a raid day)`);
    return;
  }
  if (Date.now() - schedulerStartedAt < RAID_NIGHT_SCHEDULER_GRACE_MS) {
    logger.debug('Raid night scheduler: skipping (within startup grace period)');
    return;
  }

  const currentMins = getCurrentMinutesSinceMidnightEST();
  const schedules = cacheManager.getRaidNightSchedules();
  const result = getRaidNightLockouts(scheduleContent, bossDataManager, respawnCalculator);
  if (!result.success) return;

  for (const entry of schedules) {
    if (entry.lastPostedDate === todayStr) {
      logger.debug(`Raid night scheduler: skipping channel ${entry.channelId} (already posted for ${todayStr})`);
      continue;
    }
    const sh = Number(entry.timeEST?.hour ?? 0);
    const sm = Number(entry.timeEST?.minute ?? 0);
    const scheduledMins = Math.min(1439, Math.max(0, sh * 60 + sm));

    // If this schedule was created after today's scheduled time (in EST), skip posting today.
    // This prevents retroactive posts when you add a schedule later in the day; first post will be on the next raid day.
    const createdDateStr = getDateStringESTFromTimestamp(entry.createdAt);
    const createdMins = getMinutesSinceMidnightESTFromTimestamp(entry.createdAt);
    if (createdDateStr === todayStr && createdMins >= scheduledMins) {
      logger.debug(
        `Raid night scheduler: schedule ${entry.id} was created after today's scheduled time; ` +
        'first automatic post will be on the next raid day.'
      );
      continue;
    }

    if (currentMins < scheduledMins) {
      logger.debug(
        `Raid night scheduler: not yet time for channel ${entry.channelId} — ` +
        `current EST ${formatMinutesAsEST(currentMins)}, scheduled ${formatMinutesAsEST(scheduledMins)} (stored hour=${sh}, minute=${sm})`
      );
      continue;
    }

    try {
      const channel = await client.channels.fetch(entry.channelId);
      if (!channel || !('send' in channel)) continue;
      const channelLabel = channel && 'name' in channel ? `#${(channel as { name: string }).name}` : entry.channelId;
      logger.info(`Raid night scheduler: posting to ${channelLabel} — current EST ${formatMinutesAsEST(currentMins)}, scheduled ${formatMinutesAsEST(scheduledMins)} (stored hour=${sh}, minute=${sm})`);
      await channel.send(result.message);
      cacheManager.updateRaidNightScheduleLastPosted(entry.id, todayStr);
      await cacheManager.saveCache();
    } catch (err) {
      logger.error(`Raid night scheduler: failed to post to ${entry.channelId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// Function to check if raid schedule has changed
function hasRaidScheduleChanged(newSchedule: string): boolean {
  // Normalize the content by trimming whitespace and normalizing line endings
  const normalizeContent = (content: string) => 
    content.split('\n')
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
    } else {
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
        const oldEvent = oldEvents.find(old => 
          old.split(':')[0] === newEvent.split(':')[0] && 
          old !== newEvent
        );
        return oldEvent !== undefined;
      });
      if (modifiedEvents.length > 0) {
        log(`Modified ${modifiedEvents.length} events:`, 'warning');
        modifiedEvents.forEach(event => log(`  - ${event.trim()}`, 'debug'));
      }
      
      // Summary
      log(`Raid schedule changes: ${addedEvents.length} added, ${removedEvents.length} removed, ${modifiedEvents.length} modified`, 'stats');
    }
  } else {
    log('No changes detected in raid schedule content', 'debug');
    if (contentCache.raidSchedule) {
      log(`Cache timestamp: ${new Date(contentCache.raidSchedule.timestamp).toLocaleString()}`, 'debug');
    }
  }
  return hasChanged;
}

async function updateGithubFile(
  path: string,
  content: string,
  append: boolean = false,
  force: boolean = false
): Promise<boolean> {
  try {
    // Check if content has changed
    const cacheKey = path;
    const cachedData = contentCache.inventoryFiles[cacheKey];
    const currentChecksum = createHash('sha256').update(content).digest('hex');
    
    // Skip cache check for raid schedule unless force is true
    if (!force) {
      if (path === RAID_FILE_PATH_STR) {
        if (contentCache.raidSchedule?.content === content) {
          logger.info(`Skipping update for ${path} - content unchanged`);
          return false;
        }
      } else if (cachedData?.verification?.checksum === currentChecksum) {
        logger.info(`Skipping update for ${path} - content unchanged`);
        return false;
      }
    }

    // Wrap the upload operation in retry logic
    const result = await retryWithBackoff(async () => {
      // Get current file SHA and content if it exists
      let currentSha: string | undefined;
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
      } catch (error: any) {
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
      const verification = await verifyGitHubUpload(
        octokit,
        GITHUB_OWNER,
        GITHUB_REPO_NAME,
        path,
        finalContent,
        cachedData?.verification,
        GITHUB_BRANCH
      );

      if (!verification.success) {
        throw new Error(`Verification failed: ${verification.error}`);
      }

      // Update cache with verification data
      if (path === RAID_FILE_PATH_STR) {
        contentCache.raidSchedule = {
          content: finalContent,
          timestamp: Date.now()
        };
        cacheManager.updateRaidSchedule(finalContent, Date.now());
      } else {
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to update ${path}: ${errorMessage}`);
    
    // Update cache with failed verification
    if (path === RAID_FILE_PATH_STR) {
      contentCache.raidSchedule = {
        content,
        timestamp: Date.now()
      };
      cacheManager.updateRaidSchedule(content, Date.now());
    } else {
      const cacheKey = path;
      contentCache.inventoryFiles[cacheKey] = {
        content,
        timestamp: Date.now(),
        verification: {
          checksum: createHash('sha256').update(content).digest('hex'),
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
async function verifyGitHubState(): Promise<void> {
  try {
    log('Starting GitHub state verification...', 'debug');
    
    const inventoryFiles = {
      'Fggems-Inventory.txt': 'assets/data/Fggems-Inventory.txt',
      'Fsbank-Inventory.txt': 'assets/data/Fsbank-Inventory.txt',
      'Fgspells-Inventory.txt': 'assets/data/Fgspells-Inventory.txt',
      'Fgspellsdump-Inventory.txt': 'assets/data/Fgspellsdump-Inventory.txt'
    } as const;

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
            } else {
              log(`Cache verified for ${filename} - content and timestamp match GitHub`, 'success');
              log(`Last updated: ${new Date(githubTimestamp).toLocaleString()}`, 'debug');
              verifiedCount++;
            }
          } else {
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
      } catch (error: any) {
        if (error.status === 404) {
          log(`File ${filename} not found in GitHub repository`, 'warning');
          log('Will look for this file in Discord channel', 'debug');
          missingCount++;
        } else {
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
  } catch (error) {
    log('Error during GitHub verification:', 'error');
    log(`Message: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    log('Stack trace:', 'error');
    log(error instanceof Error ? error.stack || 'No stack trace available' : 'No stack trace available', 'error');
  }
}

// Function to find latest inventory files in Discord channel
async function findLatestInventoryFiles(channel: TextChannel): Promise<void> {
  try {
    // First verify GitHub state against cache
    await verifyGitHubState();
    
    log('Starting inventory file search...', 'debug');
    
    const inventoryFiles = {
      'Fggems-Inventory.txt': 'assets/data/Fggems-Inventory.txt',
      'Fsbank-Inventory.txt': 'assets/data/Fsbank-Inventory.txt',
      'Fgspells-Inventory.txt': 'assets/data/Fgspells-Inventory.txt',
      'Fgspellsdump-Inventory.txt': 'assets/data/Fgspellsdump-Inventory.txt'
    } as const;

    // Initialize Map to store latest message and timestamp for each file
    const latestFiles = new Map<string, { message: Message | null; timestamp: number }>();
    
    // Initialize with null values for each file type
    Object.keys(inventoryFiles).forEach(filename => {
      latestFiles.set(filename, { message: null, timestamp: 0 });
    });

    let lastId: string | undefined;
    let scannedCount = 0;
    let processedCount = 0;
    const BATCH_SIZE = 100;
    const MAX_MESSAGES = 5000;

    while (scannedCount < MAX_MESSAGES) {
      const options: { limit: number; before?: string } = { limit: BATCH_SIZE };
      if (lastId) {
        options.before = lastId;
      }

      const messages = await channel.messages.fetch(options);
      if (messages.size === 0) break;

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
                } else {
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
                
                // Download the file content from Discord
                try {
                  const response = await fetch(attachment.url);
                  if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
                  }
                  const content = await response.text();
                  await inventoryManager.processNewFile(filename, content);
                  processedCount++;
                } catch (error) {
                  log(`Error downloading file content for ${filename}: ${error instanceof Error ? error.message : error}`, 'error');
                }
              } else {
                log(`Skipping ${filename} - cache version is newer`, 'debug');
                log(`Message timestamp: ${new Date(timestamp).toLocaleString()}`, 'debug');
                log(`Cache timestamp: ${new Date(cachedData.timestamp).toLocaleString()}`, 'debug');
              }
            }
          }
        }

    log(`Inventory file search complete. Scanned ${scannedCount} messages, processed ${processedCount} new files`, 'stats');
  } catch (error) {
    log(`Error searching for inventory files: ${error instanceof Error ? error.message : error}`, 'error');
  }
}

// Function to find the latest raid schedule
async function findLatestRaidSchedule(channel: TextChannel): Promise<void> {
  try {
    log('Starting raid schedule search...', 'debug');
    
    // Verify channel access
    try {
      await channel.messages.fetch({ limit: 1 });
    } catch (error) {
      log(`Error accessing raid schedule channel: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      log('Please check if the bot has proper permissions in the raid schedule channel', 'warning');
      return;
    }

    let latestMessages: { message: Message<true>; timestamp: number }[] = [];
    let totalMessagesScanned = 0;
    let lastMessageId: string | undefined;

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
          if (message.author.id === client.user?.id) continue;

          // Check for raid schedule in message content
          const validLines = processRaidScheduleMessage(message.content);
          if (validLines.length > 0) {
            const messageTimestamp = message.createdTimestamp;
            log(`Found raid schedule from ${message.author.tag} at ${new Date(messageTimestamp).toLocaleString()}`, 'debug');
            log(`Found ${validLines.length} valid lines in this schedule`, 'debug');
              
            latestMessages.push({ message, timestamp: messageTimestamp });
          }
        }

        lastMessageId = messages.last()?.id;
      } catch (error) {
        log(`Error fetching messages: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        break;
      }
    }

    // Sort messages by timestamp (newest first)
    latestMessages.sort((a, b) => b.timestamp - a.timestamp);

    if (latestMessages.length > 0) {
      // Collect all valid lines from all messages
      const allValidLines: string[] = [];
      for (let i = 0; i < latestMessages.length; i++) {
        const { message } = latestMessages[i];
        const validLines = processRaidScheduleMessage(message.content);
        allValidLines.push(...validLines);
      }
      
      // Sort by date and group by week with blank lines between weeks
      const sortedLines = sortRaidScheduleByDate(allValidLines);
      
      // Normalize: trim non-empty lines, preserve blank lines for week separation
      const combinedContent = sortedLines
        .map(line => line === '' ? '' : line.trim())
        .join('\n');
      const totalLines = sortedLines.filter(line => line !== '').length;
      log(`Combined ${latestMessages.length} raid schedule posts with ${totalLines} total lines`, 'debug');
      try {
        // Validate that we have valid raid schedule entries
        if (totalLines === 0) {
          log('⚠️ No valid raid schedule entries found in parsed messages', 'warning');
          log(`Schedule from: ${latestMessages[0].message.author.tag}`, 'debug');
          log(`Posted at: ${new Date(latestMessages[0].timestamp).toLocaleString()}`, 'debug');
          log('Appending error message to GitHub file instead of overwriting', 'warning');
          
          // Fetch current GitHub file content and append error message
          try {
            let existingContent = '';
            try {
              const { data } = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO_NAME,
                path: RAID_FILE_PATH_STR,
                ref: GITHUB_BRANCH
              });
              
              if (Array.isArray(data)) {
                throw new Error('Raid schedule path on GitHub is a directory, not a file.');
              }
              
              if (data.type === 'file' && data.encoding === 'base64' && data.content) {
                existingContent = Buffer.from(data.content, 'base64').toString();
              }
            } catch (error: any) {
              if (error.status === 404) {
                log('Raid schedule file not found on GitHub, creating new file with error message', 'github');
                existingContent = '';
              } else {
                throw error;
              }
            }
            
            // Append error message with timestamp
            const errorMessage = `\n\n<!-- Error: Could not parse new raid schedule - ${new Date().toLocaleString()} -->`;
            const errorContent = existingContent + errorMessage;
            
            // Update GitHub file with error message appended
            const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, errorContent, false, true);
            if (updateSuccess) {
              log('✅ Appended error message to raid schedule file on GitHub', 'success');
            } else {
              log('Failed to append error message to GitHub file', 'error');
            }
          } catch (error) {
            log(`Error appending error message to GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
          }
          
          // Do NOT update cache or process schedule if parsing failed
          return;
        }
        
        // Check if content has changed
        if (hasRaidScheduleChanged(combinedContent)) {
          log('New raid schedule found!', 'success');
          log(`Schedule from: ${latestMessages[0].message.author.tag}`, 'debug');
          log(`Posted at: ${new Date(latestMessages[0].timestamp).toLocaleString()}`, 'debug');
          log(`Total events: ${totalLines}`, 'debug');
          // Update cache (both in-memory caches so /raidnight sees latest)
          contentCache.raidSchedule = {
            content: combinedContent,
            timestamp: latestMessages[0].timestamp
          };
          cacheManager.updateRaidSchedule(combinedContent, latestMessages[0].timestamp);
          await saveCache();
          // Update local raid schedule file
          const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, combinedContent);
          if (updateSuccess) {
            log('Successfully updated raid schedule file', 'success');
          } else {
            log('Raid schedule file unchanged or update failed', 'debug');
          }
          // Always process the schedule and update calendar, regardless of file update status
          await raidManager.processRaidSchedule();
        } else {
          log('No changes detected in raid schedule', 'debug');
          log(`Current cache has ${contentCache.raidSchedule?.content.split('\n').filter(line => line.trim().length > 0).length || 0} lines`, 'debug');
          // Even if schedule hasn't changed, still check calendar
          log('Checking calendar for missing events...', 'debug');
          await raidManager.processRaidSchedule();
        }
      } catch (error) {
        log(`Error processing raid schedule: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    } else {
      log('No raid schedule found in the last 5000 messages', 'warning');
      log(`Current cache has ${contentCache.raidSchedule?.content.split('\n').filter(line => line.trim().length > 0).length || 0} lines`, 'debug');
      log('Please ensure raid schedules are posted with valid format (day, date, time, and targets)', 'info');
    }

    log(`Raid schedule search complete. Scanned ${totalMessagesScanned} messages, found ${latestMessages.length} schedule posts`, 'stats');
  } catch (error) {
    log(`Error finding latest raid schedule: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  }
}

// Function to check if the GitHub file is properly sorted and fix it if needed
async function checkAndFixRaidScheduleSorting(): Promise<boolean> {
  try {
    log('🔍 Checking raid schedule sorting on GitHub...', 'github');
    
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
        return false;
      }
      if (data.type === 'file' && data.encoding === 'base64' && data.content) {
        githubContent = Buffer.from(data.content, 'base64').toString();
      }
    } catch (error: any) {
      if (error.status === 404) {
        log('Raid schedule file not found on GitHub.', 'github');
        return false;
      } else {
        log(`Error fetching raid schedule from GitHub: ${error.message}`, 'error');
        return false;
      }
    }
    
    if (!githubContent || githubContent.trim().length === 0) {
      log('Raid schedule file on GitHub is empty.', 'github');
      return false;
    }
    
    // Parse the GitHub content into lines
    const githubLines = githubContent.split('\n').map(line => line.trim());
    
    // Extract all raid schedule lines (filter out blank lines and non-raid lines)
    const githubRaidLines = githubLines.filter(line => {
      if (line === '') return false; // Blank lines will be added back by sorting function
      // Check if it's a valid raid schedule line (starts with - or • and has a date)
      return (line.startsWith('-') || line.startsWith('•')) && /\d{1,2}\/\d{1,2}/.test(line);
    });
    
    if (githubRaidLines.length === 0) {
      log('No valid raid schedule entries found in GitHub file.', 'github');
      return false;
    }
    
    // Sort the content using our sorting function (it will add blank lines between weeks)
    const sortedLines = sortRaidScheduleByDate(githubRaidLines);
    
    // Normalize both for comparison (ignore blank lines and just compare raid entries in order)
    const normalize = (lines: string[]) => lines.filter(l => l.trim().length > 0).join('\n');
    const githubNormalized = normalize(githubRaidLines);
    const sortedNormalized = normalize(sortedLines);
    
    // Check if sorting is needed
    if (githubNormalized !== sortedNormalized) {
      log('⚠️ Raid schedule on GitHub is not properly sorted. Fixing...', 'warning');
      log(`Found ${githubRaidLines.length} raid entries that need sorting`, 'debug');
      
      // Create the corrected content with proper week separation
      const correctedContent = sortedLines
        .map(line => line === '' ? '' : line.trim())
        .join('\n');
      
      // Update GitHub with corrected content
      const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, correctedContent, false, true);
      if (updateSuccess) {
        log('✅ Successfully fixed and updated raid schedule sorting on GitHub.', 'success');
        
        // Update cache with corrected content (both caches so /raidnight sees it)
        contentCache.raidSchedule = {
          content: correctedContent,
          timestamp: Date.now()
        };
        cacheManager.updateRaidSchedule(correctedContent, Date.now());
        await saveCache();
        
        return true;
      } else {
        log('❌ Failed to update raid schedule on GitHub.', 'error');
        return false;
      }
    } else {
      log('✅ Raid schedule on GitHub is properly sorted.', 'success');
      return false; // No fix was needed
    }
  } catch (error) {
    log(`Error checking raid schedule sorting: ${error instanceof Error ? error.message : error}`, 'error');
    return false;
  }
}

// Function to verify that the raid schedule on GitHub matches the cache, and re-upload if not
async function verifyRaidScheduleOnGitHub() {
  try {
    // First check and fix sorting if needed
    const sortingFixed = await checkAndFixRaidScheduleSorting();
    if (sortingFixed) {
      // If we fixed sorting, skip the cache comparison since we just updated it
      return;
    }
    
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
    } catch (error: any) {
      if (error.status === 404) {
        log('Raid schedule file not found on GitHub, will create it.', 'github');
      } else {
        log(`Error fetching raid schedule from GitHub: ${error.message}`, 'error');
        return;
      }
    }
    // Normalize both contents for comparison
    const normalize = (str: string) => str.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
    if (normalize(githubContent) !== normalize(cachedSchedule.content)) {
      log('Raid schedule on GitHub does not match cache. Re-uploading...', 'github');
      const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, cachedSchedule.content, false, true);
      if (updateSuccess) {
        log('✅ Successfully updated raid schedule on GitHub to match cache.', 'success');
      } else {
        log('❌ Failed to update raid schedule on GitHub.', 'error');
      }
    } else {
      log('✅ Raid schedule on GitHub matches cache.', 'success');
    }
  } catch (error) {
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
      const inventoryChannel = await client.channels.fetch(INVENTORY_CHANNEL_ID!) as TextChannel;
      if (!inventoryChannel) {
        throw new Error('Inventory channel not found');
      }
      
      const raidChannel = await client.channels.fetch(RAID_SCHEDULE_CHANNEL_ID!) as TextChannel;
      if (!raidChannel) {
        throw new Error('Raid schedule channel not found');
      }

      const suggestionsChannel = await client.channels.fetch(SUGGESTIONS_CHANNEL_ID!) as TextChannel;
      if (!suggestionsChannel) {
        throw new Error('Suggestions channel not found');
      }

      const offnightChannel = await client.channels.fetch(OFFNIGHT_CHANNEL_ID!) as TextChannel;
      if (!offnightChannel) {
        throw new Error('Offnight channel not found');
      }
      
      inventoryManager = new InventoryManager(
        fileProcessor,
        cacheManager,
        inventoryChannel
      );
      
      raidManager = new RaidManager(
        fileProcessor,
        cacheManager,
        RAID_FILE_PATH_STR,
        GOOGLE_CALENDAR_ID!,
        CALENDAR_FUNCTIONS_ENABLED
      );

      offnightManager = new OffnightManager(
        OFFNIGHT_CHANNEL_ID!,
        OFFNIGHT_FILE_PATH!,
        cacheManager,
        GOOGLE_CALENDAR_ID!,
        OFFNIGHT_FILE_OPERATIONS_ENABLED,
        CALENDAR_FUNCTIONS_ENABLED
      );

      // Initialize suggestions service
      suggestionsService = new SuggestionsService(
        client,
        SUGGESTIONS_CHANNEL_ID!,
        {
          keyFile: SUGGESTIONS_CREDENTIALS_PATH!,
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
        },
        SUGGESTIONS_SHEET_ID!
      );
      log('✅ Suggestions service initialized', 'success');

      // Initialize boss respawn tracker (if configured)
      if (TARGET_TRACKING_CHANNEL_ID) {
        try {
          log('Boss respawn tracker initializing...', 'info');
          
          // Determine boss data path: use env var if set, otherwise use local data file
          const bossDataPath = BOSS_TRACKER_DATA_PATH || path.join(__dirname, '..', 'data', 'default_bosses.json');
          log(`Using boss data file: ${bossDataPath}`, 'debug');
          
          // Initialize note cache (shared between boss data manager and respawn calculator)
          const noteCache = new NoteCache();
          
          // Initialize boss data manager
          const bossDataManager = new BossDataManager(bossDataPath, noteCache);
          bossDataManager.loadBossData();
          
          // Initialize respawn calculator (shares note cache)
          respawnCalculator = new RespawnCalculator(bossDataManager, noteCache);
          
          // Parse allowed channels
          const allowedChannels = BOSS_COMMAND_CHANNELS
            ? BOSS_COMMAND_CHANNELS.split(',').map(id => id.trim()).filter(id => id.length > 0)
            : [];
          
          if (allowedChannels.length === 0) {
            log('⚠️ BOSS_COMMAND_CHANNELS not set - commands will work in all channels (except target-tracking)', 'warning');
          }
          
          // Initialize command handler
          respawnCommandHandler = new RespawnCommandHandler(
            bossDataManager,
            respawnCalculator,
            allowedChannels,
            TARGET_TRACKING_CHANNEL_ID,
            noteCache,
            cacheManager
          );
          
          // Register slash commands
          if (client.user && DISCORD_GUILD_ID) {
            await respawnCommandHandler.registerCommands(client.user.id, DISCORD_TOKEN!, DISCORD_GUILD_ID);
            log('✅ Boss respawn slash commands registered', 'success');
          }
          
          // Get target-tracking channel
          const targetTrackingChannel = await client.channels.fetch(TARGET_TRACKING_CHANNEL_ID) as TextChannel;
          if (!targetTrackingChannel) {
            throw new Error('Target-tracking channel not found');
          }
          
          // Initialize message parser
          const messageParser = new MessageParser();
          
          // Scan last 30 days of messages on startup to cache kill history
          // Keeps a record of bosses that haven't been killed recently so we still have data a few weeks back
          log('Starting startup scan of target-tracking channel (last 30 days)...', 'info');
          log(`Scanning channel: ${targetTrackingChannel.name} (ID: ${targetTrackingChannel.id})`, 'info');
          const kills = await messageParser.scanChannelHistory(targetTrackingChannel, 30);
          
          log(`Startup scan found ${kills.length} kill messages`, 'info');
          if (kills.length > 0) {
            log('Kills found during startup scan:', 'info');
            kills.forEach((kill, index) => {
              const identifier = kill.note ? `${kill.bossName} (${kill.note})` : kill.bossName;
              log(`  ${index + 1}. ${identifier} - ${kill.location || 'unknown'} - ${kill.killTime.toISOString()} (source: ${kill.source})`, 'info');
            });
          }
          
          // Record newest first so same-boss kills end up with the latest time (fetch order is not guaranteed)
          const killsNewestFirst = [...kills].sort((a, b) => b.killTime.getTime() - a.killTime.getTime());
          for (const kill of killsNewestFirst) {
            respawnCalculator.recordKill(kill.bossName, kill.killTime, kill.note);
            const identifier = kill.note ? `${kill.bossName} (${kill.note})` : kill.bossName;
            log(`Recorded kill: ${identifier} at ${kill.killTime.toISOString()}`, 'info');
            
            // Log if boss not found in database
            const bossQuery = kill.note ? `${kill.bossName} (${kill.note})` : kill.bossName;
            if (!bossDataManager.hasBoss(bossQuery)) {
              logger.info(`New boss detected in kill message: '${kill.bossName}'${kill.note ? ` (${kill.note})` : ''} in '${kill.location || 'unknown'}'. Message: '${kill.bossName} was killed'. Timestamp: ${kill.killTime.toISOString()}. Consider adding to default_bosses.json`);
            } else {
              log(`Boss "${bossQuery}" found in database`, 'debug');
            }
          }
          
          log(`✅ Startup scan completed - found ${kills.length} kills, recorded ${kills.length} kill records`, 'success');
          log('Monitoring target-tracking channel for new messages...', 'info');
          
          // Set up message listener for target-tracking channel
          client.on('messageCreate', async (message) => {
            if (message.channel.id !== TARGET_TRACKING_CHANNEL_ID) return;
            log(`New message in target-tracking channel from ${message.author.tag} (bot: ${message.author.bot})`, 'debug');
            // NOTE: We allow bot messages because Boss Tracker APP posts kill messages as a bot
            // The messageParser.parseKillMessage will handle parsing bot messages
            
            try {
              // Parse all kills from message (handles multi-line messages)
              const parsedKills = messageParser.parseKillMessages(message);
              for (const parsed of parsedKills) {
                if (respawnCalculator) {
                  respawnCalculator.recordKill(parsed.bossName, parsed.killTime, parsed.note);
                  const identifier = parsed.note ? `${parsed.bossName} (${parsed.note})` : parsed.bossName;
                  log(`New kill recorded: ${identifier} killed at ${parsed.killTime.toISOString()} (source: ${parsed.source})`, 'info');
                  
                  // Log if boss not found in database
                  const bossQuery = parsed.note ? `${parsed.bossName} (${parsed.note})` : parsed.bossName;
                  if (!bossDataManager.hasBoss(bossQuery)) {
                    logger.info(`New boss detected in kill message: '${parsed.bossName}'${parsed.note ? ` (${parsed.note})` : ''} in '${parsed.location || 'unknown'}'. Message: '${message.content}'. Timestamp: ${parsed.killTime.toISOString()}. Consider adding to default_bosses.json`);
                  }
                }
              }
            } catch (error) {
              log(`Error processing kill message: ${error instanceof Error ? error.message : error}`, 'error');
            }
          });

          // Re-parse target-tracking messages when edited (e.g. user adds kill list after posting)
          client.on('messageUpdate', async (_oldMessage, newMessage) => {
            if (newMessage.channelId !== TARGET_TRACKING_CHANNEL_ID) return;
            const msg = newMessage.partial ? await newMessage.fetch() : newMessage;
            if (!msg.content) return;
            try {
              const parsedKills = messageParser.parseKillMessages(msg as Message);
              for (const parsed of parsedKills) {
                if (respawnCalculator) {
                  respawnCalculator.recordKill(parsed.bossName, parsed.killTime, parsed.note);
                  const identifier = parsed.note ? `${parsed.bossName} (${parsed.note})` : parsed.bossName;
                  log(`Kill recorded from edited message: ${identifier} at ${parsed.killTime.toISOString()} (source: ${parsed.source})`, 'info');
                  const bossQuery = parsed.note ? `${parsed.bossName} (${parsed.note})` : parsed.bossName;
                  if (!bossDataManager.hasBoss(bossQuery)) {
                    logger.info(`New boss detected in kill message: '${parsed.bossName}'${parsed.note ? ` (${parsed.note})` : ''} in '${parsed.location || 'unknown'}'. Timestamp: ${parsed.killTime.toISOString()}. Consider adding to default_bosses.json`);
                  }
                }
              }
            } catch (error) {
              log(`Error processing edited kill message: ${error instanceof Error ? error.message : error}`, 'error');
            }
          });
          
          // Set up interaction handlers for slash commands
          client.on('interactionCreate', async (interaction) => {
            if (interaction.isAutocomplete()) {
              if (respawnCommandHandler) {
                await respawnCommandHandler.handleAutocomplete(interaction);
              }
              return;
            }
            if (interaction.isButton() && interaction.customId.startsWith('schedule-cancel-') && respawnCommandHandler) {
              await respawnCommandHandler.handleScheduleCancelButton(interaction);
              return;
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'schedule-cancel-menu' && respawnCommandHandler) {
              const selectedId = interaction.values[0];
              if (selectedId) {
                await respawnCommandHandler.handleScheduleCancelSelect(interaction, selectedId);
              }
              return;
            }
            if (interaction.isChatInputCommand()) {
              if (interaction.commandName === 'help' && respawnCommandHandler) {
                await respawnCommandHandler.handleHelpCommand(interaction);
                return;
              }
              if (interaction.commandName === 'respawn' && respawnCommandHandler) {
                await respawnCommandHandler.handleRespawnCommand(interaction);
                return;
              }
              if (interaction.commandName === 'lockout' && respawnCommandHandler) {
                await respawnCommandHandler.handleLockoutCommand(interaction);
                return;
              }
              if (interaction.commandName === 'boss-nickname' && respawnCommandHandler) {
                await respawnCommandHandler.handleBossNicknameCommand(interaction);
                return;
              }
              if (interaction.commandName === 'raidnight' && respawnCommandHandler) {
                await respawnCommandHandler.handleRaidNightCommand(interaction);
                return;
              }
              if (interaction.commandName === 'schedule' && respawnCommandHandler) {
                await respawnCommandHandler.handleScheduleCommand(interaction);
                return;
              }
            }
          });

          const raidNightSchedulerStartedAt = Date.now();
          setInterval(() => {
            if (cacheManager && respawnCommandHandler && bossDataManager && respawnCalculator) {
              runRaidNightSchedulerTick(client, cacheManager, bossDataManager, respawnCalculator, raidNightSchedulerStartedAt).catch(err =>
                log(`Raid night scheduler tick error: ${err instanceof Error ? err.message : err}`, 'error')
              );
            }
          }, 60_000);
          
          log('✅ Boss respawn tracker initialized successfully', 'success');
        } catch (error) {
          log(`Error initializing boss respawn tracker: ${error instanceof Error ? error.message : error}`, 'error');
          log('Bot will continue running without boss respawn tracker', 'warning');
        }
      } else {
        log('Boss respawn tracker not configured (TARGET_TRACKING_CHANNEL_ID not set)', 'info');
      }
      
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
      
      // Process offnight threads (if enabled)
      if (OFFNIGHT_FILE_OPERATIONS_ENABLED) {
        log('Starting offnight sync...', 'debug');
        await offnightManager.findLatestOffnightThreads(offnightChannel);
        log('Offnight sync completed', 'success');
      } else {
        log('Offnight file operations are disabled - skipping offnight sync', 'info');
      }
      
      // Initialize Discord events manager (if enabled)
      if (DISCORD_EVENTS_ENABLED_FLAG) {
        // log(`🔧 Debug: Creating DiscordEventManager with OFFNIGHT_FILE_OPERATIONS_ENABLED = ${OFFNIGHT_FILE_OPERATIONS_ENABLED}`, 'debug');
        discordEventManager = new DiscordEventManager({
          guildId: DISCORD_GUILD_ID!,
          botToken: DISCORD_TOKEN!,
          githubRepo: GITHUB_REPO!,
          githubBranch: GITHUB_BRANCH,
          raidChannelId: DISCORD_RAID_CHANNEL_ID,
          offnightChannelId: DISCORD_OFFNIGHT_CHANNEL_ID,
          cacheManager: cacheManager,
          offnightFileOperationsEnabled: OFFNIGHT_FILE_OPERATIONS_ENABLED
        });
        
        // Sync Discord events after all other processes have completed
        try {
          log('Starting Discord events sync...', 'debug');
          await discordEventManager.syncEventsFromFiles();
          log('Discord events sync completed', 'success');
        } catch (error) {
          log(`Error syncing Discord events: ${error instanceof Error ? error.message : error}`, 'error');
        }
      } else {
        log(`Discord events disabled via environment variable (DISCORD_EVENTS_ENABLED=${DISCORD_EVENTS_ENABLED})`, 'info');
      }
      
      // Save cache after all processing is complete
      try {
        await saveCache();
        log('Cache saved after processing', 'success');
      } catch (error) {
        log(`Error saving cache: ${error instanceof Error ? error.message : error}`, 'error');
      }
      
      // Final startup summary
      log('Bot startup completed successfully - all syncs finished', 'success');
      
      // Set up message handlers
      setupMessageHandlers(inventoryChannel, raidChannel, inventoryManager, raidManager);
      
      // Set up intervals
      setupIntervals(inventoryManager, raidManager, offnightManager, offnightChannel);
      
    } catch (error) {
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
  if (discordEventManager && DISCORD_EVENTS_ENABLED_FLAG) {
    log('Discord events manager stopped.', 'info');
  }
  // Save cache before exiting
  saveCache().catch(error => {
    logger.error(`Error saving cache during shutdown: ${error instanceof Error ? error.message : error}`);
  });
  log('Bot shutting down gracefully.', 'bot');
  process.exit();
});

function setupMessageHandlers(
  inventoryChannel: TextChannel,
  raidChannel: TextChannel,
  inventoryManager: InventoryManager,
  raidManager: RaidManager
) {
  // Handle inventory file updates
  client.on('messageCreate', async (message) => {
    if (message.channel.id !== inventoryChannel.id) return;
    if (message.author.id === client.user?.id) return; // Skip bot's own messages
    
    const attachments = message.attachments;
    for (const [_, attachment] of attachments) {
      if (attachment.name?.endsWith('.txt')) {
        try {
          const response = await fetch(attachment.url);
          const content = await response.text();
          await inventoryManager.processNewFile(attachment.name, content);
        } catch (error) {
          log(`Error processing inventory file: ${error instanceof Error ? error.message : error}`, 'error');
        }
      }
    }
  });

  // Handle raid schedule updates
  client.on('messageCreate', async (message) => {
    if (message.channel.id !== raidChannel.id) return;
    if (message.author.id === client.user?.id) return; // Skip bot's own messages
    
    // Process raid schedule content
    try {
      // Validate that the message contains valid raid schedule entries
      const validLines = processRaidScheduleMessage(message.content);
      const validEntryCount = validLines.filter(line => line !== '').length;
      
      if (validEntryCount === 0) {
        log('⚠️ No valid raid schedule entries found in new message', 'warning');
        log(`Message from: ${message.author.tag}`, 'debug');
        log('Appending error message to GitHub file instead of processing', 'warning');
        
        // Fetch current GitHub file content and append error message
        try {
          let existingContent = '';
          try {
            const { data } = await octokit.repos.getContent({
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO_NAME,
              path: RAID_FILE_PATH_STR,
              ref: GITHUB_BRANCH
            });
            
            if (Array.isArray(data)) {
              throw new Error('Raid schedule path on GitHub is a directory, not a file.');
            }
            
            if (data.type === 'file' && data.encoding === 'base64' && data.content) {
              existingContent = Buffer.from(data.content, 'base64').toString();
            }
          } catch (error: any) {
            if (error.status === 404) {
              log('Raid schedule file not found on GitHub, creating new file with error message', 'github');
              existingContent = '';
            } else {
              throw error;
            }
          }
          
          // Append error message with timestamp
          const errorMessage = `\n\n<!-- Error: Could not parse new raid schedule - ${new Date().toLocaleString()} -->`;
          const errorContent = existingContent + errorMessage;
          
          // Update GitHub file with error message appended
          const updateSuccess = await updateGithubFile(RAID_FILE_PATH_STR, errorContent, false, true);
          if (updateSuccess) {
            log('✅ Appended error message to raid schedule file on GitHub', 'success');
          } else {
            log('Failed to append error message to GitHub file', 'error');
          }
        } catch (error) {
          log(`Error appending error message to GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
        
        // Do NOT process schedule if parsing failed
        return;
      }
      
      await raidManager.processNewSchedule(message.content);
    } catch (error) {
      log(`Error processing raid schedule: ${error instanceof Error ? error.message : error}`, 'error');
    }
  });

  // Handle message edits
  client.on('messageUpdate', async (_oldMessage, newMessage) => {
    try {
      // For older messages, Discord often delivers partials. Fetch the full message so edits to
      // existing raid schedule posts still update the cache.
      const updated = newMessage.partial ? await newMessage.fetch() : newMessage;

      // Ignore bot edits
      if (updated.author?.bot) return;

      // Handle edited raid schedule messages
      if (updated.channel.id === raidChannel.id) {
        log(`\n📝 Raid message edited in #${(updated.channel as TextChannel).name} by ${updated.author?.tag ?? 'unknown'}`);
        try {
          await raidManager.processNewSchedule(updated.content);
          log('✅ Updated raid schedule after edit.', 'success');
        } catch (err) {
          log(`Failed to update raid schedule after edit: ${err instanceof Error ? err.message : err}`, 'error');
        }
      }

      // Handle edited inventory files
      if (updated.channel.id === inventoryChannel.id) {
        log(`\n📝 Inventory message edited in #${(updated.channel as TextChannel).name} by ${updated.author?.tag ?? 'unknown'}`);
        const attachments = updated.attachments;
        for (const [_, attachment] of attachments) {
          if (attachment.name?.endsWith('.txt')) {
            try {
              const response = await fetch(attachment.url);
              const content = await response.text();
              await inventoryManager.processNewFile(attachment.name, content);
              log('✅ Updated inventory file after edit.', 'success');
            } catch (error) {
              log(`Error processing edited inventory file: ${error instanceof Error ? error.message : error}`, 'error');
            }
          }
        }
      }
    } catch (error) {
      log(`Error handling messageUpdate: ${error instanceof Error ? error.message : error}`, 'error');
    }
  });
}

function setupIntervals(inventoryManager: InventoryManager, raidManager: RaidManager, offnightManager: OffnightManager, offnightChannel: TextChannel) {
  // Set up cache cleanup interval
  setInterval(() => {
    cleanupCache(); // Use the local cleanupCache function
    saveCache().catch(error => {
      logger.error(`Error saving cache during cleanup: ${error instanceof Error ? error.message : error}`);
    });
  }, 24 * 60 * 60 * 1000); // Run cleanup daily

  // Set up inventory check interval - changed to 30 minutes
  setInterval(async () => {
    try {
      await inventoryManager.processInventoryFiles();
    } catch (error) {
      logger.error(`Error processing inventory files: ${error instanceof Error ? error.message : error}`);
    }
  }, 30 * 60 * 1000); // Check every 30 minutes

  // Set up raid schedule check interval
  setInterval(async () => {
    try {
      await raidManager.processRaidSchedule();
      // Calendar update happens inside processRaidSchedule, so it will run after the raid schedule is processed
    } catch (error) {
      logger.error(`Error processing raid schedule: ${error instanceof Error ? error.message : error}`);
    }
  }, 30 * 60 * 1000); // Check every 30 minutes

  // Set up periodic GitHub verification for raid schedule (every 90 minutes)
  setInterval(async () => {
    await verifyRaidScheduleOnGitHub();
  }, 90 * 60 * 1000); // 90 minutes

  // Set up offnight check interval (only if enabled)
  if (OFFNIGHT_FILE_OPERATIONS_ENABLED) {
    setInterval(async () => {
      try {
        await offnightManager.findLatestOffnightThreads(offnightChannel);
      } catch (error) {
        logger.error(`Error processing offnight threads: ${error instanceof Error ? error.message : error}`);
      }
    }, 60 * 60 * 1000); // Check every 1 hour
  }

  // Set up Discord events sync interval (runs after offnight processing) - only if enabled
  if (DISCORD_EVENTS_ENABLED_FLAG) {
    setInterval(async () => {
      if (discordEventManager) {
        try {
          await discordEventManager.syncEventsFromFiles();
          log('✅ Discord events sync completed', 'success');
        } catch (error) {
          logger.error(`Error syncing Discord events: ${error instanceof Error ? error.message : error}`);
        }
      }
    }, 60 * 60 * 1000); // Check every 1 hour, runs after offnight processing
  }
}

export { updateGithubFile }; 