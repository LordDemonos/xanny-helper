/**
 * Verification script for boss respawn parsing and lookup.
 * Run: npm run verify-boss-respawn (or npx ts-node scripts/verify-boss-respawn.ts)
 *
 * Format reference: Project-Quarm-Boss-Tracker uses template
 *   {discord_timestamp} {monster} ({note}) was killed in {location}!
 * (see main.py default message_template). We also support "has been slain!" variants.
 *
 * Ensures:
 * 1. "has been slain!" and "was killed in" formats parse to name + note.
 * 2. Fullwidth parentheses (）) are handled.
 * 3. After recordKill(bossName, time, note), getKillRecord("Vyzh`dra the Cursed", undefined) finds the record.
 */
import * as path from 'path';
import { MessageParser } from '../src/modules/boss-respawn/messageParser';
import { BossDataManager } from '../src/modules/boss-respawn/bossDataManager';
import { RespawnCalculator } from '../src/modules/boss-respawn/respawnCalculator';
import { NoteCache } from '../src/modules/boss-respawn/noteCache';

const BOSS_DATA_PATH = path.join(process.cwd(), 'data', 'default_bosses.json');

function mockMessage(content: string, createdTimestamp: number = Date.now()): { content: string; createdTimestamp: number; author: { bot: boolean; tag: string; id: string } } {
  return {
    content,
    createdTimestamp,
    author: { bot: true, tag: 'Boss Tracker#0', id: '123' },
  };
}

