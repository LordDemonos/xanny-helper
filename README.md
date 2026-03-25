# Discord Raid & Event Management Bot (xanny-helper)

**Repo:** [github.com/LordDemonos/xanny-helper](https://github.com/LordDemonos/xanny-helper)

A Discord bot for managing raid schedules, boss respawn tracking, inventory, and suggestions for gaming communities—especially those running large-scale events in games like EverQuest (e.g. Project Quarm).

---

## What This Bot Does

- **Boss respawn tracking** — Reads kill messages from a target-tracking channel (e.g. from a Boss Tracker bot), records per-boss (and per-variant) kill times, and answers `/respawn`, `/lockout`, `/raidnight`, and `/schedule` with accurate respawn and lockout info.
- **Raid schedule** — Reads the raid schedule from Discord and updates it on the guild site (e.g. GitHub-backed pages).
- **Guild bank inventory** — Handles inventory file uploads and syncs them to the repo/site.
- **Suggestions** — Integrates with Google Sheets to collect and post feedback/suggestions.
- **Secure & production-ready** — Designed for unattended operation; no sensitive data logged; credentials loaded at runtime.
- **Docker-ready** — Can be built and run in a container for deployment or GitHub-hosted setups.

---

## Boss Respawn & Raid Night Commands

Kill data is ingested from a **target-tracking channel** (read-only). The bot parses messages from your Boss Tracker (or manual kill posts), then serves:

| Command | Description |
|--------|-------------|
| **`/respawn`** | Respawn time for a single boss or all bosses in a zone (e.g. Vex Thal). Supports “Post to channel” for shared replies. |
| **`/lockout`** | Lockout/respawn duration for a boss. |
| **`/raidnight`** | Lockouts for all mobs that will be up during the **next** raid window (9 PM–11:59 PM ET), based on the cached raid schedule. Reply only to you unless “Post to channel” is used. |
| **`/schedule`** (admin) | Manages automatic raid-night lockout posts: **start** (set a daily post time), **list**, **cancel**, **post-now** (one-off post to current channel). |
| **`/boss-nickname`** | Set a personal nickname for a boss (used by `/respawn` and `/lockout`). |

Zone boss order (e.g. Vex Thal) is defined in `src/modules/boss-respawn/zoneBossOrder.ts`. Duplicate-named bosses (e.g. North/South Blob, F1 North/F1 South) are tracked separately when your Boss Tracker includes the variant in the message (e.g. `Boss Name (North Blob) in Vex Thal!`).

**Default boss list:** Lockout and respawn durations for named targets ship in `data/default_bosses.json`. If you also run [Project Quarm Boss Tracker](https://github.com/LordDemonos/Project-Quarm-Boss-Tracker), keep `default_bosses.json` aligned between projects so `/respawn` and `/lockout` match the desktop app’s defaults.

See `docs/DISCORD_SETUP.md` for channel IDs, permissions, and env vars.

---

## Building & Running

### Prerequisites

- Node.js 20+ (LTS)
- Copy `env.example` to `.env` and fill in Discord token, channel IDs, Google credentials (if using suggestions/calendar), GitHub token/repo (if using), and optional boss-command channels / target-tracking channel.

### Local (npm)

```bash
npm install
npm run build
npm start
```

- `npm run dev` — run with ts-node (no build).
- `npm run start:debug` / `npm run dev -- --debug` — enable debug logging.

### Docker

```bash
docker build -t xanny-helper .
docker run --env-file .env -v /path/to/config:/app/config -v /path/to/cache:/app/cache xanny-helper
```

- Mount a volume for `config/` if you use a service-account JSON path under it.
- The image creates `cache/` and `config/`; persist them if you need cache or config across restarts.
- Ensure `.env` (or equivalent) is provided at runtime; do not bake secrets into the image.

---

## Features at a Glance

- **Boss respawn tracker** — `/respawn`, `/lockout`, `/raidnight`, `/schedule` (with zone order and variant-aware tracking).
- **Raid schedule** — Read from Discord, publish to site/repo.
- **Inventory** — File handling and caching for guild bank updates.
- **Suggestions** — Google Sheets integration and Discord posting.
- **Concise, secure logging** — No sensitive data in logs.
- **Docker-ready** — Dockerfile and `.dockerignore` included for containerized deployment and GitHub.

---

## Disabled / Legacy Features

- **Google Calendar integration** — Currently **disabled**. It was a bit aggressive for our needs and may require rework before being useful again. Code and env toggles (`ENABLE_CALENDAR_FUNCTIONS`) remain in place.
- **Offnight process** — **No longer used**. The offnight flow (thread tracking, file updates, calendar sync) worked well technically but did not meaningfully help us form or gather for more raids, so we’ve stopped using it. It can be re-enabled via `ENABLE_OFFNIGHT_FILE_OPERATIONS` if desired.

---

## How We Use It

This bot is tailored for our community’s setup. It is not a generic plug-and-play product: channel IDs, credentials, and optional boss/zone data are specific to our Discord and env. If you’re reusing or forking for inspiration, copy `env.example`, set your own values, and see `docs/DISCORD_SETUP.md` for boss-respawn setup.

---

## Security & Privacy

- No sensitive data is written to logs.
- Credentials are read from env (and optional config files) at runtime only.
- API keys and secrets stay out of the repo.

---

## For Developers

- TypeScript; main logic under `src/`.
- Boss data and zone order: `data/default_bosses.json`, `src/modules/boss-respawn/zoneBossOrder.ts`.
- Modular layout for extending commands, parsers, and integrations.
- Optional: `npm run verify-boss-respawn` — script in `scripts/` to sanity-check respawn helpers (see `package.json`).

---

## Pushing this project to GitHub

Your copy may live under a **parent** git repo (e.g. a large `JavaScript` folder) while [xanny-helper on GitHub](https://github.com/LordDemonos/xanny-helper) should be its **own** repository. Use a separate `.git` inside `xanny-helper` only for that remote (or clone GitHub into a clean folder and copy files in).

From **`E:\JavaScript\xanny-helper`** in PowerShell:

```powershell
# One-time: create a repo rooted here (skip if .git already exists in this folder)
git init
git branch -M main

git remote add origin https://github.com/LordDemonos/xanny-helper.git
# If origin already exists: git remote set-url origin https://github.com/LordDemonos/xanny-helper.git

# If GitHub already has commits you need to merge with yours:
# git fetch origin
# git pull origin main --allow-unrelated-histories

git add -A
git status
git commit -m "docs: refresh README; sync package description and boss-data notes"

git push -u origin main
```

If the remote history is obsolete and you intend to **replace** `main` entirely with this tree, use `git push -u origin main --force` instead (only if you are sure—this overwrites remote `main`).

To avoid the parent repo ever trying to track this folder, add `xanny-helper/` to the parent’s `.gitignore` (optional).

---

## Support & Contributions

- **Questions or bugs?** Open an issue on GitHub or ask in your Discord.
- **Contributions** — PRs welcome; follow existing code style and add tests where practical.

---

**Happy raiding.**
