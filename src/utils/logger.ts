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

export const logger = winston.createLogger({
  level: 'info',
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