function run(): void {
  let failed = 0;

  // 1) Parse Boss Tracker "has been slain" with ASCII parentheses
  const content1 = '[Saturday, February 14, 2026 11:26 PM] Vyzh`dra the Cursed (Cursed 3 in Ssraeshza Temple) has been slain!';
  const parser = new MessageParser();
  const msg1 = mockMessage(content1, new Date('2026-02-15T04:26:47.000Z').getTime());
  const parsed1 = parser.parseKillMessage(msg1 as any);
  if (!parsed1) {
    console.error('FAIL: Parser returned null for ASCII-paren Boss Tracker message.');
    failed++;
  } else {
    if (parsed1.bossName !== 'Vyzh`dra the Cursed') {
      console.error(`FAIL: Expected bossName "Vyzh\`dra the Cursed", got "${parsed1.bossName}"`);
      failed++;
    } else {
      console.log('OK: bossName = "Vyzh`dra the Cursed"');
    }
    if (parsed1.note !== 'Cursed 3') {
      console.error(`FAIL: Expected note "Cursed 3", got "${parsed1.note ?? '(undefined)'}"`);
      failed++;
    } else {
      console.log('OK: note = "Cursed 3"');
    }
    // Bracket long-date [Saturday, February 14, 2026 11:26 PM] is EST → 2026-02-15 04:26 UTC
    const expectedBracketUtc = new Date('2026-02-15T04:26:00.000Z').getTime();
    if (Math.abs(parsed1.killTime.getTime() - expectedBracketUtc) > 60 * 1000) {
      console.error(`FAIL: Expected killTime ~2026-02-15T04:26:00Z (from bracket EST), got ${parsed1.killTime.toISOString()}`);
      failed++;
    } else {
      console.log('OK: Bracket long-date [Saturday, February 14, 2026 11:26 PM] parsed as EST → correct UTC.');
    }
  }

  // 2) Parse same message with fullwidth closing paren (U+FF09)
  const fullwidthClose = content1.replace(')', '\uFF09');
  const msg2 = mockMessage(fullwidthClose, new Date('2026-02-15T04:26:47.000Z').getTime());
  const parsed2 = parser.parseKillMessage(msg2 as any);
  if (!parsed2) {
    console.error('FAIL: Parser returned null for fullwidth-closing-paren message.');
    failed++;
  } else if (parsed2.bossName !== 'Vyzh`dra the Cursed' || parsed2.note !== 'Cursed 3') {
    console.error(`FAIL: Fullwidth paren parse got bossName="${parsed2.bossName}", note="${parsed2.note ?? '(undefined)'}"`);
    failed++;
  } else {
    console.log('OK: Fullwidth closing paren parsed correctly.');
  }

  // 3) Parse Boss Tracker default format: "was killed in" (Project-Quarm-Boss-Tracker main.py template)
  const contentWasKilled = '<t:1739586407:F> Vyzh`dra the Cursed (Cursed 3 in Ssraeshza Temple) was killed in Ssraeshza Temple!';
  const msg3 = mockMessage(contentWasKilled, new Date('2026-02-15T04:26:47.000Z').getTime());
  const parsed3 = parser.parseKillMessage(msg3 as any);
  if (!parsed3 || parsed3.bossName !== 'Vyzh`dra the Cursed' || parsed3.note !== 'Cursed 3') {
    console.error(`FAIL: "was killed in" format got bossName="${parsed3?.bossName ?? 'null'}", note="${parsed3?.note ?? '(undefined)'}"`);
    failed++;
  } else {
    console.log('OK: Boss Tracker "was killed in" format parsed correctly.');
  }

  // 4) Continuation-only line (when message is split): "Cursed 3 in Ssraeshza Temple) has been slain!"
  const contentContinuation = 'Cursed 3 in Ssraeshza Temple) has been slain!';
  const msg4 = mockMessage(contentContinuation, new Date('2026-02-15T04:26:47.000Z').getTime());
  const parsed4 = parser.parseKillMessage(msg4 as any);
  if (!parsed4 || parsed4.bossName !== 'Vyzh`dra the Cursed' || parsed4.note !== 'Cursed 3') {
    console.error(`FAIL: Continuation-only line got bossName="${parsed4?.bossName ?? 'null'}", note="${parsed4?.note ?? '(undefined)'}"`);
    failed++;
  } else {
    console.log('OK: Continuation-only "Cursed 3 in ...) has been slain!" resolved to Vyzh`dra the Cursed (Cursed 3).');
  }

  // 5) Continuation-only "Exiled 2 in Ssraeshza Temple) has been slain!" → Vyzh`dra the Exiled (Exiled 2)
  const contentExiledContinuation = 'Exiled 2 in Ssraeshza Temple) has been slain!';
  const msgExiled = mockMessage(contentExiledContinuation, new Date('2026-02-15T04:44:58.000Z').getTime());
  const parsedExiled = parser.parseKillMessage(msgExiled as any);
  if (!parsedExiled || parsedExiled.bossName !== 'Vyzh`dra the Exiled' || parsedExiled.note !== 'Exiled 2') {
    console.error(`FAIL: Continuation "Exiled 2 in ..." got bossName="${parsedExiled?.bossName ?? 'null'}", note="${parsedExiled?.note ?? '(undefined)'}"`);
    failed++;
  } else {
    console.log('OK: Continuation-only "Exiled 2 in ...) has been slain!" resolved to Vyzh`dra the Exiled (Exiled 2).');
  }

  // 6) Record kill and lookup by canonical name (no note)
  const bossDataManager = new BossDataManager(BOSS_DATA_PATH);
  const noteCache = new NoteCache();
  const calculator = new RespawnCalculator(bossDataManager, noteCache);
  const killTime = new Date('2026-02-15T04:26:47.000Z'); // Feb 14 11:26 PM EST
  calculator.recordKill('Vyzh`dra the Cursed', killTime, 'Cursed 3');
  let record = calculator.getKillRecord('Vyzh`dra the Cursed', undefined);
  if (!record) {
    console.error('FAIL: getKillRecord("Vyzh`dra the Cursed", undefined) returned undefined after recordKill(..., "Cursed 3").');
    failed++;
  } else if (record.lastKilled.getTime() !== killTime.getTime()) {
    console.error(`FAIL: getKillRecord returned wrong time: ${record.lastKilled.toISOString()}`);
    failed++;
  } else {
    console.log('OK: getKillRecord("Vyzh`dra the Cursed", undefined) found the recorded kill.');
  }

  // 7) Exiled: record with note "Exiled 2", lookup "Vyzh`dra the Exiled" finds it
  const killTimeExiled = new Date('2026-02-15T04:44:58.000Z'); // Feb 14 11:44 PM EST (Saturday)
  calculator.recordKill('Vyzh`dra the Exiled', killTimeExiled, 'Exiled 2');
  record = calculator.getKillRecord('Vyzh`dra the Exiled', undefined);
  if (!record) {
    console.error('FAIL: getKillRecord("Vyzh`dra the Exiled", undefined) returned undefined after recordKill(..., "Exiled 2").');
    failed++;
  } else if (record.lastKilled.getTime() !== killTimeExiled.getTime()) {
    console.error(`FAIL: getKillRecord(Exiled) returned wrong time: ${record.lastKilled.toISOString()}`);
    failed++;
  } else {
    console.log('OK: getKillRecord("Vyzh`dra the Exiled", undefined) found kill recorded with note "Exiled 2".');
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

run();
