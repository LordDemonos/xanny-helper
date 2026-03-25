# Discord Raid & Event Management Bot (xanny-helper)

**Repo:** [github.com/LordDemonos/xanny-helper](https://github.com/LordDemonos/xanny-helper)  
**Docker image:** [`demonos/xanny-helper:latest`](https://hub.docker.com/r/demonos/xanny-helper) on Docker Hub

Discord bot for raid schedules, boss respawn/lockout commands, guild inventory, and suggestions—aimed at EverQuest–style communities (e.g. Project Quarm).

---

## Run with Docker (prebuilt)

```bash
docker pull demonos/xanny-helper:latest
docker run --env-file .env \
  -v /path/to/config:/app/config \
  -v /path/to/cache:/app/cache \
  demonos/xanny-helper:latest
```

Use `env.example` as a template for `.env`. Mount `config/` if JSON service-account paths live there; persist `cache/` if you need data across restarts. Do not bake secrets into custom images.

Build from this repo instead: see **Build from source** below.

---

## What it does

- **Boss respawn** — Ingests kills from a target-tracking channel; `/respawn`, `/lockout`, `/raidnight`, `/schedule`, `/boss-nickname` (details below).
- **Raid schedule** — Reads schedule from Discord; can publish to a guild site (e.g. GitHub-backed pages).
- **Inventory** — Guild bank file uploads and sync.
- **Suggestions** — Google Sheets integration and Discord posting.
- **Ops** — No secrets in logs; credentials via env at runtime. TypeScript, optional Docker.

---

## Boss / raid-night commands

| Command | Description |
|--------|-------------|
| **`/respawn`** | One boss or all bosses in a zone; optional “Post to channel”. |
| **`/lockout`** | Lockout / respawn duration for a boss. |
| **`/raidnight`** | Lockouts up during the next raid window (9 PM–11:59 PM ET), from cached schedule. |
| **`/schedule`** (admin) | Raid-night posts: **start**, **list**, **cancel**, **post-now**. |
| **`/boss-nickname`** | Personal alias for `/respawn` and `/lockout`. |

Zone order (e.g. Vex Thal) lives in `src/modules/boss-respawn/zoneBossOrder.ts`. Variants (e.g. North/South blob) work when the kill line includes the note.

Default lockout times ship in `data/default_bosses.json`. If you use [Project Quarm Boss Tracker](https://github.com/LordDemonos/Project-Quarm-Boss-Tracker), keep that file aligned with the app.

Setup: **`docs/DISCORD_SETUP.md`**.

---

## Build from source

**Needs:** Node.js 20+, and `.env` from `env.example`.

```bash
npm install
npm run build
npm start
```

- `npm run dev` — ts-node, no build.  
- `npm run start:debug` / `npm run dev:debug` — verbose logging.

**Docker (local build):**

```bash
docker build -t xanny-helper .
docker run --env-file .env -v /path/to/config:/app/config -v /path/to/cache:/app/cache xanny-helper
```

---

## Disabled / legacy

- **Google Calendar** — Effectively off for our use case; code/toggle `ENABLE_CALENDAR_FUNCTIONS` remains.
- **Offnight file pipeline** — Unused; re-enable with `ENABLE_OFFNIGHT_FILE_OPERATIONS` if needed.

---

## Scope & security

Tailored to one guild’s channels and env—not a generic SaaS. Fork: copy `env.example`, read `docs/DISCORD_SETUP.md`. Never commit `.env`, Google JSON keys, or tokens; they stay runtime-only.

---

## Developers

- `src/` — application code.  
- `data/default_bosses.json`, `src/modules/boss-respawn/zoneBossOrder.ts` — boss data / ordering.  
- `npm run verify-boss-respawn` — optional sanity check (`scripts/`).

---

## Contributing

Issues and PRs welcome on [GitHub](https://github.com/LordDemonos/xanny-helper).

---

**Happy raiding.**
