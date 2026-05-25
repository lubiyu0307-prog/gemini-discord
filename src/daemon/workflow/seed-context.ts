import type { ThreadManifest } from './thread-manifest.js';

export function buildWorkflowSeedContext(manifest: ThreadManifest): string {
  const originType = manifest.originContext.type === 'dm' ? 'Direct Message (DM)' : 'Channel';
  
  return `You are executing a task inside an opt-in monitored workflow thread.
The user Yamato requested this workflow thread to run a specific task.

Context:
- Task Goal: "${manifest.taskSummary}"
- Creator: <@${manifest.creatorUserId}>
- Origin: ${originType} (Source channel: ${manifest.originContext.sourceChannelId})

Important Directives:
- Focus solely on achieving the task goal.
- You are running in a clean, thread-scoped isolated session with no chat history from the parent channel/DM.
- Be concise, direct, and execute tools to make progress. Do not converse or narrate unnecessarily.
`;
}
