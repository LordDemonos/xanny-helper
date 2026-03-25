/**
 * TypeScript types for boss respawn tracker feature
 */

export interface BossData {
  name: string;
  location?: string;
  enabled?: boolean;
  webhook_url?: string | null;
  first_seen?: string;
  kill_count?: number;
  last_killed?: string | null;
  last_killed_timestamp?: string | null;
  respawn_hours?: number | null;
  note?: string;
}

export interface BossDatabase {
  bosses: BossData[];
}

export interface ParsedKillMessage {
  bossName: string;
  location?: string;
  killTime: Date;
  source: 'boss_tracker' | 'manual';
  note?: string;
}

export interface KillRecord {
  lastKilled: Date;
  killCount: number;
}

export interface RespawnTimeResult {
  hoursRemaining: number;
  minutesRemaining: number;
  isRespawned: boolean;
  respawnTime: Date;
  formattedTime: string;
}
