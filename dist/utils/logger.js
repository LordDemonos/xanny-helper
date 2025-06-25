"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const { combine, timestamp, printf } = winston_1.default.format;
const emojiMap = {
    // Status/Progress
    info: '📋', // General information
    debug: '🔍', // Detailed inspection/debugging
    // Success
    success: '✅', // Operation completed successfully
    // Warnings
    warn: '⚠️', // Warning about potential issues
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
};
const logFormat = printf((info) => {
    const emoji = emojiMap[info.level] || '📋';
    return `${emoji} [${new Date().toLocaleString()}] ${info.message}`;
});
exports.logger = winston_1.default.createLogger({
    level: 'info',
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    transports: [
        new winston_1.default.transports.Console(),
        new winston_1.default.transports.File({ filename: 'error.log', level: 'error' }),
        new winston_1.default.transports.File({ filename: 'combined.log' })
    ]
});
//# sourceMappingURL=logger.js.map