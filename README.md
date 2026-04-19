# Skywork Proxy

OpenAI-compatible proxy for Skywork AI with auto token rotation **and continuous background token collection**.

## Features

- 🔄 Automatic token rotation with health tracking + exponential backoff cooldown
- 📦 Continuous background collector — pulls fresh Skywork tokens via temp inboxes
- 💾 Auto-persists every 20 new tokens to `tokens.json` via GitHub API (commit message tagged `[skip render][skip ci]` so deploys are NOT triggered)
- 🤖 Telegram bot control: `/start`, `/stop`, `/status`, `/help`
- 🌐 OpenAI-compatible `/v1/chat/completions` and `/v1/models`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Live status summary |
| GET | `/health` | Health probe |
| GET | `/v1/models` | List models |
| GET | `/v1/stats` | Per-token health detail |
| GET | `/collector/status` | Collector live stats |
| POST | `/v1/chat/completions` | Chat completions (requires `Authorization: Bearer <SECRET_KEY>`) |

## Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `SECRET_KEY` | yes | `Ahmad_Investor_2026` | API auth |
| `START_COLLECTOR` | no | `1` | Set `0` to disable auto-collection |
| `COLLECTOR_CONCURRENCY` | no | `3` | Parallel collector workers |
| `SAVE_EVERY` | no | `20` | Push to GitHub every N new tokens |
| `GITHUB_TOKEN` | for collector | — | PAT with `contents:write` |
| `GITHUB_REPO` | no | `hakercryptoplus-svg/skywork-proxy` | |
| `GITHUB_BRANCH` | no | `main` | |
| `TG_TOKEN` | for telegram | — | Bot token |
| `TG_CHAT` | for telegram | — | Chat ID for control + notifications |

## Telegram commands

- `/status` — current stats (running, total, session counters, pending push)
- `/stop` — pause collector (proxy keeps serving)
- `/start` — resume collector
- `/help`

## How collection works

1. Worker requests a temp inbox from minuteinbox
2. Asks Skywork to send a verification code to that inbox
3. Polls the inbox for the 6-digit code
4. Logs in to Skywork, claims a `chat/skybot` slot, extracts `user_token` (`.cv3`/`.cv4`)
5. Token added in-memory; every 20 new tokens, the full `tokens.json` is committed back via GitHub Contents API
6. Render is NOT redeployed because commit message contains `[skip render][skip ci]`
