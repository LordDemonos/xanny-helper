/**
 * Calculates respawn times for bosses
 */
import { logger } from '../../utils/logger';
import { BossDataManager } from './bossDataManager';
import { RespawnTimeResult } from './types';
import { NoteCache } from './noteCache';

/** Normalize boss name for storage/lookup so Discord backtick variants match (e.g. ` U+0060 vs ˋ U+02CB) */
function normalizeBossKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\u02CB\u0060\u2019\u2018]/g, '\u0060');
}

export class RespawnCalculator {
  private bossDataManager: BossDataManager;
  private killRecords: Map<string, { lastKilled: Date; killCount: number }> = new Map();
  private noteCache: NoteCache;

  constructor(bossDataManager: BossDataManager, noteCache?: NoteCache) {
    this.bossDataManager = bossDataManager;
    this.noteCache = noteCache || new NoteCache();
  }

  /**
   * Record a boss kill
   * Uses boss name + note as key to handle duplicates
   */
  recordKill(bossName: string, killTime: Date, note?: string): void {
    const base = normalizeBossKey(bossName);
    const key = note ? `${base}:${note.toLowerCase().trim()}` : base;

    const existing = this.killRecords.get(key);

    if (existing) {
      // Use most recent kill if multiple found
      if (killTime > existing.lastKilled) {
        existing.lastKilled = killTime;
        existing.killCount++;
      }
    } else {
      this.killRecords.set(key, {
        lastKilled: killTime,
        killCount: 1,
      });
    }

    // Cache the note/nickname mapping if note exists
    if (note) {
      this.noteCache.cacheNote(bossName, note);
    }

    const identifier = note ? `${bossName} (${note})` : bossName;
    logger.debug(`Recorded kill: ${identifier} at ${killTime.toISOString()}`);
  }

  /**
   * Get the note cache instance
   */
  getNoteCache(): NoteCache {
    return this.noteCache;
  }

  /**
   * Format time remaining (hours) as "X days, Y hours" or "X hours"
   */
  formatRespawnTime(hoursRemaining: number): string {
    if (hoursRemaining < 0) {
      return '0 hours'; // Already respawned
    }

    if (hoursRemaining < 24) {
      // Less than 24 hours, show as hours only
      const hours = Math.floor(hoursRemaining);
      const minutes = Math.floor((hoursRemaining - hours) * 60);
      if (minutes > 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
      }
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    // 24 hours or more, show as days and hours
    const days = Math.floor(hoursRemaining / 24);
    const hours = Math.floor(hoursRemaining % 24);
    const minutes = Math.floor((hoursRemaining % 1) * 60);

    const parts: string[] = [];
    if (days > 0) {
      parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    }
    if (hours > 0) {
      parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0 && days === 0) {
      // Only show minutes if less than a day
      parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }

    return parts.join(', ');
  }

  /**
   * Format lockout time (hours) using same rules as respawn time
   */
  formatLockoutTime(hours: number): string {
    return this.formatRespawnTime(hours);
  }

  /**
   * Calculate time until respawn for a boss
   */
  calculateRespawnTime(bossName: string): RespawnTimeResult | null {
    const boss = this.bossDataManager.getBoss(bossName);
    if (!boss) {
      logger.debug(`calculateRespawnTime: Boss "${bossName}" not found in database`);
      return null;
    }

    const respawnHours = boss.respawn_hours;
    if (respawnHours === null || respawnHours === undefined) {
      logger.debug(`calculateRespawnTime: Boss "${boss.name}" has no respawn_hours configured`);
      return null;
    }

    const note = boss.note?.trim();
    const killRecord = this.getKillRecord(boss.name, note);

    logger.debug(`calculateRespawnTime: Looking up kill record (boss: "${boss.name}", note: ${note || 'none'})`);
    logger.debug(`calculateRespawnTime: Kill record found: ${killRecord ? `Yes - Last killed: ${killRecord.lastKilled.toISOString()}, Count: ${killRecord.killCount}` : 'No'}`);

    // Check if kill found in last 8 days
    // Longest respawn is 162 hours (6.75 days), so 8 days provides a safe buffer
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const hasRecentKill = killRecord && killRecord.lastKilled >= eightDaysAgo;
    logger.debug(`calculateRespawnTime: Eight days ago: ${eightDaysAgo.toISOString()}, Has recent kill: ${hasRecentKill}`);

    if (!hasRecentKill) {
      // No kill in last 8 days - assume respawned
      if (killRecord) {
        logger.info(`calculateRespawnTime: Boss "${boss.name}" has kill record but it's older than 8 days. Last killed: ${killRecord.lastKilled.toISOString()}, Eight days ago: ${eightDaysAgo.toISOString()}`);
      } else {
        logger.info(`calculateRespawnTime: Boss "${boss.name}" has no kill record at all. Assuming respawned.`);
      }
      return {
        hoursRemaining: -1,
        minutesRemaining: -1,
        isRespawned: true,
        respawnTime: new Date(0),
        formattedTime: '0 hours',
      };
    }

    // Calculate respawn time
    const respawnTime = new Date(killRecord.lastKilled.getTime() + respawnHours * 60 * 60 * 1000);
    const now = new Date();
    const timeRemaining = respawnTime.getTime() - now.getTime();
    const hoursRemaining = timeRemaining / (1000 * 60 * 60);
    const minutesRemaining = timeRemaining / (1000 * 60);

    return {
      hoursRemaining,
      minutesRemaining,
      isRespawned: hoursRemaining <= 0,
      respawnTime,
      formattedTime: this.formatRespawnTime(hoursRemaining),
    };
  }

  /**
   * Get lockout time for a boss
   * Accepts boss query string (may include note)
   */
  getLockoutTime(bossQuery: string): number | null {
    const boss = this.bossDataManager.getBoss(bossQuery);
    if (!boss) {
      return null;
    }

    return boss.respawn_hours ?? null;
  }

  /**
   * Get kill record for a boss.
   * When note is provided (e.g. "F1 North", "North Blob"), returns only the record for that variant
   * so duplicate-named bosses (Thall Va Xakra North/South, Kaas Thox North/South Blob) are tracked separately.
   * When note is not provided, returns the most recent kill across all stored keys for that base name.
   */
  getKillRecord(bossName: string, note?: string): { lastKilled: Date; killCount: number } | undefined {
    const baseKey = normalizeBossKey(bossName);

    // Variant-specific lookup: when a note is provided, return only the record for that exact key
    const trimmedNote = note?.trim();
    if (trimmedNote) {
      const variantKey = `${baseKey}:${trimmedNote.toLowerCase()}`;
      const record = this.killRecords.get(variantKey);
      if (record) return record;
      return undefined;
    }

    // No note: return the most recent kill across all keys for this boss (backward compatibility)
    const baseKeyWithParen = baseKey + ' (';
    let best: { lastKilled: Date; killCount: number } | undefined;
    for (const [k, record] of this.killRecords) {
      const storedBoss = k.includes(':') ? k.slice(0, k.indexOf(':')) : k;
      const normalizedStored = normalizeBossKey(storedBoss);
      if (normalizedStored.length < baseKey.length && baseKey.endsWith(normalizedStored)) {
        continue; // reject suffix-only match (e.g. "dra the cursed" for "vyzh`dra the cursed")
      }
      const isSameBoss =
        normalizedStored === baseKey ||
        normalizedStored.startsWith(baseKeyWithParen);
      if (isSameBoss && (!best || record.lastKilled > best.lastKilled)) {
        best = record;
      }
    }
    return best;
  }
}
