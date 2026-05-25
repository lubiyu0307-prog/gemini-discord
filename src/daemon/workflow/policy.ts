/**
 * Workflow policy module.
 */

/**
 * Checks if the original user request explicitly asked for a Discord send/reply/post action.
 * If not, current-thread discord_message tool calls will be intercepted by the policy.
 */
export function isExplicitSendToCurrentThread(userContent: string): boolean {
  const normalized = userContent.toLowerCase();

  // If they just say "reply with ...", "reply only ...", "reply with only ...",
  // "reply to this with ...", "reply back with", it is conversational/output formatting,
  // not an explicit instruction to use the Discord API send/reply tool.
  if (
    normalized.includes('reply with') ||
    normalized.includes('reply only') ||
    normalized.includes('reply with only') ||
    normalized.includes('reply to this with') ||
    normalized.includes('reply back')
  ) {
    return false;
  }

  // Check for explicit Discord publishing commands/actions:
  // "send a message", "post a message", "publish to", "post that", etc.
  // But also look for keywords "send", "post", "publish" in general.
  return (
    normalized.includes('send') ||
    normalized.includes('post') ||
    normalized.includes('publish')
  );
}
