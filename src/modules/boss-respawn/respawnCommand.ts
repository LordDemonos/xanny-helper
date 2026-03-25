/**
 * Discord slash command handler for /respawn and /lockout commands
 */
import fs from 'fs';
import path from 'path';
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  REST,
  Routes,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger';

const AGENT_LOG_PATH = path.join(process.cwd(), '.cursor', 'debug.log');
function agentLog(payload: Record<string, unknown>): void {
  try {
    fs.appendFileSync(AGENT_LOG_PATH, JSON.stringify(payload) + '\n');
  } catch {
    // ignore
  }
}
import { BossDataManager } from './bossDataManager';
import { RespawnCalculator } from './respawnCalculator';
import { NoteCache } from './noteCache';
import { BossData } from './types';
import { CacheManager } from '../cache/cacheManager';
import { RaidNightScheduleEntry } from '../cache/cacheManager';
import { getRaidNightLockouts } from '../raid/raidNightLockouts';
import { parseScheduleTime } from '../../utils/parseScheduleTime';

const HELP_FEATURES_SECTION = [
  '**Major features**',
  '• **Raid schedule** — Reads the raid schedule and updates it on https://formerglory.lol/',
  '• **Guild bank inventory** — Uploads guild bank inventory files to the website; GitHub auto-generates web pages from them.',
  '• **Feedback & suggestions** — Reads Feedback & Suggestions results and posts them to the feedback channel.',
  '• **Boss commands** — Enables /respawn, /lockout, /raidnight, and related commands. Run /raidnight during the raid (9PM–11:59PM ET) to see remaining targets and where to go.',
].join('\n');

const HELP_COMMANDS_LIST: { name: string; description: string; subcommands?: string }[] = [
  { name: '/respawn', description: 'Check when a boss will respawn. Reply is only visible to you unless you use "Post to channel"' },
  { name: '/lockout', description: 'Check lockout/respawn time for a boss. Reply is only visible to you unless you use "Post to channel"' },
  { name: '/boss-nickname', description: 'Set a personal nickname for a boss (for /respawn and /lockout)' },
  { name: '/raidnight', description: 'Lockouts for next raid (which_raid: 0) or Next +1/+2 (which_raid: 1 or 2). During the raid window (9PM–11:59PM ET) shows "Current raid in progress" and remaining targets so you know where to go. Reply only to you unless "Post to channel"' },
  { name: '/schedule', description: 'Schedule automatic raid night lockout posts (admin only)', subcommands: 'start, list, cancel, post-now' },
];

export class RespawnCommandHandler {
  private bossDataManager: BossDataManager;
  private respawnCalculator: RespawnCalculator;
  private noteCache: NoteCache;
  private allowedChannels: Set<string>;
  private targetTrackingChannelId: string;
  private cacheManager: CacheManager | null;

  constructor(
    bossDataManager: BossDataManager,
    respawnCalculator: RespawnCalculator,
    allowedChannels: string[],
    targetTrackingChannelId: string,
    noteCache: NoteCache,
    cacheManager?: CacheManager | null
  ) {
    this.bossDataManager = bossDataManager;
    this.respawnCalculator = respawnCalculator;
    this.noteCache = noteCache;
    this.allowedChannels = new Set(allowedChannels);
    this.targetTrackingChannelId = targetTrackingChannelId;
    this.cacheManager = cacheManager ?? null;
  }

  /**
   * Check if command is allowed in this channel
   * If BOSS_COMMAND_CHANNELS is configured, uses whitelist
   * Otherwise, checks if bot has SendMessages permission (works in any channel)
   */
  async isAllowedChannel(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const channelId = interaction.channelId;
    
    // Never allow in target-tracking channel
    if (channelId === this.targetTrackingChannelId) {
      return false;
    }

    // If allowed channels are configured, use whitelist
    if (this.allowedChannels.size > 0) {
      return this.allowedChannels.has(channelId);
    }

    // Otherwise, check if bot has permission to send messages in this channel
    // This allows commands to work in any channel where bot has permissions
    if (interaction.channel && 'permissionsFor' in interaction.channel) {
      const me = interaction.guild?.members.me;
      if (me) {
        const permissions = interaction.channel.permissionsFor(me);
        if (permissions) {
          return permissions.has('SendMessages');
        }
      }
    }

    // Fallback: allow if we can't check permissions (better to try than block)
    // This handles DMs and edge cases
    return true;
  }

