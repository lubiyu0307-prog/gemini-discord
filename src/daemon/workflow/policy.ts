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

  const explicitDiscordSendPatterns = [
    /\b(?:send|post|publish)\s+(?:a\s+)?(?:discord\s+)?(?:message|reply|update)\b/,
    /\b(?:send|post|publish)\b.*\b(?:to|in|on)\s+(?:discord|this\s+thread|this\s+channel|here|#\w[\w-]*)\b/,
    /\b(?:send|post)\s+(?:it|that|this)\s+(?:here|to\s+discord|in\s+this\s+thread|in\s+this\s+channel)\b/,
    /\b(?:send|post)\s+(?!me\b).+\bhere\b/,
    /\breply\s+(?:in|to)\s+(?:this\s+thread|this\s+channel|discord)\b/,
  ];

  return explicitDiscordSendPatterns.some((pattern) => pattern.test(normalized));
}
