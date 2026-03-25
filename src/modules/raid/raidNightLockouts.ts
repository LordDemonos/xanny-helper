/**
 * Raid night lockouts: resolve schedule to bosses and filter by respawn during 9PM–11:59PM ET (America/New_York, DST-aware).
 */
import { fromZonedTime } from 'date-fns-tz';
import { processRaidScheduleMessage, sortRaidScheduleByDate, parseScheduleLine } from './raidPatternMatcher';
import { BossDataManager } from '../boss-respawn/bossDataManager';
import { RespawnCalculator } from '../boss-respawn/respawnCalculator';
import { BossData } from '../boss-respawn/types';
import { sortBossesByZoneOrder, getZoneOrderEntries, getDisplayZoneForBoss, getCanonicalZoneName } from '../boss-respawn/zoneBossOrder';

const EST_TZ = 'America/New_York';

/** Cursed Cycle: [a glyph covered serpent], Vyzh`dra the Exiled, Vyzh`dra the Cursed (Cursed 1, 2, 3) */
const CURSED_CYCLE_BOSSES = ['a glyph covered serpent', 'Vyzh`dra the Exiled', 'Vyzh`dra the Cursed'];

/** Rhag Cycle: Rhag`Zhezum, Rhag`Mozdezh, Arch Lich Rhag`Zadune (Rhag 1, 2, 3) */
const RHAG_CYCLE_BOSSES = ['Rhag`Zhezum', 'Rhag`Mozdezh', 'Arch Lich Rhag`Zadune'];

/** "a Burrower Parasite" in schedule → boss name in DB */
const BURROWER_PARASITE_ALIAS = 'A burrower parasite';

/**
 * Get today's date string (YYYY-MM-DD) in EST.
 */
export function getTodayESTDateString(): string {
  const now = new Date();
  const str = now.toLocaleDateString('en-CA', { timeZone: EST_TZ });
  return str;
}

/**
 * True if current time in EST is within the raid window (9:00 PM–11:59 PM).
 */
