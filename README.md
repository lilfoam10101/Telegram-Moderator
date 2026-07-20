# Telegram Topic Moderator..

Node.js Telegram bot for forum topic moderation, auto-reply filters, member actions, and welcome messages.

## Features

- Restrict topics via DM setup (manual topic links)
- Auto-reply filters (e.g. `/filter ca 0x...`)
- Member moderation: mute, unmute, ban, unban, kick
- Welcome message for new members
- GitHub push/PR notifications to a Telegram topic

## Setup

1. Copy `.env.example` to `.env` and set both tokens:

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Moderator bot (`npm start`) |
| `NOTIFY_BOT_TOKEN` | Deploy notifications (GitHub Actions + `npm run test:notify`) |

2. Install dependencies:

```bash
npm install
```

3. Start the bot:

```bash
npm start
```

4. Open the bot in DM → `/start` to configure topics and add the bot to your group as admin

Disable bot privacy mode: @BotFather → `/setprivacy` → **Disable**

## Group commands

| Command | Description |
|---------|-------------|
| `/help` | Show command list |
| `/filter` / `/unfilter` / `/filters` | Auto-reply triggers |
| `/mute` / `/unmute` / `/ban` / `/unban` / `/kick` | Member moderation |
| `/setwelcome` / `/welcome` / `/unwelcome` | Welcome message |
| `/myid` | Show your Telegram user ID |

## GitHub deploy notifications

When you push to `main` (or merge a pull request), GitHub Actions sends an update message to your Telegram topic using a **separate notification bot** — not your main moderator bot.

### 1. Create a notification bot

1. Open @BotFather → `/newbot` → create a bot for announcements only (e.g. `Pledge Updates Bot`)
2. Add that bot to your group
3. Make it able to post in the target topic (admin or normal member with post permission)

### 2. Push this repo to GitHub

```bash
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/telegram-topic-moderator.git
git push -u origin main
```

### 3. Add GitHub secrets

Go to **Settings → Secrets and variables → Actions**.

Add these as **Repository secrets** *or* **Environment secrets** (if you use an environment, the workflow must reference it — see `environment:` in `.github/workflows/notify-telegram.yml`):

| Secret | Value | Example |
|--------|-------|---------|
| `TELEGRAM_NOTIFY_BOT_TOKEN` | Token of the **notification bot** (not the moderator bot) | `789012:XYZ...` |
| `TELEGRAM_CHAT_ID` | Group supergroup ID | `-1004415462717` |
| `TELEGRAM_TOPIC_ID` | Topic number from link | `4` |

**Important:** Environment secrets only work when the job sets `environment: your-environment-name`. Repository secrets work without that.

For `https://t.me/pledgefinance/4`:

- `TELEGRAM_CHAT_ID` = group ID (e.g. `-1004415462717`)
- `TELEGRAM_TOPIC_ID` = `4`

The **notification bot** must be in the group and allowed to post in that topic. Put the same notify token in `.env` as `NOTIFY_BOT_TOKEN` and in GitHub as `TELEGRAM_NOTIFY_BOT_TOKEN`. The moderator `BOT_TOKEN` stays local only.

### 4. Trigger

Notifications run automatically on:

- **Push** to `main` / `master`
- **Merged pull request**

If secrets are missing, the workflow **fails** with a clear error (after you push the latest workflow update).

### Test locally before GitHub

```bash
npm run test:notify
```

Uses `NOTIFY_BOT_TOKEN` from `.env` (not `BOT_TOKEN`).

## Data storage

Runtime data is stored in `data/` (gitignored):

- `restricted_topics.json` — moderated topics
- `filters.json` — auto-reply filters
- `welcome.json` — welcome messages
- `chats.json` — connected groups
- `user_cache.json` / `moderated_members.json` — member lookup cache

## License

Private project.
