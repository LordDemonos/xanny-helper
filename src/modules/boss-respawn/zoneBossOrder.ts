/**
 * Canonical zone order for bosses when displaying multiple bosses from a zone.
 * Used by /respawn (zone query), /raidnight, and anywhere zone boss lists are shown.
 */
import { BossData } from './types';

export type ZoneBossEntry = { name: string; note?: string };

const VEX_THAL_ORDER: ZoneBossEntry[] = [
  { name: 'Thall Va Xakra', note: 'F1 North' },
  { name: 'Thall Va Xakra', note: 'F1 South' },
  { name: 'Kaas Thox Xi Ans Dyek' },
  { name: 'Diabo Xi Va', note: 'Floor 1.5 North' },
  { name: 'Diabo Xi Xin', note: 'Floor 1.5 South' },
  { name: 'Diabo Xi Xin Thall', note: 'Floor 1.5 West' },
  { name: 'Thall Va Kelun', note: 'Floor 2 West' },
  { name: 'Diabo Xi Va Temariel', note: 'Floor 2 South' },
  { name: 'Thall Xundraux Diabo', note: 'Floor 2 North' },
  { name: 'Va Xi Aten Ha Ra' },
  { name: 'Kaas Thox Xi Aten Ha Ra', note: 'North Blob' },
  { name: 'Kaas Thox Xi Aten Ha Ra', note: 'South Blob' },
  { name: 'Aten Ha Ra' },
];

const SANCTUS_SERU_ORDER: ZoneBossEntry[] = [
  { name: 'Praesertum Bikun' },
  { name: 'Praesertum Vantorus' },
  { name: 'Praesertum Matpa' },
  { name: 'Praesertum Rhugol' },
  { name: 'Lord Inquisitor Seru' },
];

const SSRAESHZA_TEMPLE_ORDER: ZoneBossEntry[] = [
  { name: 'High Priest of Ssraeshza', note: 'HP' },
  { name: 'Xerkizh The Creator', note: 'XTC' },
  { name: 'Rhag`Zhezum', note: 'Rhag 1' },
  { name: 'Rhag`Mozdezh', note: 'Rhag 2' },
  { name: 'Arch Lich Rhag`Zadune', note: 'Rhag 3' },
  { name: 'a glyph covered serpent', note: 'Cursed 1' },
  { name: 'Vyzh`dra the Exiled', note: 'Cursed 2' },
  { name: 'Vyzh`dra the Cursed', note: 'Cursed 3' },
  { name: 'Emperor Ssraeshza' },
];

const ZONE_ORDER_MAP: Record<string, ZoneBossEntry[]> = {
  'vex thal': VEX_THAL_ORDER,
  'sanctus seru': SANCTUS_SERU_ORDER,
  'ssraeshza temple': SSRAESHZA_TEMPLE_ORDER,
};

/** Bosses that have location "Lockouts" (or unknown) in data but belong to a specific zone for raidnight display. */
const BOSS_TO_ZONE_OVERRIDE: Record<string, string> = {
  'a burrower parasite': 'The Deep',
};

/**
 * Return the ordered list of boss entries for a zone (by name). Used to resolve zone targets
 * to all bosses including those with location "Lockouts" in the JSON (e.g. Ssraeshza Temple).
 */
export function getZoneOrderEntries(zoneName: string): ZoneBossEntry[] {
  const key = normalize(zoneName);
  return ZONE_ORDER_MAP[key] ?? [];
}

/**
 * Canonical display name for a zone token (e.g. "vex thal" -> "Vex Thal"). Returns null if not a known zone.
 */
export function getCanonicalZoneName(token: string): string | null {
  const key = normalize(token);
  for (const name of ORDERED_ZONE_NAMES) {
    if (normalize(name) === key) return name;
  }
  return null;
}

const ORDERED_ZONE_NAMES = ['Sanctus Seru', 'Ssraeshza Temple', 'Vex Thal'] as const;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function bossMatchesEntry(boss: BossData, entry: ZoneBossEntry): boolean {
  const nameMatch = normalize(boss.name) === normalize(entry.name);
  const bossNote = boss.note?.trim() ?? '';
  const entryNote = (entry.note ?? '').trim();
  const noteMatch = normalize(bossNote) === normalize(entryNote);
  return nameMatch && noteMatch;
}

/**
 * Return the 0-based index of this boss in the zone's order list, or Infinity if not in the list.
 */
export function getBossOrderIndex(zoneName: string, boss: BossData): number {
  const key = normalize(zoneName);
  const order = ZONE_ORDER_MAP[key];
  if (!order) return Infinity;
  const idx = order.findIndex(entry => bossMatchesEntry(boss, entry));
  return idx === -1 ? Infinity : idx;
}

function bossIdentifier(boss: BossData): string {
  return boss.note ? `${boss.name} (${boss.note})` : boss.name;
}

/**
 * Sort bosses by the zone's defined order. Bosses not in the list go at the end, alphabetically by identifier.
 */
export function sortBossesByZoneOrder(zoneName: string, bosses: BossData[]): BossData[] {
  const key = normalize(zoneName);
  const order = ZONE_ORDER_MAP[key];
  if (!order) {
    return [...bosses].sort((a, b) => bossIdentifier(a).localeCompare(bossIdentifier(b)));
  }
  return [...bosses].sort((a, b) => {
    const ia = getBossOrderIndex(zoneName, a);
    const ib = getBossOrderIndex(zoneName, b);
    if (ia !== ib) return ia - ib;
    return bossIdentifier(a).localeCompare(bossIdentifier(b));
  });
}

/**
 * Which of the three ordered zones this boss belongs to (for display grouping), or null.
 */
function getOrderedZoneForBoss(boss: BossData): string | null {
  for (const zone of ORDERED_ZONE_NAMES) {
    if (getBossOrderIndex(zone, boss) !== Infinity) return zone;
  }
  return null;
}

/**
 * Display zone for grouping raidnight output. Uses override for known "Lockouts" bosses (e.g. a Burrower Parasite → Sanctus Seru),
 * then canonical zone for the three ordered zones, else boss.location or "Other".
 */
export function getDisplayZoneForBoss(boss: BossData): string {
  const override = BOSS_TO_ZONE_OVERRIDE[normalize(boss.name)];
  if (override) return override;
  return getOrderedZoneForBoss(boss) ?? boss.location ?? 'Other';
}

/**
 * For mixed-zone output (e.g. raidnight): group by zone, ordered zones first in fixed order, then others alphabetically;
 * within each group use zone order if defined, else alphabetically by identifier.
 */
export function sortBossesForDisplay(bosses: BossData[]): BossData[] {
  const groups = new Map<string, BossData[]>();
  for (const boss of bosses) {
    const group = getOrderedZoneForBoss(boss) ?? (boss.location ?? '');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(boss);
  }

  const sortedGroupNames: string[] = [];
  for (const zone of ORDERED_ZONE_NAMES) {
    if (groups.has(zone)) sortedGroupNames.push(zone);
  }
  const other = Array.from(groups.keys()).filter(k => !ORDERED_ZONE_NAMES.includes(k as any)).sort((a, b) => a.localeCompare(b));
  sortedGroupNames.push(...other);

  const result: BossData[] = [];
  for (const groupName of sortedGroupNames) {
    const list = groups.get(groupName)!;
    const key = normalize(groupName);
    const isOrdered = key in ZONE_ORDER_MAP;
    const sorted = isOrdered ? sortBossesByZoneOrder(groupName, list) : list.sort((a, b) => bossIdentifier(a).localeCompare(bossIdentifier(b)));
    result.push(...sorted);
  }
  return result;
}