function isWithinRaidWindowEST(): boolean {
  const now = new Date();
  const str = now.toLocaleTimeString('en-CA', { timeZone: EST_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const [hour] = str.split(':').map(s => parseInt(s, 10));
  return hour >= 21 && hour <= 23;
}

/**
 * Get raid line date as YYYY-MM-DD for comparison (using parsed date's year/month/day).
 */
function getRaidLineDateString(parsedDate: Date): string {
  const y = parsedDate.getFullYear();
  const m = parsedDate.getMonth() + 1;
  const d = parsedDate.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Build 9:00 PM and 11:59 PM Eastern (America/New_York) on the given calendar date.
 * Uses DST so "9 PM ET" is correct in both EST and EDT. Month is 1-indexed.
 */
function getRaidWindowEST(year: number, month: number, day: number): { raidStart: Date; raidEnd: Date } {
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const raidStart = fromZonedTime(`${dateStr}T21:00:00`, EST_TZ);
  const raidEnd = fromZonedTime(`${dateStr}T23:59:00`, EST_TZ);
  return { raidStart, raidEnd };
}

/**
 * Next raid rule: show today's raid until after 11:59 PM EST; then show the following raid.
 * So if current time in EST is >= midnight (00:00), we're already on the "next" day.
 * Target date = today in EST (calendar date).
 */
function getTargetRaidDateEST(): string {
  return getTodayESTDateString();
}

/**
 * Returns unique raid day date strings (YYYY-MM-DD) from schedule content.
 * Used to determine if a given date is a raid day (e.g. for scheduled posts).
 */
export function getRaidDayDateStrings(scheduleContent: string): string[] {
  const lines = processRaidScheduleMessage(scheduleContent);
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.startsWith('-') ? raw.slice(1).trim() : raw.trim();
    if (!line) continue;
    const { date } = parseScheduleLine(line);
    if (!date) continue;
    seen.add(getRaidLineDateString(date));
  }
  return [...seen];
}

/**
 * Returns true if the given date (EST) is a raid day according to the schedule.
 * If dateStrEST is omitted, uses today in EST.
 */
export function isRaidDay(scheduleContent: string | null | undefined, dateStrEST?: string): boolean {
  if (!scheduleContent || !scheduleContent.trim()) return false;
  const check = dateStrEST ?? getTodayESTDateString();
  const raidDays = new Set(getRaidDayDateStrings(scheduleContent));
  return raidDays.has(check);
}

export interface RaidNightResult {
  success: boolean;
  message: string;
  raidLine?: string;
  raidDateStr?: string;
  raidStart?: Date;
  raidEnd?: Date;
}

/** Raid line with parsed date, used for next/next+1/next+2. */
export type UpcomingRaidLine = { line: string; date: Date; dateStr: string };

/**
 * All raid lines on or after today EST, sorted by date. Used for "next", "next+1", "next+2".
 */
export function getUpcomingRaidLines(scheduleContent: string): UpcomingRaidLine[] {
  const lines = processRaidScheduleMessage(scheduleContent);
  const sorted = sortRaidScheduleByDate(lines);
  const targetStr = getTargetRaidDateEST();

  const candidates: UpcomingRaidLine[] = [];
  for (const raw of sorted) {
    const line = raw.startsWith('-') ? raw.slice(1).trim() : raw.trim();
    if (!line) continue;
    const { date, targets } = parseScheduleLine(line);
    if (!date || targets.length === 0) continue;
    const lineDateStr = getRaidLineDateString(date);
    if (lineDateStr >= targetStr) {
      candidates.push({ line, date, dateStr: lineDateStr });
    }
  }
  candidates.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  return candidates;
}

/**
 * Raid line at offset from today: 0 = next raid, 1 = raid after next (Next +1), 2 = Next +2, etc.
 */
export function getRaidLineAtOffset(scheduleContent: string, offset: number): UpcomingRaidLine | null {
  const upcoming = getUpcomingRaidLines(scheduleContent);
  if (offset < 0 || offset >= upcoming.length) return null;
  return upcoming[offset];
}

/**
 * Boss identity for deduplication (name + note).
 */
function bossKey(b: BossData): string {
  return b.note ? `${b.name} (${b.note})` : b.name;
}

/**
 * Resolve a single target token to zero or more bosses (zone → all bosses from zone order list so we include "Lockouts" bosses; boss name → that boss; cycle → list).
 */
function resolveTarget(
  token: string,
  bossDataManager: BossDataManager
): BossData[] {
  const t = token.trim();
  if (!t) return [];

  const lower = t.toLowerCase();

  if (lower === 'cursed cycle') {
    return CURSED_CYCLE_BOSSES
      .map(name => bossDataManager.getBoss(name))
      .filter((b): b is BossData => b != null);
  }
  if (lower === 'rhag cycle') {
    return RHAG_CYCLE_BOSSES
      .map(name => bossDataManager.getBoss(name))
      .filter((b): b is BossData => b != null);
  }

  if (lower === 'a burrower parasite' || lower === 'burrower parasite') {
    const b = bossDataManager.getBoss(BURROWER_PARASITE_ALIAS);
    return b ? [b] : [];
  }

  // For the three ordered zones, use the canonical order list so we include bosses with location "Lockouts" (e.g. Ssraeshza Temple Rhag/Cursed/Emperor).
  const zoneEntries = getZoneOrderEntries(t);
  if (zoneEntries.length > 0) {
    const bosses: BossData[] = [];
    for (const entry of zoneEntries) {
      const q = entry.note ? `${entry.name} (${entry.note})` : entry.name;
      const b = bossDataManager.getBoss(q);
      if (b) bosses.push(b);
    }
    return sortBossesByZoneOrder(t, bosses);
  }

  const asZone = bossDataManager.getBossesByLocation(t);
  if (asZone.length > 0) return asZone;

  const asBoss = bossDataManager.getBoss(t);
  if (asBoss) return [asBoss];

  return [];
}

/**
 * Resolve targets in schedule order: first target's bosses (in zone order), then second target's new bosses, etc. Dedupe by boss key (first occurrence wins).
 */
function resolveTargetsToBossesInScheduleOrder(
  targets: string[],
  bossDataManager: BossDataManager
): BossData[] {
  const seen = new Set<string>();
  const withOrder: { boss: BossData; targetIndex: number; zoneOrderIndex: number }[] = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
    const token = targets[targetIndex];
    const bosses = resolveTarget(token, bossDataManager);
    for (let zoneOrderIndex = 0; zoneOrderIndex < bosses.length; zoneOrderIndex++) {
      const boss = bosses[zoneOrderIndex];
      const key = bossKey(boss);
      if (seen.has(key)) continue;
      seen.add(key);
      withOrder.push({ boss, targetIndex, zoneOrderIndex });
    }
  }
  withOrder.sort((a, b) => a.targetIndex - b.targetIndex || a.zoneOrderIndex - b.zoneOrderIndex);
  return withOrder.map(x => x.boss);
}

/**
 * First target in the schedule that is a zone (Vex Thal, Sanctus Seru, Ssraeshza Temple). Returns canonical name.
 */
function findFirstZoneTarget(targets: string[], _bossDataManager: BossDataManager): string | null {
  for (const t of targets) {
    if (getZoneOrderEntries(t).length > 0) return getCanonicalZoneName(t) ?? t;
  }
  return null;
}

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Whether this boss will be up (respawned) by raidEnd.
 * Uses getKillRecord and respawn_hours; no recent kill (or none in 8 days) = already respawned.
 */
function isUpByRaidEnd(
  boss: BossData,
  raidEnd: Date,
  respawnCalculator: RespawnCalculator
): { up: boolean; respawnTime: Date | null; unknown: boolean } {
  if (boss.respawn_hours == null || boss.respawn_hours === undefined) {
    return { up: true, respawnTime: null, unknown: true };
  }
  const killRecord = respawnCalculator.getKillRecord(boss.name, boss.note ?? undefined);
  if (!killRecord) {
    return { up: true, respawnTime: null, unknown: false };
  }
  const eightDaysAgo = new Date(raidEnd.getTime() - EIGHT_DAYS_MS);
  if (killRecord.lastKilled < eightDaysAgo) {
    return { up: true, respawnTime: null, unknown: false };
  }
  const respawnTime = new Date(
    killRecord.lastKilled.getTime() + boss.respawn_hours * 60 * 60 * 1000
  );
  return {
    up: respawnTime.getTime() <= raidEnd.getTime(),
    respawnTime,
    unknown: false,
  };
}

/**
 * Format one boss line for the response (same style as /respawn: timestamps, "respawned", "cannot determine").
 */
function formatBossLine(
  boss: BossData,
  raidEnd: Date,
  respawnCalculator: RespawnCalculator
): string {
  const identifier = bossKey(boss);
  const { up, respawnTime, unknown } = isUpByRaidEnd(boss, raidEnd, respawnCalculator);

  if (unknown) {
    return `**${identifier}**: Cannot determine respawn (no respawn time configured)`;
  }
  if (up) {
    if (respawnTime) {
      const unix = Math.floor(respawnTime.getTime() / 1000);
      return `**${identifier}**: Respawned (<t:${unix}:F>)`;
    }
    return `**${identifier}**: Respawned (no kill in last 7 days)`;
  }
  if (respawnTime) {
    const unix = Math.floor(respawnTime.getTime() / 1000);
    const result = respawnCalculator.calculateRespawnTime(identifier);
    const formatted = result ? result.formattedTime : '?';
    return `**${identifier}**: ${formatted} (<t:${unix}:F>)`;
  }
  return `**${identifier}**: Cannot determine respawn`;
}

/** Header label for raid at offset; inProgress when command is run during 9PM–11:59PM EST on that raid's date. */
function getRaidHeaderLabel(offset: number, inProgress: boolean): string {
  if (offset === 0 && inProgress) return 'Current raid in progress';
  if (offset === 0) return 'Next raid';
  if (offset === 1) return 'Next +1 raid (after next)';
  return `Next +${offset} raid`;
}

/**
 * Build the full raid night lockouts response.
 * @param offset 0 = next raid, 1 = raid after next (Next +1), 2 = Next +2, etc.
 */
export function getRaidNightLockouts(
  scheduleContent: string | null | undefined,
  bossDataManager: BossDataManager,
  respawnCalculator: RespawnCalculator,
  offset: number = 0
): RaidNightResult {
  if (!scheduleContent || !scheduleContent.trim()) {
    return { success: false, message: 'No raid schedule in cache. Post the schedule in the raid night channel first.' };
  }

  const raidEntry = getRaidLineAtOffset(scheduleContent, offset);
  if (!raidEntry) {
    const upcomingCount = getUpcomingRaidLines(scheduleContent).length;
    if (upcomingCount === 0) {
      return { success: false, message: 'No raid found for today or later in the schedule.' };
    }
    return {
      success: false,
      message: `Only ${upcomingCount} raid(s) found in the schedule (today or later). Use 0 for next, 1 for Next +1, up to ${upcomingCount - 1}.`,
    };
  }

  const { line, dateStr } = raidEntry;
  const [y, m, d] = dateStr.split('-').map(Number);
  const { raidStart, raidEnd } = getRaidWindowEST(y, m, d);

  const { targets } = parseScheduleLine(line.startsWith('-') ? line : `- ${line}`);
  const bosses = resolveTargetsToBossesInScheduleOrder(targets, bossDataManager);

  const todayStr = getTodayESTDateString();
  const inProgress = offset === 0 && dateStr === todayStr && isWithinRaidWindowEST();

  const raidStartUnix = Math.floor(raidStart.getTime() / 1000);
  const headerLabel = getRaidHeaderLabel(offset, inProgress);
  const lines: string[] = [
    `**${headerLabel}:** <t:${raidStartUnix}:F>`,
    '',
  ];

  const upOrUnknown: BossData[] = [];
  for (const boss of bosses) {
    const { up, unknown } = isUpByRaidEnd(boss, raidEnd, respawnCalculator);
    if (up || unknown) upOrUnknown.push(boss);
  }

  if (upOrUnknown.length === 0) {
    lines.push('_No bosses with respawn by raid end in this window._');
  } else {
    const startingZone = findFirstZoneTarget(targets, bossDataManager);
    let lastZone: string | null = null;
    for (const boss of upOrUnknown) {
      const zone = getDisplayZoneForBoss(boss);
      if (zone !== lastZone) {
        if (lastZone !== null) lines.push('');
        const isFirstZone = lastZone === null;
        const zoneLabel = inProgress && isFirstZone && zone === startingZone
          ? `**Remaining targets: ${zone}**`
          : isFirstZone && zone === startingZone
            ? `**Starting in: ${zone}**`
            : `**${zone}**`;
        lines.push(zoneLabel);
        lastZone = zone;
      }
      lines.push(formatBossLine(boss, raidEnd, respawnCalculator));
    }
  }

  return {
    success: true,
    message: lines.join('\n'),
    raidLine: line,
    raidDateStr: dateStr,
    raidStart,
    raidEnd,
  };
}
