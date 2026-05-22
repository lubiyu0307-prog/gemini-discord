# gemini-discord

Use your local Gemini CLI agent from Discord.

This is not a hosted bot. It is not a second agent. It is a bridge between Discord and the Gemini CLI setup already running on your machine.

You keep the agent local. Discord becomes another interface.

## What it gives you

- Talk to your Gemini CLI agent from Discord channels, threads, or DMs.
- Keep the same local Gemini identity, context, and tools.
- Send replies, files, reactions, pins, reminders, and moderation actions through MCP tools.
- Keep privileged actions locked to one configured Discord user ID.
- Keep runtime state local.

The design goal is simple: your local agent should be reachable from Discord without turning it into a public bot service.

## Install

Requirements:

- Node.js 22+
- Gemini CLI installed and authenticated
- A Discord bot token
- Discord Developer Mode enabled

Create a Discord bot:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application.
3. Add a bot under **Bot**.
4. Copy the bot token.
5. Enable **Message Content Intent**.
6. Enable **Server Members Intent** if you want user discovery.
7. Use **OAuth2 > URL Generator** to invite the bot.

Recommended bot permissions:

- View Channels
- Read Message History
- Send Messages
- Use Slash Commands
- Attach Files
- Add Reactions
- Manage Messages, if using pin/edit/delete flows
- Kick Members / Moderate Members, only if using moderation

Install the extension:

```bash
gemini extensions install https://github.com/Yamato-main/gemini-discord
```

Gemini CLI will ask for:

| Setting | Purpose |
| --- | --- |
| Discord Bot Token | Token from the Discord Developer Portal |
| Boss Discord User ID | Stable numeric Discord user ID with full authority |
| Owner Discord User IDs | Legacy/setup routing IDs; not boss authority |
| Discord Server ID | Server where the bot is installed |

After install, Gemini CLI loads the MCP server. If daemon auto-start is enabled, the Discord daemon starts automatically.

## Local development

```bash
git clone https://github.com/Yamato-main/gemini-discord
cd gemini-discord
npm install
npm run setup
npm run build
```

Then install the local path:

```bash
gemini extensions install /absolute/path/to/gemini-discord
```

Runtime files are stored under:

```text
.gemini-discord/
```

Keep that directory out of git.

## Identity

The Discord bot uses your normal Gemini CLI identity.

This extension does not ship its own `GEMINI.md`. Put agent instructions in your global Gemini config instead:

```text
~/.gemini/GEMINI.md
```

The bridge adds transport context only:

- Discord message metadata
- reply context
- channel/thread/DM context
- attachment references
- MCP tool descriptions
- permission metadata

Discord is the interface. Gemini CLI remains the agent.

## Usage

Talk to the bot in an allowed server channel, thread, or DM.

Supported attachment types include:

- images
- videos such as `.mp4` and `.webm`
- audio
- PDFs
- text files
- Markdown, JSON, and source files

Small supported media is passed into the warm Gemini CLI session. Larger files are handled through local file references. Temporary attachment files are cleaned automatically.

## Slash commands

| Command | Purpose |
| --- | --- |
| `/new` | Start a fresh Gemini conversation for the current channel |
| `/status` | Show daemon health and runtime status |
| `/ping` | Check Discord/API latency |
| `/model` | Switch the active Gemini model |
| `/pool` | Show Gemini CLI process pool state |
| `/kill` | Kill a pooled Gemini CLI process |

Privileged commands are checked against the bridge permission model.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `discord_message` | Send, reply, edit, delete, react, unreact, fetch reactions, pin, unpin, list pins |
| `discord_admin` | Status, restart, reset, channel discovery, user discovery, presence, kick, timeout, remove timeout |
| `discord_history` | Read recent exchanges, conversation buffers, and archives |
| `discord_cron` | Schedule reminders, schedule cron jobs, list jobs, delete jobs |
| `discord_find_media` | Search local media files on the host machine |

Message actions require explicit targets:

- `send` requires `channel_id` or `channel_name`
- `reply` requires `channel_id` and `message_id`
- `edit` and `delete` only apply to bot-owned messages
- reaction and pin actions require `channel_id` and `message_id`
- `send` and `reply` support `files`
- `send` and `reply` support `silent: true`

## Permission model

The bridge uses two runtime roles:

```text
BOSS
GUEST
```

Only `DISCORD_BOSS_USER_ID` grants boss authority.

Boss authority is resolved only from the stable numeric Discord user ID configured at runtime. It is never granted by:

- username
- display name
- nickname
- mention text
- Discord role
- server owner status
- Discord administrator permission
- allowlist membership
- discovered user metadata
- legacy owner/admin settings

If `DISCORD_BOSS_USER_ID` is missing or malformed, privileged actions fail closed.

Guests may chat normally where the bot is allowed to respond. Guests may also use simple public Google Search through Gemini CLI when available.

Guests may not use MCP tools, shell access, filesystem access, repo access, local media, attachment processing, authenticated browsing, outbound Discord actions, history, status, discovery, cron, admin, moderation, boss memory, or boss sessions.

## Channel safety

The bridge does not post to unproven targets.

These actions require explicit target information:

- sending messages
- replies through tools
- history reads
- session resets
- scheduled messages
- reaction operations
- pin operations

If the target cannot be proven, the action fails.

The bridge does not fall back to a primary/default channel.

Normal conversational replies stay in the origin channel, thread, or DM. Gemini sessions and Discord memory are isolated by channel/thread or DM user, depending on configuration.

## Configuration

Most users configure the extension during install.

For local development, start from:

```text
.env.example
```

Core settings:

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_BOSS_USER_ID` | Stable numeric Discord user ID with full authority |
| `DISCORD_OWNER_IDS` | Legacy/setup routing IDs; not boss authority |
| `DISCORD_SERVER_ID` | Server used for setup and discovery |
| `DISCORD_CHANNEL_ID` | Optional remembered channel value; not an unsafe fallback |
| `DISCORD_ALLOWED_CHANNEL_IDS` | Optional channel allowlist |
| `DISCORD_ALLOWED_USER_IDS` | Optional human user allowlist |
| `DISCORD_ALLOWED_AGENT_IDS` | Optional peer bot allowlist |
| `ENABLE_DMS` | Enables DM handling |
| `REQUIRE_MENTION` | Requires mention in server channels |
| `MEMORY_SCOPE` | Controls Discord memory isolation |
| `GEMINI_SESSION_BINDING_SCOPE` | Controls Gemini CLI session binding |
| `GEMINI_MAX_CONCURRENT` | Maximum warm Gemini CLI processes |
| `CLI_IDLE_TIMEOUT_MS` | Idle timeout for pooled Gemini CLI processes |

Do not commit real tokens, real IDs, `.env`, `.gemini-discord/`, logs, databases, or local runtime files.

## Performance

The daemon keeps Gemini CLI ACP processes warm per conversation/tool tier. Normal text turns avoid cold starts. Attachment turns use the same warm path instead of spawning a separate headless process.

When streaming is enabled, the bot starts with Discord typing indicators, sends visible text early, and edits at a safe cadence. If all Gemini slots are busy, the bot posts a queue notice and removes it once the turn starts.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
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
