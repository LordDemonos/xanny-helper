/**
 * Shared boss name abbreviations for case-insensitive lookup
 * Used by message parser and boss data manager
 */
const BOSS_ABBREVIATIONS: { [key: string]: string } = {
  'lodi': 'Lodizal',
  'naggy': 'Lord Nagafen',
  'nagafen': 'Lord Nagafen',
  'scribe': 'Royal Scribe Kaavin',
  'royal scribe': 'Royal Scribe Kaavin',
  'rskaavin': 'Royal Scribe Kaavin',
  'rs kaavin': 'Royal Scribe Kaavin',
};

/**
 * Expand a boss name abbreviation to full name (case-insensitive)
 */
export function expandBossAbbreviation(bossName: string): string {
  const lower = bossName.toLowerCase().trim();
  if (!lower) return bossName;
  if (BOSS_ABBREVIATIONS[lower]) {
    return BOSS_ABBREVIATIONS[lower];
  }
  for (const [abbr, fullName] of Object.entries(BOSS_ABBREVIATIONS)) {
    if (lower.startsWith(abbr) || lower.includes(abbr)) {
      return fullName;
    }
  }
  return bossName;
}
