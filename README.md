# gemini-discord

Your local Gemini CLI agent, reachable from Discord.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-extension-4285F4.svg)](https://github.com/google-gemini/gemini-cli)
[![MCP](https://img.shields.io/badge/protocol-MCP-blueviolet.svg)](https://modelcontextprotocol.io)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-5865F2.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-22%2B-green.svg)](https://nodejs.org)

This is not a hosted chatbot. Discord is the transport — Gemini CLI is still the agent, running on your machine with the same identity, context, sessions, and tools you already use.

Send a task from your phone. Your agent picks it up, works in the same workspace, and replies in the same channel. Sessions stay warm. Credentials stay local. Authority stays with one Discord user ID you control.

---

## Discord Bot Setup

You need a bot application before installing:

1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications).
2. Go to **Bot** → Reset Token → copy it. This is `DISCORD_BOT_TOKEN`.
3. Enable **Message Content Intent** (required). Enable **Server Members Intent** if you want user discovery.
4. Go to **OAuth2 → URL Generator**. Scopes: `bot`, `applications.commands`. Minimum permissions: View Channels, Read Message History, Send Messages, Attach Files, Use Slash Commands, Add Reactions.
5. Open the generated URL to invite the bot to your server.
6. Enable Developer Mode in Discord (Settings → Advanced), then right-click your username and copy your User ID. This is `DISCORD_BOSS_USER_ID`.

---

## Install

Requires [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated, Node.js 22+, and a Discord bot token.

```bash
gemini extensions install https://github.com/Yamato-main/gemini-discord
```

The installer prompts for four values. Restart Gemini CLI and the bot should come online.

| Prompt | What it is |
| --- | --- |
| Discord Bot Token | From the Discord Developer Portal |
| Boss User ID | Your stable numeric Discord user ID — the only ID with full authority |
| Owner User IDs | Legacy routing IDs; no additional authority |
| Server ID | The server where the bot is installed |

---

## Updating Configuration

To rotate credentials or update setup values:

```bash
gemini extensions config gemini-discord
```

For local development:

```bash
npm run setup
```

---

## What it can do

**From Discord, you can:**
- Chat with your agent in any channel, thread, or DM
- Send attachments — images, video, audio, PDFs, text, Markdown, JSON, source files — and the agent receives them in-session
- Trigger scheduled tasks and cron jobs
- Search local media files and post them back when authorized

**Your agent gains Discord tools:**

| Tool | Actions |
| --- | --- |
| `discord_message` | Send, reply, edit, delete, react, fetch reactions, pin, unpin |
| `discord_admin` | Status, restart, reset sessions, discover channels/users, set presence, kick, timeout |
| `discord_history` | Read recent exchanges and archived sessions |
| `discord_cron` | Schedule and manage reminders and recurring jobs |
| `discord_find_media` | Search host machine media and post to Discord |

**Slash commands:**

| Command | Description |
| --- | --- |
| `/new` | Fresh session for the current channel |
| `/status` | Daemon health and runtime info |
| `/model` | Switch Gemini model (boss only) |
| `/pool` | Process pool state (boss only) |
| `/kill` | Kill a pooled process (boss only) |
| `/ping` | Round-trip latency |

---

## Permissions

Two roles: `BOSS` and `GUEST`.

**Boss** authority is granted only by `DISCORD_BOSS_USER_ID` — never by username, display name, role, server owner status, or any other Discord metadata. If that value is missing or malformed, privileged actions fail closed.

**Guests** can chat in allowed channels. When available, simple public Google Search may be allowed. They cannot use MCP tools, shell access, filesystem access, attachment processing, history, discovery, cron, admin, moderation, or outbound Discord actions.

All message sends require an explicit target. If a target can't be proven, the action fails — there is no fallback channel.

Credentials and runtime state stay local. Do not commit `.env`, `.gemini-discord/`, logs, databases, tokens, or real Discord IDs.

---

## Configuration

Most users only need the install prompts. Full reference via [docs/configuration.md](docs/configuration.md).

| Prompt | Purpose |
| --- | --- |
| Discord Bot Token | Lets the bridge connect to Discord |
| Boss User ID | The only Discord user ID with full authority |
| Owner User IDs | Legacy routing IDs; does not grant boss authority |
| Server ID | Server where the bot is installed |

Update these later with:

```bash
gemini extensions config gemini-discord
```

**Agent instructions:** This extension does not ship a `GEMINI.md`. Keep your agent instructions in `~/.gemini/GEMINI.md`. The bridge adds only transport context — message metadata, channel/thread/DM scope, attachment refs, and permission metadata.

---

## Development

```bash
git clone https://github.com/Yamato-main/gemini-discord
cd gemini-discord
npm install && npm run setup && npm run build
```

Install a local path:

```bash
gemini extensions install /absolute/path/to/gemini-discord
```

```bash
npm run typecheck       # Type-check
npm test                # Run tests
npm run dev:daemon      # Daemon in dev mode
npm run start:daemon    # Start daemon
npm run start:server    # Start MCP server
npm run install-service # Install as system service
```

Before releasing: run typecheck + tests + build, commit `dist/`, keep `.env` and `.gemini-discord/` untracked, use placeholder IDs in examples, add the `gemini-cli-extension` GitHub topic.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
