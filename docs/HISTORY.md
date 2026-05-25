# Change History

## [2026-05-25] Monitored Workflow Threads Implementation

Implemented opt-in monitored workflow threads to allow users to view Gemini CLI tool-call execution traces directly inside Discord threads.

### Added Features
- **Monitored Threads Trigger**: Added `/workflow <task>` slash command and `!thread <task>` / `!workflow <task>` text commands to opt-in to monitored execution.
- **DM Overflow Handling**: Added support for directing DM-based workflow thread requests to a central channel via the `WORKFLOW_PARENT_CHANNEL_ID` config parameter.
- **Session Isolation**: Created distinct Gemini session scopes under `thread:{threadId}` for workflow threads so they do not contaminate standard channel/DM histories.
- **Seed Context**: Fed the workflow threads with the initiating user prompt/source message contents to bootstrap execution.
- **Live Trace Dispatcher & Renderer**: Real-time rendering of tool-execution steps (calls, inputs, outputs, progress, failures) utilizing Discord's message editing capability to bypass rate limits.
- **Trace Redactor**: A safety-first redaction pipeline that strips API tokens, local system absolute paths, IP addresses, and sensitive command-line flags before posting to Discord.

### File Modifications
- **New Modules**:
  - `src/daemon/workflow/thread-manifest.ts`: Metadata persistence for active workflow threads.
  - `src/daemon/workflow/thread-creator.ts`: Thread creation and DM overflow validation.
  - `src/daemon/workflow/trace-event.ts`: Model definitions for CLI tool-call execution trace stages.
  - `src/daemon/workflow/tool-registry.ts`: Friendlier mappings of CLI tools to human-readable names.
  - `src/daemon/workflow/trace-normalizer.ts`: Normalization of CLI JSON logs to unified trace events.
  - `src/daemon/workflow/redaction.ts`: Regular expressions and functions for content scrubbing.
  - `src/daemon/workflow/trace-renderer.ts`: Formatting trace events to Discord-friendly embeds and codeblocks.
  - `src/daemon/workflow/trace-dispatcher.ts`: Stateful manager for posting and editing live Discord status updates.
  - `src/daemon/workflow/seed-context.ts`: Initial prompt seeding logic.
- **Modified Core Modules**:
  - `src/daemon/gateway.ts`: Added text commands routing, integrated `createWorkflowThread`, and wired up `TraceDispatcher` for trace execution callbacks.
  - `src/daemon/bot.ts` & `src/daemon/routing.ts`: Integrated parent-channel fallback allowed checks to support thread routing.
  - `src/daemon/engine-cli.ts` & `src/daemon/memory.ts` & `src/daemon/session-reset.ts`: Isolated workspace session keys and routed seed context / trace callback parameters.
  - `src/shared/config.ts` & `src/shared/config-vars.ts` & `src/shared/types.ts`: Added `workflowParentChannelId` configuration mapping.
