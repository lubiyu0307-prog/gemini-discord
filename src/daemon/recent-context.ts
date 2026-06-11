import type { ConversationMessage } from '../shared/types.js';

export const RECENT_DISCORD_CONTEXT_LIMIT = 6;
const MAX_BUFFERED_MESSAGES_PER_ORIGIN = 24;

export interface DiscordContextOrigin {
  channelId: string;
  threadId?: string | null;
  messageId?: string | null;
}

export class RecentDiscordContextBuffer {
  private byOrigin = new Map<string, ConversationMessage[]>();

  remember(message: ConversationMessage): void {
    if (!message.channelId) {
      return;
    }

    const key = originKey(message.channelId, message.threadId ?? null);
    const existing = this.byOrigin.get(key) ?? [];
    const withoutDuplicate = message.messageId
      ? existing.filter((entry) => entry.messageId !== message.messageId)
      : existing;

    withoutDuplicate.push(message);
    this.byOrigin.set(key, withoutDuplicate.slice(-MAX_BUFFERED_MESSAGES_PER_ORIGIN));
  }

  selectForAtomicMention(origin: DiscordContextOrigin, limit = RECENT_DISCORD_CONTEXT_LIMIT): ConversationMessage[] {
    const entries = this.byOrigin.get(originKey(origin.channelId, origin.threadId ?? null)) ?? [];
    const currentMessageId = origin.messageId ?? null;
    return entries
      .filter((entry) => !currentMessageId || entry.messageId !== currentMessageId)
      .slice(-Math.max(0, limit));
  }

  clear(): void {
    this.byOrigin.clear();
  }
}

export function mergeImmediateMentionContext(
  durableContext: ConversationMessage[],
  transientContext: ConversationMessage[],
  limit = RECENT_DISCORD_CONTEXT_LIMIT,
): ConversationMessage[] {
  const byIdentity = new Map<string, { entry: ConversationMessage; order: number }>();
  let order = 0;

  for (const entry of [...durableContext, ...transientContext]) {
    const identity = entry.messageId ? `message:${entry.messageId}` : `entry:${order}`;
    byIdentity.set(identity, { entry, order });
    order++;
  }

  return [...byIdentity.values()]
    .sort((a, b) => compareContextEntries(a, b))
    .map(({ entry }) => entry)
    .slice(-Math.max(0, limit));
}

function originKey(channelId: string, threadId: string | null): string {
  return `${channelId}:${threadId ?? ''}`;
}

function compareContextEntries(
  a: { entry: ConversationMessage; order: number },
  b: { entry: ConversationMessage; order: number },
): number {
  const aTime = parseCreatedAt(a.entry.createdAt);
  const bTime = parseCreatedAt(b.entry.createdAt);
  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }

  return a.order - b.order;
}

function parseCreatedAt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
