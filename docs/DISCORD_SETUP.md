# Discord Admin Setup Guide - Boss Respawn Tracker

This guide will help Discord administrators configure the xanny-helper bot for the boss respawn tracker feature.

## Quick Setup (TL;DR)

1. **Enable Developer Mode** in Discord (User Settings > Advanced)
2. **Get Channel IDs**:
   - Right-click target-tracking channel > Copy ID → Use for `TARGET_TRACKING_CHANNELS`
   - (Optional) Right-click command channels > Copy ID → Use for `BOSS_COMMAND_CHANNELS`
3. **Set Bot Permissions**: View Channels, Read Message History, Send Messages, Use Slash Commands
4. **Configure `.env` file** (see Step 4 below)
5. **Restart the bot**

**Channel Access Options:**
- **Option A (Recommended for most servers)**: Leave `BOSS_COMMAND_CHANNELS` empty → Commands work in ANY channel where bot has SendMessages permission
- **Option B (Restricted access)**: Set `BOSS_COMMAND_CHANNELS` with specific channel IDs → Commands ONLY work in those channels

## Prerequisites

- Bot is already installed and running
- You have admin permissions in the Discord server
- Developer Mode is enabled in Discord (to copy channel IDs)

## Step 1: Enable Developer Mode

1. Open Discord and go to **User Settings** (gear icon next to your username)
2. Go to **Advanced** section
3. Enable **Developer Mode**
4. This allows you to right-click channels and copy their IDs

## Step 2: Get Channel IDs

### Target-Tracking Channel ID

This is the channel where boss tracker posts kill messages. The bot will monitor this channel (read-only).

1. Navigate to the channel where boss tracker posts kill messages
2. Right-click on the channel name in the channel list
3. Click **Copy ID** (this option only appears if Developer Mode is enabled)
4. Save this ID - you'll need it for `TARGET_TRACKING_CHANNEL_ID`

### Command Channel IDs (Optional)

**Choose ONE of these options:**

**Option 1: Allow in all channels (EASIEST - Recommended)**
- **Leave `BOSS_COMMAND_CHANNELS` empty or don't set it at all**
- Commands will work in ANY channel where bot has SendMessages permission
- More flexible, works automatically in new channels
- No need to update config when adding new channels

**Option 2: Whitelist specific channels (Restricted access)**
- Set `BOSS_COMMAND_CHANNELS` with comma-separated channel IDs
- Commands will ONLY work in these specific channels
- Right-click each channel > Copy ID
- Example: `BOSS_COMMAND_CHANNELS=123456789012345678,987654321098765432`

**Important:** Commands will NOT work in the target-tracking channel. This is always blocked to keep that channel clean, regardless of which option you choose.

## Step 3: Configure Bot Permissions & Developer Portal

The bot needs specific permissions to function. Slash commands are configured in the Discord Developer Portal, not as server permissions.

### Server-Level Permissions

1. Go to **Server Settings** > **Roles**
2. Find the bot's role (or create one if needed)
3. Ensure the following permissions are enabled:
   - ✅ **View Channels** (to see channels)
   - ✅ **Read Message History** (to scan past messages)
   - ✅ **Send Messages** (to respond to commands and slash commands)

**Note:** Slash commands don't require a separate permission. They work automatically once the bot is in your server and has the above permissions. Slash commands are configured in the Discord Developer Portal (see below).

### Channel-Specific Permissions (Optional)

If you want to restrict the bot to specific channels:

