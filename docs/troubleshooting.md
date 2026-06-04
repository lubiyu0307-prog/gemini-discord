# Troubleshooting

Use this page when `gemini-discord` does not come online after setup.

## Logs

Check `.gemini-discord/daemon.log` in the extension installation directory.

## Channel Discovery and Allowlist

The daemon can discover text, announcement, and forum channels in the configured Discord server. The channel allowlist controls where the bot is allowed to read and respond, so adding a channel now requires the daemon to verify that the channel belongs to the configured server.

Use this flow when the bot is online but does not respond in the expected channel:

1. Confirm `DISCORD_SERVER_ID` is set for the server where the bot is installed.
2. Call the control API `GET /channels?all=true` with boss credentials to list available channels.
3. Find the intended channel ID in the response.
4. Call `POST /channel-allowlist` with `{"action":"add","channel_id":"<channel id>"}` to allow the bot to operate there.
5. To remove a channel, call `POST /channel-allowlist` with `{"action":"remove","channel_id":"<channel id>"}`.

If `GET /channels?all=true` returns a channel discovery error, check that the bot is still in the server and has permission to view channels. If adding to `/channel-allowlist` fails, verify that the channel ID came from the same configured Discord server; IDs from other servers or channels the bot cannot verify are rejected.

## Port Conflicts

The daemon treats `DAEMON_PORT` as a preferred port, not a hard requirement. If the configured port is already occupied, it tries subsequent ports and records the active port in `.gemini-discord/daemon.port` so MCP tools can reconnect automatically.

Fix:
1. Read `.gemini-discord/daemon.log` and look for `Port <number> in use, trying next...` followed by `Control API listening`.
2. Check `.gemini-discord/daemon.port` to confirm the active control API port.
3. If MCP tools still report the daemon as offline, restart Gemini CLI so the extension process reloads runtime state.
4. Only change `DAEMON_PORT` manually if you need a stable preferred port; do not edit `gemini-extension.json` for routine conflicts.

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