  /**
   * Register slash commands with Discord
   */
  async registerCommands(clientId: string, token: string, guildId: string): Promise<void> {
    try {
      const commands = [
        new SlashCommandBuilder()
          .setName('help')
          .setDescription('List commands and bot features')
          .toJSON(),
        new SlashCommandBuilder()
          .setName('respawn')
          .setDescription('Check when a boss will respawn')
          .addStringOption(option =>
            option
              .setName('boss')
              .setDescription('Name of the boss')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addBooleanOption(option =>
            option
              .setName('post_to_channel')
              .setDescription('Post the result in the channel for everyone to see (default: only you)')
              .setRequired(false)
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName('lockout')
          .setDescription('Check the lockout/respawn time for a boss')
          .addStringOption(option =>
            option
              .setName('boss')
              .setDescription('Name of the boss')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addBooleanOption(option =>
            option
              .setName('post_to_channel')
              .setDescription('Post the result in the channel for everyone to see (default: only you)')
              .setRequired(false)
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName('boss-nickname')
          .setDescription('Set a personal nickname for a boss to use with /respawn and /lockout')
          .addStringOption(option =>
            option
              .setName('boss')
              .setDescription('The boss to nickname')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(option =>
            option
              .setName('nickname')
              .setDescription('Nickname to use when querying this boss (e.g. blob, vt north)')
              .setRequired(true)
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName('raidnight')
          .setDescription('Lockouts for all mobs that will be up for a raid (9PM–11:59PM ET)')
          .addIntegerOption(option =>
            option
              .setName('which_raid')
              .setDescription('0 = next raid, 1 = raid after next (Next +1), 2 = Next +2, etc.')
              .setRequired(false)
              .setMinValue(0)
              .setMaxValue(10)
          )
          .addBooleanOption(option =>
            option
              .setName('post_to_channel')
              .setDescription('Post the result in the channel for everyone to see (default: only you)')
              .setRequired(false)
          )
          .toJSON(),
        new SlashCommandBuilder()
          .setName('schedule')
          .setDescription('Schedule automatic raid night lockout posts in this channel (admin only)')
          .addSubcommand(sub =>
            sub
              .setName('start')
              .setDescription('Post raid night lockouts at a set time on raid days')
              .addStringOption(opt =>
                opt
                  .setName('time')
                  .setDescription('Time to post (EST), e.g. 7pm or 19:00')
                  .setRequired(true)
              )
          )
          .addSubcommand(sub =>
            sub.setName('list').setDescription('List active raid night schedules in this server')
          )
          .addSubcommand(sub =>
            sub.setName('cancel').setDescription('Cancel a scheduled raid night post')
          )
          .addSubcommand(sub =>
            sub.setName('post-now').setDescription('Post raid night lockouts to this channel now (no schedule created)')
          )
          .toJSON(),
      ];

      const rest = new REST({ version: '10' }).setToken(token);

      logger.info('Registering slash commands...');

      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });

      logger.info('Successfully registered slash commands');
    } catch (error) {
      logger.error(`Failed to register slash commands: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Handle autocomplete for boss names
   */
  async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = interaction.options.getFocused(true);

    if (focusedValue.name !== 'boss') {
      return;
    }

    const partial = focusedValue.value as string;

    let choices: { name: string; value: string }[] = [];

    if (partial.length === 0) {
      // No input, return first 20 bosses alphabetically (with notes for duplicates)
      // Plus a few zones
      const allBosses = this.bossDataManager.getAllBosses();
      const allLocations = this.bossDataManager.getAllLocations();
      
      // Add bosses
      const bossChoices = allBosses.slice(0, 20).map(boss => {
        const displayName = boss.note 
          ? `${boss.name} (${boss.note})${boss.location ? ` - ${boss.location}` : ''}`
          : `${boss.name}${boss.location ? ` (${boss.location})` : ''}`;
        const value = boss.note ? `${boss.name} (${boss.note})` : boss.name;
        return {
          name: displayName,
          value: value,
        };
      });
      
      // Add zones (limit to 5)
      const zoneChoices = allLocations.slice(0, 5).map(location => ({
        name: `📍 ${location} (zone)`,
        value: location,
      }));
      
      choices = [...bossChoices, ...zoneChoices];
    } else {
      const partialLower = partial.toLowerCase().trim();
      
      // Check if it matches a zone
      const allLocations = this.bossDataManager.getAllLocations();
      const matchingZones = allLocations.filter(loc => 
        loc.toLowerCase().includes(partialLower)
      );
      
      // Check if it matches bosses (by name or abbreviation)
      const matchingBosses = this.bossDataManager.getBossesByPartialName(partial);
      
      // Check if it matches user-defined nicknames / cached notes
      const nicknameMappings = this.noteCache.getMappingsByPartialNote(partial);
      // #region agent log
      const _pB = { location: 'respawnCommand.ts:handleAutocomplete', message: 'autocomplete partial', data: { partial, nicknameMappingsLength: nicknameMappings.length }, timestamp: Date.now(), hypothesisId: 'B' };
      fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_pB) }).catch(() => {});
      agentLog(_pB);
      // #endregion
      const nicknameChoices: { name: string; value: string }[] = [];
      const bossValues = new Set(matchingBosses.map(b => b.note ? `${b.name} (${b.note})` : b.name));
      for (const mapping of nicknameMappings) {
        const valueForBoss = mapping.note ? `${mapping.bossName} (${mapping.note})` : mapping.bossName;
        if (bossValues.has(valueForBoss)) continue; // already in boss list
        const boss = this.bossDataManager.getBoss(valueForBoss);
        // #region agent log
        const _pC = { location: 'respawnCommand.ts:handleAutocomplete:loop', message: 'mapping getBoss', data: { valueForBoss, bossFound: !!boss, mappingNickname: mapping.nickname }, timestamp: Date.now(), hypothesisId: 'C' };
        fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_pC) }).catch(() => {});
        agentLog(_pC);
        // #endregion
        if (!boss) continue;
        const displayName = boss.note
          ? `${boss.name} (${boss.note}) – ${mapping.nickname}`
          : `${boss.name} – ${mapping.nickname}`;
        nicknameChoices.push({
          name: displayName.length > 100 ? `${boss.name} (${mapping.nickname})` : displayName,
          value: mapping.nickname,
        });
      }

      const zoneChoices = matchingZones.slice(0, 5).map(location => ({
        name: `📍 ${location} (zone)`,
        value: location,
      }));

      const maxNicknames = 5;
      const nicknameChoicesCapped = nicknameChoices.slice(0, maxNicknames);
      const maxBossChoices = 25 - zoneChoices.length - nicknameChoicesCapped.length;
      const bossChoices = matchingBosses.slice(0, Math.max(0, maxBossChoices)).map(boss => {
        const displayName = boss.note 
          ? `${boss.name} (${boss.note})${boss.location ? ` - ${boss.location}` : ''}`
          : `${boss.name}${boss.location ? ` (${boss.location})` : ''}`;
        const value = boss.note ? `${boss.name} (${boss.note})` : boss.name;
        return {
          name: displayName,
          value: value,
        };
      });
      
      choices = [...zoneChoices, ...nicknameChoicesCapped, ...bossChoices];
    }

    await interaction.respond(choices);
  }

  /**
   * Handle /help command — major features and command list
   */
  async handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandsBlock = HELP_COMMANDS_LIST.map(
      (c) => `• ${c.name} — ${c.description}${c.subcommands ? `. Subcommands: ${c.subcommands}` : ''}`
    ).join('\n');
    const content = [HELP_FEATURES_SECTION, '', '**Commands**', commandsBlock].join('\n');

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * Handle /respawn command
   */
  async handleRespawnCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;
    const user = interaction.user.tag;

    logger.debug(`Command received: /respawn ${interaction.options.getString('boss')} by ${user} in channel ${channelId}`);

    // Check channel restrictions
    const isAllowed = await this.isAllowedChannel(interaction);
    if (!isAllowed) {
      if (channelId === this.targetTrackingChannelId) {
        logger.info(`/respawn command blocked in target-tracking channel ${channelId} by user ${user}`);
        await interaction.reply({
          content: 'This command cannot be used in the target-tracking channel. Please use it in another channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (this.allowedChannels.size > 0) {
        logger.info(`/respawn command blocked in channel ${channelId} by user ${user} (not in allowed channels)`);
        await interaction.reply({
          content: 'This command can only be used in specific channels. Please use it in an allowed channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        logger.info(`/respawn command blocked in channel ${channelId} by user ${user} (no SendMessages permission)`);
        await interaction.reply({
          content: 'I don\'t have permission to send messages in this channel. Please use this command in a channel where I have Send Messages permission.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    logger.info(`Command allowed in channel ${channelId}`);

    const bossQuery = interaction.options.getString('boss', true);
    const postToChannel = interaction.options.getBoolean('post_to_channel') === true;
    logger.info(`Looking up boss: "${bossQuery}"`);

    try {
      // First check if this is a zone/location query
      const zoneBosses = this.bossDataManager.getBossesByLocation(bossQuery);
      if (zoneBosses.length > 0) {
        // This looks like a zone query - handle zone response
        logger.info(`Zone query detected: "${bossQuery}" - found ${zoneBosses.length} bosses`);
        await this.handleZoneRespawn(interaction, bossQuery, zoneBosses, postToChannel);
        return;
      }

      // Not a zone query, proceed with boss lookup
      const boss = this.bossDataManager.getBoss(bossQuery);
      if (!boss) {
        // Check if there are multiple bosses with this name (duplicates)
        const allBosses = this.bossDataManager.getBossesByName(bossQuery);
        if (allBosses.length > 1) {
          // Multiple bosses found - ask user to specify
          const bossList = allBosses.map(b => {
            const note = b.note ? ` (${b.note})` : '';
            return `**${b.name}${note}**`;
          }).join(', ');
          
          await interaction.reply({
            content: `Multiple bosses found with name **${bossQuery}**. Please specify which one:\n${bossList}\n\nYou can use: \`/respawn ${bossQuery} (North)\` or \`/respawn ${bossQuery} North\``,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        
        logger.error(`Boss '${bossQuery}' not found in database when checking respawn time`);
        await interaction.reply({
          content: `I don't know when **${bossQuery}** will respawn. (Boss not found in database)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      
      const bossName = boss.name;
      const bossNote = boss.note;
      const bossIdentifier = bossNote ? `${bossName} (${bossNote})` : bossName;

      // Check if respawn time is configured
      if (boss.respawn_hours === null || boss.respawn_hours === undefined) {
        logger.warn(`Boss '${bossIdentifier}' has no respawn_hours configured. Location: ${boss.location || 'unknown'}, Enabled: ${boss.enabled || false}`);
        await interaction.reply({
          content: `I don't know when **${bossIdentifier}** will respawn. (Respawn time not configured)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Calculate respawn time (use query string to preserve note matching)
      logger.info(`Calculating respawn time for boss: ${bossIdentifier} (query: "${bossQuery}")`);
      const killRecord = this.respawnCalculator.getKillRecord(bossName, bossNote);
      logger.info(`Kill record lookup for "${bossName}"${bossNote ? ` (note: "${bossNote}")` : ''}: ${killRecord ? `Found - Last killed: ${killRecord.lastKilled.toISOString()}, Count: ${killRecord.killCount}` : 'NOT FOUND'}`);
      
      const result = this.respawnCalculator.calculateRespawnTime(bossQuery);
      logger.info(`Respawn calculation result: ${result ? `Respawned: ${result.isRespawned}, Hours remaining: ${result.hoursRemaining.toFixed(2)}, Formatted: ${result.formattedTime}` : 'NULL'}`);

      if (!result) {
        await interaction.reply({
          content: `I don't know when **${bossName}** will respawn. (Unable to calculate)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Format response
      let response: string;
      if (result.isRespawned || result.hoursRemaining < 0) {
        // Check if we have a kill record
        const killRecord = this.respawnCalculator.getKillRecord(bossName, bossNote);
        if (killRecord) {
          // Respawn time is always UTC; Discord <t:unix:F> renders it in the viewer's local timezone (same as Boss Tracker)
          const unixTimestamp = Math.floor(result.respawnTime.getTime() / 1000);
          response = `**${bossIdentifier}** has respawned (respawn time passed at <t:${unixTimestamp}:F>)`;
        } else {
          // No kill in last 7 days
          response = `**${bossIdentifier}** has respawned (no kill recorded in last 7 days)`;
        }
      } else {
        // UTC seconds; Discord <t:unix:F> shows in viewer's local TZ (matches Boss Tracker style)
        const unixTimestamp = Math.floor(result.respawnTime.getTime() / 1000);
        response = `**${bossIdentifier}** will respawn in ${result.formattedTime} (<t:${unixTimestamp}:F>)`;
      }

      if (postToChannel) {
        await interaction.reply({ content: response });
      } else {
        await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error(`Failed to process /respawn command: ${error instanceof Error ? error.message : error}`);
      await interaction.reply({
        content: 'An error occurred while processing your request. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle /boss-nickname command – set a personal nickname for a boss
   */
  async handleBossNicknameCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;

    const isAllowed = await this.isAllowedChannel(interaction);
    if (!isAllowed) {
      if (channelId === this.targetTrackingChannelId) {
        await interaction.reply({
          content: 'This command cannot be used in the target-tracking channel. Please use it in another channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (this.allowedChannels.size > 0) {
        await interaction.reply({
          content: 'This command can only be used in specific channels. Please use it in an allowed channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "I don't have permission to send messages in this channel. Please use this command in a channel where I have Send Messages permission.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const bossQuery = interaction.options.getString('boss', true);
    const nickname = interaction.options.getString('nickname', true).trim();

    if (nickname.length < 1) {
      await interaction.reply({
        content: 'Please provide a nickname (at least one character).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const boss = this.bossDataManager.getBoss(bossQuery);
      if (!boss) {
        const byNote = this.noteCache.getFirstMappingByNote(bossQuery);
        if (byNote) {
          const found = this.bossDataManager.getBoss(
            byNote.note ? `${byNote.bossName} (${byNote.note})` : byNote.bossName
          );
          if (found) {
            this.noteCache.cacheUserNickname(found.name, nickname, found.note);
            // #region agent log
            const afterNicknameMappings = this.noteCache.getMappingsByPartialNote(nickname);
            const _pA = { location: 'respawnCommand.ts:handleBossNicknameCommand:afterCache', message: 'after cacheUserNickname (byNote path)', data: { nickname, mappingsCount: afterNicknameMappings.length }, timestamp: Date.now(), hypothesisId: 'A' };
            fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_pA) }).catch(() => {});
            agentLog(_pA);
            // #endregion
            const identifier = found.note ? `${found.name} (${found.note})` : found.name;
            await interaction.reply({
              content: `Nickname **${nickname}** is now set for **${identifier}**. You can use \`/respawn ${nickname}\` or \`/lockout ${nickname}\`.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        }
        await interaction.reply({
          content: `I couldn't find a boss matching **${bossQuery}**. Use the boss name from the list (or include the note in parentheses for duplicates).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      this.noteCache.cacheUserNickname(boss.name, nickname, boss.note);
      // #region agent log
      const afterNicknameMappings = this.noteCache.getMappingsByPartialNote(nickname);
      const _pA2 = { location: 'respawnCommand.ts:handleBossNicknameCommand:afterCache', message: 'after cacheUserNickname (boss path)', data: { nickname, mappingsCount: afterNicknameMappings.length }, timestamp: Date.now(), hypothesisId: 'A' };
      fetch('http://127.0.0.1:7245/ingest/ae5d8657-0d8a-4952-b44b-691fbf67fc00', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_pA2) }).catch(() => {});
      agentLog(_pA2);
      // #endregion
      const bossIdentifier = boss.note ? `${boss.name} (${boss.note})` : boss.name;
      await interaction.reply({
        content: `Nickname **${nickname}** is now set for **${bossIdentifier}**. You can use \`/respawn ${nickname}\` or \`/lockout ${nickname}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error(`Failed to process /boss-nickname command: ${error instanceof Error ? error.message : error}`);
      await interaction.reply({
        content: 'An error occurred while saving your nickname. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle zone-based respawn query
   */
  private async handleZoneRespawn(
    interaction: ChatInputCommandInteraction,
    zoneName: string,
    bosses: BossData[],
    postToChannel: boolean
  ): Promise<void> {
    const results: Array<{
      name: string;
      identifier: string;
      respawnTime: string;
      status: 'respawned' | 'pending';
      timestamp?: number;
      orderIndex: number;
    }> = [];

    // Calculate respawn time for each boss (bosses already in zone order from getBossesByLocation)
    for (let i = 0; i < bosses.length; i++) {
      const boss = bosses[i];
      const bossName = boss.name;
      const bossNote = boss.note;
      const bossIdentifier = bossNote ? `${bossName} (${bossNote})` : bossName;
      const bossQuery = bossNote ? `${bossName} (${bossNote})` : bossName;

      // Skip bosses without respawn_hours configured
      if (boss.respawn_hours === null || boss.respawn_hours === undefined) {
        results.push({
          name: bossName,
          identifier: bossIdentifier,
          respawnTime: 'N/A (no respawn time)',
          status: 'pending',
          orderIndex: i,
        });
        continue;
      }

      const result = this.respawnCalculator.calculateRespawnTime(bossQuery);
      if (!result) {
        results.push({
          name: bossName,
          identifier: bossIdentifier,
          respawnTime: 'N/A (unable to calculate)',
          status: 'pending',
          orderIndex: i,
        });
        continue;
      }

      if (result.isRespawned || result.hoursRemaining < 0) {
        const killRecord = this.respawnCalculator.getKillRecord(bossName, bossNote);
        if (killRecord) {
          const unixTimestamp = Math.floor(result.respawnTime.getTime() / 1000);
          results.push({
            name: bossName,
            identifier: bossIdentifier,
            respawnTime: `Respawned (<t:${unixTimestamp}:F>)`,
            status: 'respawned',
            timestamp: unixTimestamp,
            orderIndex: i,
          });
        } else {
          results.push({
            name: bossName,
            identifier: bossIdentifier,
            respawnTime: 'Respawned (no kill in 7 days)',
            status: 'respawned',
            orderIndex: i,
          });
        }
      } else {
        const unixTimestamp = Math.floor(result.respawnTime.getTime() / 1000);
        results.push({
          name: bossName,
          identifier: bossIdentifier,
          respawnTime: `${result.formattedTime} (<t:${unixTimestamp}:F>)`,
          status: 'pending',
          timestamp: unixTimestamp,
          orderIndex: i,
        });
      }
    }

    // Display in zone order (Vex Thal, Sanctus Seru, etc. as defined in zoneBossOrder)
    results.sort((a, b) => a.orderIndex - b.orderIndex);

    // Format as compact list (no code block so Discord timestamps work)
    const lines: string[] = [`**${zoneName}** - Boss Respawn Times\n`];

    for (const result of results) {
      lines.push(`**${result.identifier}**: ${result.respawnTime}\n`);
    }

    // Discord has a 2000 character limit, so if too long, split into multiple messages
    const response = lines.join('');
    if (response.length > 1900) {
      // Split into chunks
      const chunks: string[] = [];
      let currentChunk = [`**${zoneName}** - Boss Respawn Times\n`];
      
      for (const result of results) {
        const line = `**${result.identifier}**: ${result.respawnTime}\n`;
        const testChunk = [...currentChunk, line].join('');
        
        if (testChunk.length > 1900) {
          chunks.push(currentChunk.join(''));
          currentChunk = [`**${zoneName}** - Boss Respawn Times (continued)\n`, line];
        } else {
          currentChunk.push(line);
        }
      }
      
      if (currentChunk.length > 1) {
        chunks.push(currentChunk.join(''));
      }

      // Send first chunk immediately, then follow-ups
      if (postToChannel) {
        await interaction.reply({ content: chunks[0] });
        for (let i = 1; i < chunks.length; i++) await interaction.followUp({ content: chunks[i] });
      } else {
        await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
        for (let i = 1; i < chunks.length; i++) await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
      }
    } else {
      if (postToChannel) {
        await interaction.reply({ content: response });
      } else {
        await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Handle /lockout command
   */
  async handleLockoutCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;
    const user = interaction.user.tag;

    logger.debug(`Command received: /lockout ${interaction.options.getString('boss')} by user ${user} in channel ${channelId}`);

    // Check channel restrictions
    const isAllowed = await this.isAllowedChannel(interaction);
    if (!isAllowed) {
      if (channelId === this.targetTrackingChannelId) {
        logger.info(`/lockout command blocked in target-tracking channel ${channelId} by user ${user}`);
        await interaction.reply({
          content: 'This command cannot be used in the target-tracking channel. Please use it in another channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (this.allowedChannels.size > 0) {
        logger.info(`/lockout command blocked in channel ${channelId} by user ${user} (not in allowed channels)`);
        await interaction.reply({
          content: 'This command can only be used in specific channels. Please use it in an allowed channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        logger.info(`/lockout command blocked in channel ${channelId} by user ${user} (no SendMessages permission)`);
        await interaction.reply({
          content: 'I don\'t have permission to send messages in this channel. Please use this command in a channel where I have Send Messages permission.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    logger.info(`Command allowed in channel ${channelId}`);

    const bossQuery = interaction.options.getString('boss', true);
    const postToChannel = interaction.options.getBoolean('post_to_channel') === true;

    try {
      // Check if boss exists
      const boss = this.bossDataManager.getBoss(bossQuery);
      if (!boss) {
        // Check if there are multiple bosses with this name (duplicates)
        const allBosses = this.bossDataManager.getBossesByName(bossQuery);
        if (allBosses.length > 1) {
          // Multiple bosses found - ask user to specify
          const bossList = allBosses.map(b => {
            const note = b.note ? ` (${b.note})` : '';
            return `**${b.name}${note}**`;
          }).join(', ');
          
          await interaction.reply({
            content: `Multiple bosses found with name **${bossQuery}**. Please specify which one:\n${bossList}\n\nYou can use: \`/lockout ${bossQuery} (North)\` or \`/lockout ${bossQuery} North\``,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        
        logger.error(`Boss '${bossQuery}' not found in database when checking lockout time`);
        await interaction.reply({
          content: `I don't know the lockout time for **${bossQuery}**. (Boss not found in database)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      
      const bossName = boss.name;
      const bossNote = boss.note;
      const bossIdentifier = bossNote ? `${bossName} (${bossNote})` : bossName;

      // Check if respawn time is configured
      const lockoutHours = this.respawnCalculator.getLockoutTime(bossQuery);
      if (lockoutHours === null) {
        logger.warn(`Boss '${bossIdentifier}' has no respawn_hours configured. Location: ${boss.location || 'unknown'}, Enabled: ${boss.enabled || false}`);
        await interaction.reply({
          content: `I don't know the lockout time for **${bossIdentifier}**. (Respawn time not configured)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Format lockout time
      const formattedTime = this.respawnCalculator.formatLockoutTime(lockoutHours);
      const response = `**${bossIdentifier}** lockout: ${formattedTime}`;

      if (postToChannel) {
        await interaction.reply({ content: response });
      } else {
        await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error(`Failed to process /lockout command: ${error instanceof Error ? error.message : error}`);
      await interaction.reply({
        content: 'An error occurred while processing your request. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle /raidnight command – lockouts for mobs that will be up during the next raid (9PM–11:59PM ET).
   */
  async handleRaidNightCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;
    const user = interaction.user.tag;

    logger.debug(`Command received: /raidnight by ${user} in channel ${channelId}`);

    const whichRaid = interaction.options.getInteger('which_raid') ?? 0;
    const postToChannel = interaction.options.getBoolean('post_to_channel') === true;

    const isAllowed = await this.isAllowedChannel(interaction);
    if (!isAllowed) {
      if (channelId === this.targetTrackingChannelId) {
        await interaction.reply({
          content: 'This command cannot be used in the target-tracking channel. Please use it in another channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (this.allowedChannels.size > 0) {
        await interaction.reply({
          content: 'This command can only be used in specific channels. Please use it in an allowed channel.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "I don't have permission to send messages in this channel. Please use this command in a channel where I have Send Messages permission.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    try {
      const scheduleContent = this.cacheManager?.getRaidSchedule()?.content ?? null;
      const result = getRaidNightLockouts(
        scheduleContent,
        this.bossDataManager,
        this.respawnCalculator,
        whichRaid
      );

      if (!result.success) {
        await interaction.reply({
          content: result.message,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (postToChannel) {
        await interaction.reply({ content: result.message });
      } else {
        await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error(`Failed to process /raidnight command: ${error instanceof Error ? error.message : error}`);
      await interaction.reply({
        content: 'An error occurred while processing your request. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle /schedule command (admin only): start, list, or cancel raid night scheduled posts.
   */
  async handleScheduleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member;
    const permissions = member && 'permissions' in member ? (member.permissions as { has: (bit: bigint) => boolean }) : null;
    if (!permissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'Only server administrators can use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      await this.handleScheduleStart(interaction);
    } else if (sub === 'list') {
      await this.handleScheduleList(interaction);
    } else if (sub === 'cancel') {
      await this.handleScheduleCancel(interaction);
    } else if (sub === 'post-now') {
      await this.handleSchedulePostNow(interaction);
    }
  }

  /**
   * Post raid night lockout message to the current channel immediately. Does not create or modify any schedule.
   */
  private async handleSchedulePostNow(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scheduleContent = this.cacheManager?.getRaidSchedule()?.content ?? null;
    const result = getRaidNightLockouts(
      scheduleContent,
      this.bossDataManager,
      this.respawnCalculator
    );
    if (!result.success) {
      await interaction.editReply({ content: result.message });
      return;
    }
    try {
      if (interaction.channel && 'send' in interaction.channel) {
        await (interaction.channel as { send: (content: string) => Promise<unknown> }).send(result.message);
      }
      await interaction.editReply({ content: 'Posted.' });
    } catch (err) {
      logger.error(`Schedule post-now: failed to send to channel: ${err instanceof Error ? err.message : err}`);
      await interaction.editReply({ content: 'Failed to post to this channel.' });
    }
  }

  private async handleScheduleStart(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.cacheManager || !interaction.guildId) return;
    const timeInput = interaction.options.getString('time', true);
    const parsed = parseScheduleTime(timeInput);
    if (!parsed) {
      await interaction.reply({
        content: 'Invalid time. Use e.g. `7pm` or `19:00`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const { hour, minute } = parsed;
    const channelId = interaction.channelId!;
    const guildId = interaction.guildId;
    const id = `${guildId}-${channelId}-${hour}-${minute}`;
    const existing = this.cacheManager.getRaidNightSchedules();
    if (existing.some(e => e.id === id)) {
      await interaction.reply({
        content: `A schedule already exists in this channel at ${formatTimeEST(hour, minute)} EST.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const entry: RaidNightScheduleEntry = {
      id,
      guildId,
      channelId,
      timeEST: { hour, minute },
      createdAt: Date.now(),
    };
    this.cacheManager.addRaidNightSchedule(entry);
    await this.cacheManager.saveCache();
    await interaction.reply({
      content: `I'll post the raid night lockouts in this channel at ${formatTimeEST(hour, minute)} EST on raid days.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleScheduleList(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.cacheManager || !interaction.guildId) return;
    const all = this.cacheManager.getRaidNightSchedules();
    const guildSchedules = all.filter(e => e.guildId === interaction.guildId);
    if (guildSchedules.length === 0) {
      await interaction.reply({
        content: 'No schedules set.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines: string[] = [];
    for (const s of guildSchedules) {
      try {
        const ch = await interaction.client.channels.fetch(s.channelId);
        const name = ch && 'name' in ch ? `#${ch.name}` : s.channelId;
        lines.push(`• ${name} at ${formatTimeEST(s.timeEST.hour, s.timeEST.minute)} EST`);
      } catch {
        lines.push(`• <#${s.channelId}> at ${formatTimeEST(s.timeEST.hour, s.timeEST.minute)} EST`);
      }
    }
    await interaction.reply({
      content: `**Raid night schedules:**\n${lines.join('\n')}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleScheduleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.cacheManager || !interaction.guildId) return;
    const all = this.cacheManager.getRaidNightSchedules();
    const guildSchedules = all.filter(e => e.guildId === interaction.guildId);
    if (guildSchedules.length === 0) {
      await interaction.reply({
        content: 'No schedules to cancel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (guildSchedules.length === 1) {
      await this.sendScheduleCancelConfirmation(interaction, guildSchedules[0]);
      return;
    }
    const options = await Promise.all(
      guildSchedules.map(async (s) => {
        let label: string;
        try {
          const ch = await interaction.client.channels.fetch(s.channelId);
          label = ch && 'name' in ch ? `#${ch.name} at ${formatTimeEST(s.timeEST.hour, s.timeEST.minute)} EST` : `${s.channelId} at ${formatTimeEST(s.timeEST.hour, s.timeEST.minute)} EST`;
        } catch {
          label = `<#${s.channelId}> at ${formatTimeEST(s.timeEST.hour, s.timeEST.minute)} EST`;
        }
        return { label, value: s.id };
      })
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId('schedule-cancel-menu')
      .setPlaceholder('Select a schedule to cancel')
      .addOptions(options.map(o => ({ label: o.label.length > 100 ? o.label.slice(0, 97) + '...' : o.label, value: o.value })));
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    await interaction.reply({
      content: 'Select a schedule to cancel:',
      components: [selectRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async sendScheduleCancelConfirmation(
    interaction: ChatInputCommandInteraction,
    entry: RaidNightScheduleEntry
  ): Promise<void> {
    let channelLabel: string;
    try {
      const ch = await interaction.client.channels.fetch(entry.channelId);
      channelLabel = ch && 'name' in ch ? `#${ch.name}` : entry.channelId;
    } catch {
      channelLabel = `<#${entry.channelId}>`;
    }
    const timeStr = formatTimeEST(entry.timeEST.hour, entry.timeEST.minute);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule-cancel-${entry.id}`)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('schedule-cancel-no')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({
      content: `Cancel the schedule in ${channelLabel} at ${timeStr} EST?`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * Handle select menu: user picked a schedule to cancel; show confirmation buttons.
   */
  async handleScheduleCancelSelect(interaction: StringSelectMenuInteraction, selectedId: string): Promise<void> {
    if (!this.cacheManager) return;
    const entry = this.cacheManager.getRaidNightSchedules().find(e => e.id === selectedId);
    if (!entry) {
      await interaction.update({ content: 'That schedule no longer exists.', components: [] }).catch(() => {});
      return;
    }
    let channelLabel: string;
    try {
      const ch = await interaction.client.channels.fetch(entry.channelId);
      channelLabel = ch && 'name' in ch ? `#${ch.name}` : entry.channelId;
    } catch {
      channelLabel = `<#${entry.channelId}>`;
    }
    const timeStr = formatTimeEST(entry.timeEST.hour, entry.timeEST.minute);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule-cancel-${entry.id}`)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('schedule-cancel-no')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({
      content: `Cancel the schedule in ${channelLabel} at ${timeStr} EST?`,
      components: [row],
    });
  }

  /**
   * Handle button: confirm or cancel schedule cancellation.
   */
  async handleScheduleCancelButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;
    if (customId === 'schedule-cancel-no') {
      await interaction.update({ content: 'Cancelled.', components: [] }).catch(() => {});
      return;
    }
    if (!customId.startsWith('schedule-cancel-') || !this.cacheManager) return;
    const id = customId.slice('schedule-cancel-'.length);
    this.cacheManager.removeRaidNightSchedule(id);
    await this.cacheManager.saveCache();
    await interaction.update({ content: 'Schedule cancelled.', components: [] }).catch(() => {});
  }
}

function formatTimeEST(hour: number, minute: number): string {
  if (minute === 0) {
    if (hour === 0) return '12:00 AM';
    if (hour < 12) return `${hour}:00 AM`;
    if (hour === 12) return '12:00 PM';
    return `${hour - 12}:00 PM`;
  }
  if (hour === 0) return `12:${String(minute).padStart(2, '0')} AM`;
  if (hour < 12) return `${hour}:${String(minute).padStart(2, '0')} AM`;
  if (hour === 12) return `12:${String(minute).padStart(2, '0')} PM`;
  return `${hour - 12}:${String(minute).padStart(2, '0')} PM`;
}