1. Go to **Server Settings** > **Channels**
2. For the target-tracking channel:
   - Click on the channel
   - Go to **Permissions** tab
   - Ensure bot role has:
     - ✅ **View Channel**
     - ✅ **Read Message History**
     - ❌ **Send Messages** (not needed, bot doesn't respond here)
3. For command channels:
   - Ensure bot role has:
     - ✅ **View Channel**
     - ✅ **Read Message History**
     - ✅ **Send Messages** (needed to respond to slash commands)

### Discord Developer Portal Configuration

Slash commands are automatically registered when the bot starts, but you need to ensure proper configuration in the Discord Developer Portal:

1. Go to https://discord.com/developers/applications
2. Select your bot application
3. Go to **Bot** section
4. Under **Privileged Gateway Intents**, ensure:
   - ✅ **MESSAGE CONTENT INTENT** is enabled (required for reading messages)
5. Go to **OAuth2** > **URL Generator**
   - Select scopes: `bot` and `applications.commands`
   - Select bot permissions: `View Channels`, `Read Message History`, `Send Messages`
   - Use the generated URL to invite the bot to your server (if not already done)

**Important:** The bot automatically registers slash commands on startup. No manual configuration needed in the Developer Portal for the commands themselves.

## Step 4: Configure Environment Variables

Open your `.env` file (or create it from `env.example`) and add these variables:

```env
# Target tracking channel (monitoring only, read-only, no command responses)
# REQUIRED: Right-click channel > Copy ID
TARGET_TRACKING_CHANNEL_ID=1287222236314341497

# Boss data file path (OPTIONAL - defaults to data/default_bosses.json in project root)
# The boss data file is now bundled with the project, so you typically don't need to set this
# Only set this if you want to use a custom location for the boss data file
# BOSS_TRACKER_DATA_PATH=/path/to/custom/default_bosses.json

# Channels where /respawn and /lockout commands are allowed (OPTIONAL)
# 
# OPTION A (Recommended): Leave this line empty or remove it entirely
#   → Commands work in ANY channel where bot has SendMessages permission
#   → No need to update config when adding new channels
#
# OPTION B (Restricted): Set specific channel IDs (comma-separated)
#   → Commands ONLY work in these specific channels
#   → Example: BOSS_COMMAND_CHANNELS=123456789012345678,987654321098765432
#
# IMPORTANT: Commands NEVER work in target-tracking channel (always blocked)
BOSS_COMMAND_CHANNELS=
```

**Setup Notes:**
- Replace `TARGET_TRACKING_CHANNEL_ID` with your actual channel ID (right-click channel > Copy ID)
- **`BOSS_TRACKER_DATA_PATH` is optional** - The boss data file (`default_bosses.json`) is now bundled with the project in the `data/` folder. You only need to set this if you want to use a custom location.
- **For `BOSS_COMMAND_CHANNELS`**: 
  - **Easiest**: Leave it empty (or remove the line) → Commands work everywhere bot has permission
  - **Restricted**: Add channel IDs separated by commas → Commands only work in those channels

## Step 5: Restart the Bot

After updating environment variables:

1. **Stop the bot** (if running)
2. **Restart the bot**
3. **Check bot logs** for initialization messages. You should see:
   ```
   Boss respawn tracker initializing...
   Loaded X bosses from default_bosses.json
   Successfully registered slash commands
   Startup scan completed - found X kills
   ```

**If you see errors:**
- Check that all environment variables are set correctly
- Verify `TARGET_TRACKING_CHANNEL_ID` is set correctly
- Ensure channel IDs are correct (no extra spaces)
- Check bot has proper permissions
- If using custom `BOSS_TRACKER_DATA_PATH`, verify the file exists and is readable

## Step 6: Verify Slash Commands

1. **In Discord**, go to any channel where bot has SendMessages permission (or a channel in your `BOSS_COMMAND_CHANNELS` if you set one)
2. **Type `/`** to see available commands
3. **You should see:**
   - `/respawn` - Check when a boss will respawn
   - `/lockout` - Check the lockout/respawn time for a boss
4. **Try typing `/respawn`** and you should see autocomplete suggestions for boss names
5. **If commands don't appear**: Wait 1-2 minutes (Discord can be slow), then try restarting the bot

## Step 7: Test the Setup

### Test Command in Allowed Channel

**If `BOSS_COMMAND_CHANNELS` is set:**
1. Go to a channel listed in `BOSS_COMMAND_CHANNELS`
2. Type `/respawn boss:Faydedar` (or any boss name)
3. Bot should respond with respawn time or "has respawned" message

**If `BOSS_COMMAND_CHANNELS` is NOT set (permission-based mode):**
1. Go to ANY channel where bot has SendMessages permission
2. Type `/respawn boss:Faydedar` (or any boss name)
3. Bot should respond with respawn time or "has respawned" message

### Test Command Blocking

1. Go to the target-tracking channel
2. Try using `/respawn` or `/lockout`
3. Bot should respond with: "This command cannot be used in the target-tracking channel..."
4. This confirms target-tracking channel is always blocked

### Test Command in Channels (Permission-Based Mode)

**If `BOSS_COMMAND_CHANNELS` is NOT set:**
1. Go to any channel where bot has SendMessages permission
2. Try using `/respawn` or `/lockout`
3. Bot should respond normally
4. Go to a channel where bot doesn't have SendMessages permission
5. Bot should respond with: "I don't have permission to send messages in this channel..."

**If `BOSS_COMMAND_CHANNELS` IS set:**
1. Go to a channel listed in `BOSS_COMMAND_CHANNELS`
2. Try using `/respawn` or `/lockout`
3. Bot should respond normally
4. Go to a channel NOT listed in `BOSS_COMMAND_CHANNELS`
5. Bot should respond with: "This command can only be used in specific channels..."

## Debug Mode / Verbose Logging

If something isn't working and you need more detailed information, you can enable debug logging:

### Option 1: Use Debug Flag (Recommended)

**For development:**
```bash
npm run dev:debug
```

**For production (after building):**
```bash
npm run start:debug
```

### Option 2: Set LOG_LEVEL Environment Variable

Add to your `.env` file:
```env
LOG_LEVEL=debug
```

Then restart the bot normally:
```bash
npm run start
```

### Option 3: Set NODE_ENV to Development

Add to your `.env` file:
```env
NODE_ENV=development
```

This automatically enables debug logging.

### What Debug Mode Shows

Debug mode will show:
- 🔍 Detailed parsing of boss kill messages
- 🔍 Command interactions and channel permission checks
- 🔍 Boss data loading and matching
- 🔍 Respawn time calculations
- 🔍 Message scanning progress
- 🔍 All internal state changes

**Note:** Debug logs can be verbose. Use them when troubleshooting, then switch back to normal logging (`info` level) for production.

## Troubleshooting

### Commands Don't Appear

**Problem:** Typing `/` doesn't show `/respawn` or `/lockout`

**Solutions:**
1. Check bot logs for "Successfully registered slash commands"
2. Verify bot has "Send Messages" permission in the channel
3. Wait a few minutes - Discord can take time to update command list (can take up to 1 hour)
4. Try restarting the bot
5. Check that `DISCORD_GUILD_ID` is set correctly in `.env`
6. Verify the bot was invited with `applications.commands` scope (see Developer Portal section above)
7. Try kicking and re-inviting the bot with the proper scopes if commands still don't appear

### "This command can only be used in specific channels" Error

**Problem:** Command works but shows this error

**Solutions:**
1. If `BOSS_COMMAND_CHANNELS` is set: Verify you're in a channel listed in the whitelist
2. Check that channel ID is correct (no extra spaces, correct format)
3. Verify channel ID matches exactly
4. If `BOSS_COMMAND_CHANNELS` is NOT set: Check bot has SendMessages permission in that channel

### "I don't have permission to send messages" Error

**Problem:** Bot says it doesn't have SendMessages permission

**Solutions:**
1. Check bot role has "Send Messages" permission in that channel
2. Verify channel-specific permissions aren't blocking the bot
3. Ensure bot role is above any roles that might restrict it
4. Check Server Settings > Channels > [Channel] > Permissions

### Bot Not Reading Messages from Target-Tracking Channel

**Problem:** Bot doesn't detect new kills

**Solutions:**
1. Verify `TARGET_TRACKING_CHANNEL_ID` is correct
2. Check bot has "Read Message History" permission
3. Check bot logs for "Monitoring target-tracking channel for new messages..."
4. Verify bot can see the channel (not hidden by permissions)

### "Boss not found in database" Error

**Problem:** Command says boss not found

**Solutions:**
1. Verify boss name spelling (case-insensitive, but must match exactly)
2. Check bot logs for "Loaded X bosses from default_bosses.json"
3. If using custom `BOSS_TRACKER_DATA_PATH`, verify the file exists and is readable
4. The default boss data file is located at `data/default_bosses.json` (or `dist/data/default_bosses.json` after build)

### Permission Errors

**Problem:** Bot can't access channels or respond

**Solutions:**
1. Verify bot role has required permissions (see Step 3)
2. Check channel-specific permissions aren't blocking the bot
3. Ensure bot role is above any roles that might restrict it
4. Check bot is in the server and has access to channels

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `TARGET_TRACKING_CHANNEL_ID` | Yes | Channel ID where boss tracker posts kills | `1287222236314341497` |
| `BOSS_TRACKER_DATA_PATH` | No | Custom path to `default_bosses.json` (optional - defaults to `data/default_bosses.json` in project root) | `/path/to/custom/default_bosses.json` or leave unset |
| `BOSS_COMMAND_CHANNELS` | No | Comma-separated channel IDs for commands (whitelist mode). If empty/omitted, commands work in any channel with SendMessages permission | `123456789012345678,987654321098765432` or leave empty |
| `DISCORD_GUILD_ID` | Yes | Server/Guild ID (for command registration) | `123456789012345678` |
| `DISCORD_TOKEN` | Yes | Bot token (already configured) | `your-bot-token` |

## Best Practices

1. **Channel Selection:**
   - Use a dedicated channel for boss kill tracking (target-tracking)
   - **Option A (Whitelist)**: Set `BOSS_COMMAND_CHANNELS` to restrict commands to specific channels
   - **Option B (Permission-based)**: Leave `BOSS_COMMAND_CHANNELS` empty to allow commands in any channel with SendMessages permission
   - Commands are always blocked in target-tracking channel (keeps it clean)

2. **Permissions:**
   - Give bot minimal required permissions
   - Use channel-specific permissions if needed
   - Regularly audit bot permissions

3. **Monitoring:**
   - Check bot logs regularly for errors
   - Monitor startup scan duration (should be < 30 seconds)
   - Watch for "New boss detected" messages (may need to add to database)

4. **Maintenance:**
   - Keep `data/default_bosses.json` updated with new bosses (or your custom file if `BOSS_TRACKER_DATA_PATH` is set)
   - Rebuild the project (`npm run build`) after updating the boss data file to ensure it's copied to `dist/`
   - Restart bot after updating boss data file
   - Check logs for parsing errors or issues

## Support

If you encounter issues not covered in this guide:

1. Check bot logs for error messages
2. Verify all environment variables are set correctly
3. Test with a simple command like `/lockout boss:Faydedar`
4. Check Discord server audit logs for permission issues

For more information, see the main README.md file.
