import winston from 'winston';

const { combine, timestamp, printf } = winston.format;

const emojiMap = {
  // Status/Progress
  info: '📋',      // General information
  debug: '🔍',     // Detailed inspection/debugging
  
  // Success
  success: '✅',    // Operation completed successfully
  
  // Warnings
  warn: '⚠️',      // Warning about potential issues
  
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
} as const;

const logFormat = printf((info) => {
  const emoji = emojiMap[info.level as keyof typeof emojiMap] || '📋';
  return `${emoji} [${new Date().toLocaleString()}] ${info.message}`;
});

// Determine log level from environment variable or command line args
// Priority: --debug flag > LOG_LEVEL env var > NODE_ENV=development > default 'info'
const getLogLevel = (): string => {
  // Check for --debug flag
  if (process.argv.includes('--debug')) {
    return 'debug';
  }
  
  // Check LOG_LEVEL environment variable
  if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL.toLowerCase();
    if (['error', 'warn', 'info', 'debug', 'verbose'].includes(level)) {
      return level;
    }
  }
  
  // Check NODE_ENV
  if (process.env.NODE_ENV === 'development') {
    return 'debug';
  }
  
  // Default
  return 'info';
};

export const logger = winston.createLogger({
  level: getLogLevel(),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Log the current log level on initialization (only in debug mode to avoid noise)
if (getLogLevel() === 'debug') {
  logger.debug(`🔍 Debug mode enabled. Log level: ${getLogLevel()}`);
} 