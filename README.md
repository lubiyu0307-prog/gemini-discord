# gemini-discord

This extension lets you use your local Gemini CLI agent from Discord.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Gemini CLI Extension](https://img.shields.io/badge/Gemini%20CLI-extension-4285F4.svg)](https://github.com/google-gemini/gemini-cli)
[![MCP](https://img.shields.io/badge/protocol-MCP-blueviolet.svg)](https://modelcontextprotocol.io)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-5865F2.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-22%2B-green.svg)](https://nodejs.org)

This is not a hosted chatbot. It is not a second agent. Discord is only the transport layer. Gemini CLI remains the agent, running locally on your machine with your existing identity, context, and tools.

## Install and Set Up

Requirements:

- Node.js 22+
- Gemini CLI installed and authenticated
- Discord Developer Mode enabled
- a Discord bot token
- **Message Content Intent** enabled for the bot
- **Server Members Intent** enabled if you want user discovery

Create a Discord bot:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application.
3. Add a bot under **Bot**.
4. Copy the bot token.
5. Enable **Message Content Intent**.
6. Enable **Server Members Intent** if you want user discovery.
7. Invite the bot with **OAuth2 → URL Generator**.

Recommended bot permissions:

- View Channels
- Read Message History
- Send Messages
- Use Slash Commands
- Attach Files
- Add Reactions
- Manage Messages, if using edit/delete/pin flows
- Kick Members / Moderate Members, only if using moderation tools

Install the extension:

```bash
gemini extensions install https://github.com/Yamato-main/gemini-discord
```

Gemini CLI will ask for:

| Setting | Purpose |
| --- | --- |
| Discord Bot Token | Token from the Discord Developer Portal |
| Boss Discord User ID | Stable numeric Discord user ID with full bridge authority |
| Owner Discord User IDs | Legacy/setup routing IDs; does not grant boss authority |
| Discord Server ID | Server where the bot is installed |

After installation, Gemini CLI loads the MCP server. If daemon auto-start is enabled, the Discord daemon starts automatically.

## Updating Configuration

To rotate credentials or update setup values:

```bash
gemini extensions config gemini-discord
```

For local development, run setup again:

```bash
npm run setup
```

Local runtime config is written under:

```text
.gemini-discord/
```

Keep that directory out of git.

## What it does

Your Gemini CLI agent gets Discord-aware tools:

| Tool | Purpose |
| --- | --- |
| `discord_message` | Send, reply, edit, delete, react, unreact, fetch reactions, pin, unpin, and list pins |
| `discord_admin` | Check status, restart, reset, discover channels/users, set presence, kick, timeout, and remove timeout |
| `discord_history` | Read recent exchanges, conversation buffers, and archives |
| `discord_cron` | Schedule reminders and cron jobs, list jobs, and delete jobs |
| `discord_find_media` | Search local media files on the host machine |

**The agent can:**

- reply in Discord channels, threads, and DMs
- process supported attachments: images, video, audio, PDFs, text, Markdown, JSON, and source files
- discover channels and users when configured
- send files back to Discord
- schedule reminders and cron jobs
- manage reactions and pins
- moderate when configured and authorized
- keep Gemini CLI sessions warm per conversation

## Permissions & Privacy

**Boss authority is ID-only.** Full bridge authority is granted only by `DISCORD_BOSS_USER_ID`, a stable numeric Discord user ID configured at runtime.

Boss authority is never granted by username, display name, nickname, mention text, Discord role, server owner status, administrator permission, allowlist membership, discovered user metadata, or legacy owner/admin settings.

If `DISCORD_BOSS_USER_ID` is missing or malformed, privileged actions fail closed.

Guests may chat where the bot is allowed to respond. Guests may use simple public Google Search through Gemini CLI when available.

Guests may not use MCP tools, shell access, filesystem access, repository access, local media, attachment processing, authenticated browsing, outbound Discord actions, history, status, discovery, cron, admin, moderation, boss memory, or boss sessions.

The bridge does not post to unproven targets. There is no fallback target channel. Normal conversational replies stay in the origin channel, thread, or DM.

Credentials and runtime state stay local. Do not commit real tokens, real IDs, `.env`, `.gemini-discord/`, logs, databases, or local runtime files.

## Development

```bash
git clone https://github.com/Yamato-main/gemini-discord
cd gemini-discord
npm install
npm run setup
npm run build
```

Install the local path:

```bash
gemini extensions install /absolute/path/to/gemini-discord
```

Useful commands:

```bash
npm run typecheck
npm test
npm run build
npm run start:daemon
npm run start:server
```

Before release:

1. Keep `gemini-extension.json` at the repository root.
2. Run typecheck, tests, and build.
3. Commit built `dist/` files.
4. Keep `.env`, `.gemini-discord/`, logs, databases, and local runtime files untracked.
5. Use placeholder IDs in committed examples.
6. Add the GitHub topic `gemini-cli-extension`.

## License

MIT License. See [LICENSE](./LICENSE).
