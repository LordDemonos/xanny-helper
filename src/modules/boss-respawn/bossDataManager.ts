/**
 * Manages boss data loaded from boss tracker's default_bosses.json
 */
import fs from 'fs';
import { logger } from '../../utils/logger';
import { BossData, BossDatabase } from './types';
import { NoteCache } from './noteCache';
import { expandBossAbbreviation } from './bossAbbreviations';
import { sortBossesByZoneOrder } from './zoneBossOrder';

export class BossDataManager {
  // Map of boss name (lowercase) -> array of bosses (for duplicates)
  private bosses: Map<string, BossData[]> = new Map();
  private bossDataPath: string;
  private noteCache?: NoteCache;

  constructor(bossDataPath: string, noteCache?: NoteCache) {
    this.bossDataPath = bossDataPath;
    this.noteCache = noteCache;
  }

  /**
   * Set the note cache instance
   */
  setNoteCache(noteCache: NoteCache): void {
    this.noteCache = noteCache;
  }

  /**
   * Load boss data from JSON file
   */
  loadBossData(): void {
    try {
      logger.info(`Loading boss data from: ${this.bossDataPath}`);

      if (!fs.existsSync(this.bossDataPath)) {
        throw new Error(`Boss data file not found: ${this.bossDataPath}`);
      }

      const fileContent = fs.readFileSync(this.bossDataPath, 'utf-8');
      const data: BossDatabase = JSON.parse(fileContent);

      if (!data.bosses || !Array.isArray(data.bosses)) {
        throw new Error('Invalid boss data format: expected bosses array');
      }

      // Clear existing data
      this.bosses.clear();

      // Load bosses into map (supporting duplicates)
      for (const boss of data.bosses) {
        const key = boss.name.toLowerCase();
        if (!this.bosses.has(key)) {
          this.bosses.set(key, []);
        }
        this.bosses.get(key)!.push(boss);
      }

      const totalBosses = Array.from(this.bosses.values()).reduce((sum, arr) => sum + arr.length, 0);
      const duplicateCount = Array.from(this.bosses.values()).filter(arr => arr.length > 1).length;
      logger.info(`Loaded ${totalBosses} bosses from default_bosses.json (${duplicateCount} duplicate names)`);
    } catch (error) {
      logger.error(`Failed to load boss data from ${this.bossDataPath}: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Parse boss query to extract name and note
   * Handles formats like:
   * - "Thall Va Xakra" (name only)
   * - "Thall Va Xakra North" (name + note)
   * - "Thall Va Xakra (North)" (name + note in parentheses)
   */
  private parseBossQuery(query: string): { name: string; note?: string } {
    const trimmed = query.trim();
    
    // Try to extract note from parentheses: "Name (Note)"
    const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
      return {
        name: parenMatch[1].trim(),
        note: parenMatch[2].trim(),
      };
    }
    
    // Try to extract note as last word (common patterns: "North", "South", "F1 North", etc.)
    // Check if last word matches common note patterns
    const words = trimmed.split(/\s+/);
    if (words.length > 1) {
      const lastWord = words[words.length - 1];
      const commonNotes = ['north', 'south', 'east', 'west', 'n', 's', 'e', 'w'];
      
      // If last word is a common note pattern, treat it as note
      if (commonNotes.includes(lastWord.toLowerCase())) {
        return {
          name: words.slice(0, -1).join(' '),
          note: lastWord,
        };
      }
      
      // Check for patterns like "F1 North", "F2 South", etc.
      const notePattern = /^(F\d+\s+)?(North|South|East|West|N|S|E|W)$/i;
      if (notePattern.test(lastWord)) {
        return {
          name: words.slice(0, -1).join(' '),
          note: lastWord,
        };
      }
    }
    
    // No note found, return name as-is
    return { name: trimmed };
  }

  /**
   * Get boss data by name (case-insensitive)
   * Expands abbreviations (e.g. naggy -> Lord Nagafen) and checks note cache for nicknames
   */
  getBoss(name: string): BossData | undefined {
    const parsed = this.parseBossQuery(name);
    const expandedName = expandBossAbbreviation(parsed.name);
    const key = expandedName.toLowerCase();
    const bosses = this.bosses.get(key);
    
    if (!bosses || bosses.length === 0) {
      // Boss not found by name - check if it's a note/nickname (case-insensitive)
      if (this.noteCache) {
        const mapping = this.noteCache.getFirstMappingByNote(name.trim());
        if (mapping) {
          const bossKey = mapping.bossName.toLowerCase();
          const foundBosses = this.bosses.get(bossKey);
          if (foundBosses && foundBosses.length > 0) {
            const disambiguating = mapping.note?.toLowerCase().trim();
            const matched = disambiguating
              ? foundBosses.find(b => (b.note?.toLowerCase().trim() || '') === disambiguating)
              : foundBosses[0];
            if (matched) {
              logger.debug(`Found boss "${matched.name}"${matched.note ? ` (${matched.note})` : ''} via note cache for "${name}"`);
              return matched;
            }
            return foundBosses[0];
          }
        }
      }
      return undefined;
    }
    
    // If note specified, try to match by note
    if (parsed.note) {
      const noteLower = parsed.note.toLowerCase();
      const matched = bosses.find(boss => {
        const bossNote = boss.note?.toLowerCase().trim();
        return bossNote === noteLower;
      });
      if (matched) {
        return matched;
      }
    }
    
    // Return first boss (or only boss if no duplicates)
    return bosses[0];
  }

  /**
   * Get all bosses with the same name (for duplicates)
   */
  getBossesByName(name: string): BossData[] {
    const parsed = this.parseBossQuery(name);
    const expandedName = expandBossAbbreviation(parsed.name);
    const key = expandedName.toLowerCase();
    return this.bosses.get(key) || [];
  }

  /**
   * Get all boss names for autocomplete (includes notes for duplicates)
   */
  getAllBossNames(): string[] {
    const names: string[] = [];
    for (const bosses of this.bosses.values()) {
      for (const boss of bosses) {
        if (boss.note) {
          names.push(`${boss.name} (${boss.note})`);
        } else {
          names.push(boss.name);
        }
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get bosses matching partial name (for autocomplete)
   * Includes note matching and abbreviation expansion (e.g. "naggy" matches Lord Nagafen)
   */
  getBossesByPartialName(partial: string): BossData[] {
    const partialLower = partial.toLowerCase().trim();
    const expandedPartial = expandBossAbbreviation(partial).toLowerCase();
    const matches: BossData[] = [];

    for (const bosses of this.bosses.values()) {
      for (const boss of bosses) {
        const bossNameLower = boss.name.toLowerCase();
        const bossNoteLower = boss.note?.toLowerCase().trim() || '';
        const fullName = boss.note ? `${boss.name} (${boss.note})` : boss.name;
        const fullNameLower = fullName.toLowerCase();
        
        // Match against name, note, full name, or expanded abbreviation
        if (
          bossNameLower.includes(partialLower) ||
          bossNoteLower.includes(partialLower) ||
          fullNameLower.includes(partialLower) ||
          bossNameLower.includes(expandedPartial) ||
          fullNameLower.includes(expandedPartial)
        ) {
          matches.push(boss);
        }
      }
    }

    // Sort by relevance
    return matches.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aNote = a.note?.toLowerCase().trim() || '';
      const bNote = b.note?.toLowerCase().trim() || '';
      const aFull = a.note ? `${aName} (${aNote})` : aName;
      const bFull = b.note ? `${bName} (${bNote})` : bName;
      
      // Exact name match first
      const aNameMatch = aName.startsWith(partialLower);
      const bNameMatch = bName.startsWith(partialLower);
      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;
      
      // Then by full name match
      const aFullMatch = aFull.startsWith(partialLower);
      const bFullMatch = bFull.startsWith(partialLower);
      if (aFullMatch && !bFullMatch) return -1;
      if (!aFullMatch && bFullMatch) return 1;
      
      // Then alphabetically
      return aFull.localeCompare(bFull);
    });
  }

  /**
   * Get all bosses (for debugging/admin purposes)
   */
  getAllBosses(): BossData[] {
    const allBosses: BossData[] = [];
    for (const bosses of this.bosses.values()) {
      allBosses.push(...bosses);
    }
    return allBosses;
  }

  /**
   * Check if boss exists
   */
  hasBoss(name: string): boolean {
    const parsed = this.parseBossQuery(name);
    const expandedName = expandBossAbbreviation(parsed.name);
    const key = expandedName.toLowerCase();
    const bosses = this.bosses.get(key);
    
    if (!bosses || bosses.length === 0) {
      return false;
    }
    
    // If note specified, check if specific boss exists
    if (parsed.note) {
      const noteLower = parsed.note.toLowerCase();
      return bosses.some(boss => {
        const bossNote = boss.note?.toLowerCase().trim();
        return bossNote === noteLower;
      });
    }
    
    return true;
  }

  /**
   * Get all bosses in a specific location/zone (case-insensitive partial match)
   */
  getBossesByLocation(location: string): BossData[] {
    const locationLower = location.toLowerCase().trim();
    const matches: BossData[] = [];

    for (const bosses of this.bosses.values()) {
      for (const boss of bosses) {
        const bossLocation = boss.location?.toLowerCase().trim() || '';
        // Match if location contains the query or query contains the location
        if (bossLocation.includes(locationLower) || locationLower.includes(bossLocation)) {
          matches.push(boss);
        }
      }
    }

    return sortBossesByZoneOrder(location, matches);
  }

  /**
   * Get all unique locations/zones
   */
  getAllLocations(): string[] {
    const locations = new Set<string>();
    for (const bosses of this.bosses.values()) {
      for (const boss of bosses) {
        if (boss.location) {
          locations.add(boss.location);
        }
      }
    }
    return Array.from(locations).sort((a, b) => a.localeCompare(b));
  }
}
