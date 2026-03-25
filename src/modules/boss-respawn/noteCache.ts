/**
 * Manages caching of boss notes/nicknames to boss name mappings
 * Allows users to query bosses by their notes/nicknames
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

const AGENT_LOG_PATH = path.join(process.cwd(), '.cursor', 'debug.log');
function agentLog(payload: Record<string, unknown>): void {
  try {
    fs.appendFileSync(AGENT_LOG_PATH, JSON.stringify(payload) + '\n');
  } catch {
    // ignore
  }
}

interface NoteMapping {
  bossName: string;
  note: string;
  lastSeen: Date;
}

export class NoteCache {
  // Map of note (lowercase) -> array of boss mappings (for notes that map to multiple bosses)
  private noteToBossMap: Map<string, NoteMapping[]> = new Map();
  
  // Map of boss name (lowercase) -> array of notes (for reverse lookup)
  private bossToNotesMap: Map<string, Set<string>> = new Map();

  /**
   * Cache a note/nickname mapping to a boss name
   * @param bossName The boss name
   * @param note The note/nickname (e.g., "South Blob", "Rhag 1", "F1 North")
   */
  cacheNote(bossName: string, note: string): void {
    if (!bossName || !note) {
      return;
    }

    const noteLower = note.toLowerCase().trim();
    const bossNameLower = bossName.toLowerCase().trim();

    // Skip generic location notes that aren't useful as nicknames
    const genericNotes = ['in', 'the', 'at', 'has', 'been', 'slain'];
    if (genericNotes.includes(noteLower)) {
      return;
    }

    // Skip location notes that start with "in " or "at "
    if (noteLower.startsWith('in ') || noteLower.startsWith('at ')) {
      return;
    }

    // Skip notes that are just location names (common zone names)
    const locationKeywords = ['temple', 'ruins', 'plane', 'deep', 'sanctus', 'akheva', 'vex thal'];
    const noteWords = noteLower.split(/\s+/);
    if (noteWords.some(word => locationKeywords.includes(word))) {
      // Only skip if it's clearly a location note (contains location keyword and is longer)
      if (noteLower.includes('in ') || noteLower.includes('at ') || noteWords.length > 2) {
        return;
      }
    }

    // Skip very short notes (likely not nicknames)
    if (noteLower.length < 2) {
      return;
    }

    // Add to note -> boss mapping
    if (!this.noteToBossMap.has(noteLower)) {
      this.noteToBossMap.set(noteLower, []);
    }

    const mappings = this.noteToBossMap.get(noteLower)!;
    // Check if this mapping already exists (same boss name and note)
    const existing = mappings.find(
      m => m.bossName.toLowerCase() === bossNameLower && m.note.toLowerCase() === noteLower
    );
    if (existing) {
      existing.lastSeen = new Date();
    } else {
      mappings.push({
        bossName: bossName.trim(),
        note: note.trim(),
        lastSeen: new Date(),
      });
      logger.debug(`Cached note mapping: "${note}" -> "${bossName}"`);
    }

    // Add to boss -> notes mapping (reverse lookup)
    if (!this.bossToNotesMap.has(bossNameLower)) {
      this.bossToNotesMap.set(bossNameLower, new Set());
    }
    this.bossToNotesMap.get(bossNameLower)!.add(note.trim());
  }

  /**
   * Cache a user-defined nickname for a boss (no filtering; always stored).
   * Use this when a user sets a custom nickname via /boss-nickname.
   * @param bossName The boss name
   * @param nickname The nickname the user wants to use
   * @param disambiguatingNote Optional note when boss has duplicates (e.g. "South Blob")
   */
  cacheUserNickname(bossName: string, nickname: string, disambiguatingNote?: string): void {
    // #region agent log
    const _payloadA = { location: 'noteCache.ts:cacheUserNickname:entry', message: 'cacheUserNickname called', data: { nickname, bossName, disambiguatingNote: disambiguatingNote ?? null }, timestamp: Date.now(), hypothesisId: 'A' };
    fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_payloadA) }).catch(() => {});
    agentLog(_payloadA);
    // #endregion
    if (!bossName?.trim() || !nickname?.trim()) {
      return;
    }
    const noteLower = nickname.toLowerCase().trim();
    const bossNameLower = bossName.toLowerCase().trim();
    const disambiguating = disambiguatingNote?.trim();

    if (!this.noteToBossMap.has(noteLower)) {
      this.noteToBossMap.set(noteLower, []);
    }
    const mappings = this.noteToBossMap.get(noteLower)!;
    const existing = mappings.find(
      m =>
        m.bossName.toLowerCase() === bossNameLower &&
        (m.note || '').toLowerCase() === (disambiguating || '').toLowerCase()
    );
    if (existing) {
      existing.lastSeen = new Date();
      existing.note = disambiguating ?? existing.note;
    } else {
      mappings.push({
        bossName: bossName.trim(),
        note: disambiguating ?? '', // only set for duplicate bosses; empty for single boss
        lastSeen: new Date(),
      });
      logger.debug(`Cached user nickname: "${nickname}" -> "${bossName}"${disambiguating ? ` (${disambiguating})` : ''}`);
    }
    // #region agent log
    const _payloadA2 = { location: 'noteCache.ts:cacheUserNickname:afterAdd', message: 'after add to map', data: { keyUsed: noteLower, mapSize: this.noteToBossMap.size }, timestamp: Date.now(), hypothesisId: 'A' };
    fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_payloadA2) }).catch(() => {});
    agentLog(_payloadA2);
    // #endregion
    if (!this.bossToNotesMap.has(bossNameLower)) {
      this.bossToNotesMap.set(bossNameLower, new Set());
    }
    this.bossToNotesMap.get(bossNameLower)!.add(nickname.trim());
  }

  /**
   * Get the first (most recent) boss mapping for a note/nickname, including disambiguating note.
   * Use this to resolve the exact boss when there are duplicates.
   */
  getFirstMappingByNote(note: string): { bossName: string; note?: string } | null {
    const noteLower = note.toLowerCase().trim();
    const mappings = this.noteToBossMap.get(noteLower);
    if (!mappings || mappings.length === 0) {
      return null;
    }
    const sorted = [...mappings].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
    const m = sorted[0];
    return {
      bossName: m.bossName,
      note: m.note || undefined,
    };
  }

  /**
   * Get boss name(s) associated with a note/nickname
   * @param note The note/nickname to look up
   * @returns Array of boss names, or empty array if not found
   */
  getBossesByNote(note: string): string[] {
    const noteLower = note.toLowerCase().trim();
    const mappings = this.noteToBossMap.get(noteLower);
    
    if (!mappings || mappings.length === 0) {
      return [];
    }

    // Return unique boss names (most recently seen first)
    const bossNames = mappings
      .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
      .map(m => m.bossName);
    
    // Remove duplicates while preserving order
    return [...new Set(bossNames)];
  }

  /**
   * Get all notes associated with a boss name
   * @param bossName The boss name to look up
   * @returns Array of notes, or empty array if not found
   */
  getNotesByBoss(bossName: string): string[] {
    const bossNameLower = bossName.toLowerCase().trim();
    const notes = this.bossToNotesMap.get(bossNameLower);
    
    if (!notes) {
      return [];
    }

    return Array.from(notes);
  }

  /**
   * Check if a note exists in the cache
   */
  hasNote(note: string): boolean {
    const noteLower = note.toLowerCase().trim();
    return this.noteToBossMap.has(noteLower) && this.noteToBossMap.get(noteLower)!.length > 0;
  }

  /**
   * Get all cached notes (for debugging/admin)
   */
  getAllNotes(): string[] {
    return Array.from(this.noteToBossMap.keys()).sort();
  }

  /**
   * Get boss mappings whose note/nickname matches the partial string (for autocomplete)
   * Returns mappings where the note contains the partial or the partial contains the note
   */
  getMappingsByPartialNote(partial: string): { bossName: string; note?: string; nickname: string }[] {
    const partialLower = partial.toLowerCase().trim();
    // #region agent log
    const _payloadB = { location: 'noteCache.ts:getMappingsByPartialNote:entry', message: 'getMappingsByPartialNote', data: { partial, partialLower, mapSize: this.noteToBossMap.size }, timestamp: Date.now(), hypothesisId: 'B' };
    fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_payloadB) }).catch(() => {});
    agentLog(_payloadB);
    // #endregion
    if (!partialLower) return [];

    const results: { bossName: string; note?: string; nickname: string }[] = [];
    const seen = new Set<string>();

    for (const [noteKey, mappings] of this.noteToBossMap.entries()) {
      if (!noteKey.includes(partialLower) && !partialLower.includes(noteKey)) {
        continue;
      }
      const sorted = [...mappings].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
      const m = sorted[0];
      const key = m.note ? `${m.bossName}:${m.note}` : m.bossName;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        bossName: m.bossName,
        note: m.note || undefined,
        nickname: noteKey,
      });
    }
    // #region agent log
    const _payloadB2 = { location: 'noteCache.ts:getMappingsByPartialNote:exit', message: 'getMappingsByPartialNote result', data: { resultsCount: results.length }, timestamp: Date.now(), hypothesisId: 'B' };
    fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_payloadB2) }).catch(() => {});
    agentLog(_payloadB2);
    // #endregion

    return results;
  }

  /**
   * Get statistics about the cache
   */
  getStats(): { totalNotes: number; totalBosses: number; totalMappings: number } {
    let totalMappings = 0;
    for (const mappings of this.noteToBossMap.values()) {
      totalMappings += mappings.length;
    }
    
    return {
      totalNotes: this.noteToBossMap.size,
      totalBosses: this.bossToNotesMap.size,
      totalMappings,
    };
  }

  /**
   * Clear old mappings (older than specified days)
   * Useful for cleanup to prevent stale data
   */
  clearOldMappings(daysOld: number = 30): number {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    let clearedCount = 0;

    for (const [note, mappings] of this.noteToBossMap.entries()) {
      const filtered = mappings.filter(m => m.lastSeen >= cutoffDate);
      if (filtered.length === 0) {
        this.noteToBossMap.delete(note);
        clearedCount++;
      } else if (filtered.length < mappings.length) {
        this.noteToBossMap.set(note, filtered);
        clearedCount += mappings.length - filtered.length;
      }
    }

    // Rebuild boss -> notes map (key is the note/nickname that maps to the boss)
    this.bossToNotesMap.clear();
    for (const [noteKey, mappings] of this.noteToBossMap.entries()) {
      for (const mapping of mappings) {
        const bossNameLower = mapping.bossName.toLowerCase();
        if (!this.bossToNotesMap.has(bossNameLower)) {
          this.bossToNotesMap.set(bossNameLower, new Set());
        }
        this.bossToNotesMap.get(bossNameLower)!.add(noteKey);
      }
    }

    return clearedCount;
  }
}
