import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../src/shared/types.js';
import {
  mergeImmediateMentionContext,
  RecentDiscordContextBuffer,
  RECENT_DISCORD_CONTEXT_LIMIT,
} from '../src/daemon/recent-context.js';

function message(content: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  const index = String(overrides.messageId ?? content).replace(/\D/g, '') || '0';
  return {
    role: 'user',
    content,
    speakerKind: 'human',
    authorBridgeRole: 'GUEST',
    authorId: `user-${index}`,
    authorName: `User ${index}`,
    channelId: 'channel-1',
    channelName: 'general',
    threadId: null,
    guildId: 'guild-1',
    guildName: 'Guild',
    messageId: `m-${index}`,
    createdAt: `2026-06-11T00:00:0${Number(index) % 10}.000Z`,
    ...overrides,
  };
}

describe('RecentDiscordContextBuffer', () => {
  it('selects the last six same-origin messages from all recent users for an atomic mention', () => {
    const buffer = new RecentDiscordContextBuffer();
    const authors = [
      { authorId: 'alice', authorName: 'Alice#0001', authorBridgeRole: 'GUEST' as const },
      { authorId: 'bob', authorName: 'Bob#0001', authorBridgeRole: 'GUEST' as const },
      { authorId: 'boss', authorName: 'Yamato#0001', authorBridgeRole: 'BOSS' as const },
    ];

    for (let index = 1; index <= 7; index++) {
      buffer.remember(message(`message ${index}`, {
        messageId: `m-${index}`,
        ...authors[(index - 1) % authors.length],
      }));
    }

    const selected = buffer.selectForAtomicMention({
      channelId: 'channel-1',
      threadId: null,
      messageId: 'm-ping',
    });

    expect(RECENT_DISCORD_CONTEXT_LIMIT).toBe(6);
    expect(selected.map((entry) => entry.content)).toEqual([
      'message 2',
      'message 3',
      'message 4',
      'message 5',
      'message 6',
      'message 7',
    ]);
    expect(selected.map((entry) => `${entry.authorName}:${entry.authorBridgeRole}`)).toEqual([
      'Bob#0001:GUEST',
      'Yamato#0001:BOSS',
      'Alice#0001:GUEST',
      'Bob#0001:GUEST',
      'Yamato#0001:BOSS',
      'Alice#0001:GUEST',
    ]);
  });

  it('excludes the current ping and messages from other channels or threads', () => {
    const buffer = new RecentDiscordContextBuffer();
    buffer.remember(message('same channel', { messageId: 'm-1' }));
    buffer.remember(message('current ping', { messageId: 'm-ping' }));
    buffer.remember(message('other channel', { messageId: 'm-2', channelId: 'channel-2' }));
    buffer.remember(message('other thread', { messageId: 'm-3', threadId: 'thread-1' }));

    const selected = buffer.selectForAtomicMention({
      channelId: 'channel-1',
      threadId: null,
      messageId: 'm-ping',
    });

    expect(selected.map((entry) => entry.content)).toEqual(['same channel']);
  });

  it('merges durable and transient context without duplicate messages', () => {
    const durable = [
      message('durable old', { messageId: 'm-1' }),
      message('durable duplicate', { messageId: 'm-2' }),
    ];
    const transient = [
      message('durable duplicate from buffer', { messageId: 'm-2' }),
      message('transient new', { messageId: 'm-3' }),
    ];

    const merged = mergeImmediateMentionContext(durable, transient);

    expect(merged.map((entry) => entry.messageId)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(merged.map((entry) => entry.content)).toEqual([
      'durable old',
      'durable duplicate from buffer',
      'transient new',
    ]);
  });

  it('preserves conversation order when durable and transient context overlap', () => {
    const durable = [
      message('durable 5', { messageId: 'm-5', createdAt: '2026-06-11T00:00:05.000Z' }),
      message('durable 6', { messageId: 'm-6', createdAt: '2026-06-11T00:00:06.000Z' }),
    ];
    const transient = [2, 3, 4, 5, 6, 7].map((index) => message(`transient ${index}`, {
      messageId: `m-${index}`,
      createdAt: `2026-06-11T00:00:0${index}.000Z`,
    }));

    const merged = mergeImmediateMentionContext(durable, transient);

    expect(merged.map((entry) => entry.messageId)).toEqual([
      'm-2',
      'm-3',
      'm-4',
      'm-5',
      'm-6',
      'm-7',
    ]);
    expect(merged.map((entry) => entry.content)).toEqual([
      'transient 2',
      'transient 3',
      'transient 4',
      'transient 5',
      'transient 6',
      'transient 7',
    ]);
  });
});
