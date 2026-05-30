# Troubleshooting

Use this page when `gemini-discord` does not come online after setup.

## Logs

Check `.gemini-discord/daemon.log` in the extension installation directory.

## Port Conflicts

The daemon treats `DAEMON_PORT` as a preferred port, not a hard requirement. If the configured port is already occupied, it tries subsequent ports and records the active port in `.gemini-discord/daemon.port` so MCP tools can reconnect automatically.

Fix:
1. Read `.gemini-discord/daemon.log` and look for `Port <number> in use, trying next...` followed by `Control API listening`.
2. Check `.gemini-discord/daemon.port` to confirm the active control API port.
3. If MCP tools still report the daemon as offline, restart Gemini CLI so the extension process reloads runtime state.
4. Only change `DAEMON_PORT` manually if you need a stable preferred port; do not edit `gemini-extension.json` for routine conflicts.

## Duplicate Discord Replies

For branch testing, start the daemon with `GEMINI_DISCORD_DAEMON_SINGLETON=1` to allow only one daemon per Discord bot token and OS user. With the guard enabled, startup takes a token-scoped lock in the system temp directory. During upgrades it also checks for older same-user `gemini-discord/dist/daemon.cjs` processes that predate the lock. If startup reports that another daemon is already running, stop the older install or test process before starting the branch you want to use.

Fix:
1. Run `pgrep -af "gemini-discord.*dist/daemon.cjs"` to find duplicate daemons.
2. Stop the process for the install or branch you are not testing.
3. Start only the branch daemon you want Discord to receive events from.

## Disallowed Intents (4014)

Discord closes the gateway with code `4014` when the bot requests privileged intents that are not enabled in the Discord Developer Portal.

Fix:
1. Open the Discord Developer Portal.
2. Select your application.
3. Go to **Bot**.
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
5. Enable **Server Members Intent** too, unless you set `DISCORD_ENABLE_SERVER_MEMBERS_INTENT=false`.

The daemon automatically falls back when Server Members Intent is unavailable, but Message Content Intent is still required for useful chat behavior.

## Invalid Token (4004)

Discord closes the gateway with code `4004` when the configured bot token is invalid or expired.

Fix:
1. Reset the bot token in the Discord Developer Portal.
2. Run `gemini extensions config gemini-discord`.
3. Enter the new token.
4. Restart Gemini CLI.

## Bare Mentions and Immediate Context

When a Discord message only mentions the bot, the daemon accepts it as a normal mention turn and sends Gemini a small immediate-context block. That block is capped to the last 2-3 messages in the same channel or thread and labels speakers as `BOSS`, `GUEST`, `allowed_agent`, or `self_bot`.

If a bare mention does not respond:
1. Confirm the message appears in `.gemini-discord/daemon.log` as `Accepted Discord message` with `trigger:"mention"`.
2. Confirm the preceding messages were in the same channel or thread.
3. If the bot needs to perform a Discord action from that context, check that the prior message clearly requested the action, such as creating a thread.

## Native Thread Creation

Thread requests use Discord's native thread APIs. With a source message ID, the daemon calls the message thread API; without one, it creates a native thread in the target channel.

If thread creation fails:
1. Check `.gemini-discord/daemon.log` for `Thread creation requested`, `Thread created`, or `Thread creation failed`.
2. Confirm the target channel is included in `DISCORD_ALLOWED_CHANNEL_IDS`, or that the server-wide allow mode is active.
3. Confirm the bot has Discord permissions to create threads in that channel.

## Workflow Thread Trace Visibility

Workflow trace cards are rendered from Gemini CLI ACP `tool_call`, `tool_call_update`, and `plan` events. A newly enqueued workflow should always edit its header to `Running` and refresh elapsed time while it is waiting for the first tool event.

If a workflow completes with `0 tool calls`, Discord was not silently stuck. It means the agent run did not emit tool events that the daemon observed. Check:
1. The task was specific enough to start. Low-information tasks such as `job` are rejected before thread creation.
2. `.gemini-discord/daemon.log` for ACP updates and trace dispatch warnings.
3. The Gemini CLI version and output mode. The daemon supports current top-level ACP tool fields (`toolCallId`, `title`, `status`, `kind`, `content`, `rawInput`, `rawOutput`) and older nested `toolCall` payloads.

## Session Reset

`/new` archives the active Discord transcript, resets the bound Gemini CLI session for that channel, and kills warm pooled CLI processes for that binding. The daemon logs this as `Conversation session reset` with `sessionKey`, `bindingKey`, and the archived Gemini session ID.

After `/new`, bare mentions only receive immediate active-channel context. Older archived sessions are not replayed unless the user explicitly asks to inspect history.
