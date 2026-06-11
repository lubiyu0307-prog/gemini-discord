import { describe, it, expect } from 'vitest';
import type { Config } from '../src/shared/types.js';
import { shouldAcceptMessage } from '../src/daemon/routing.js';

const baseConfig: Config = {
  discordBotToken: 'token',
  discordChannelId: 'ch1',
  discordServerId: 'g1',
  discordServerName: 'Test Guild',
  discordBossUserId: '111111111111111111',
  ownerIds: ['owner-1'],
  discordAdminId: 'owner-1',
  allowedChannelIds: ['ch1', 'ch2'],
  allowedUserIds: ['owner-1', 'user2'],
  allowedAgentIds: ['agent1'],
  daemonApiToken: 'x'.repeat(64),
  discordPrefix: '!',
  discordResetCmd: '!reset',
  daemonPort: 18790,
  geminiPath: 'gemini',
  geminiModel: 'gemini-3.1-pro-preview',
  geminiTimeoutMs: 300000,
  geminiMaxConcurrent: 3,
  conversationHistoryLength: 10,
  promptHistoryMessageLimit: 16,
  promptHistoryCharBudget: 12000,
  streaming: true,
  queueMaxDepth: 20,
  enableDMs: true,
  enableGuests: false,
  enableGuestAttachments: false,
  requireMention: false,
  respondToReplies: true,
  memoryScope: 'global',
  autoStartDaemon: true,
  useGeminiCliSessions: true,
  geminiSessionBindingScope: 'server',
  cliIdleTimeoutMs: 300000,
  setupValidationPending: false,
  workflowParentChannelId: '',
};

function route(overrides: Partial<Parameters<typeof shouldAcceptMessage>[0]> = {}, config: Config = baseConfig) {
  return shouldAcceptMessage({
    authorId: 'owner-1',
    authorTag: 'User#0001',
    isBot: false,
    botUserId: 'bot1',
    content: 'hello',
    attachmentCount: 0,
    channelId: 'ch1',
    channelName: 'bridge-channel',
    guildId: 'g1',
    guildName: 'Test Guild',
    isDM: false,
    mentionedBot: false,
    repliedToBot: false,
    replyToMessageId: null,
    ...overrides,
  }, config);
}

describe('workflow routing', () => {
  it('accepts messages in thread if thread ID itself is in allowedChannelIds', () => {
    expect(route({ channelId: 'ch1', parentChannelId: 'disallowed-parent' })).toMatchObject({
      accept: true,
    });
  });

  it('accepts messages in thread if thread ID is not allowed but parent channel ID is in allowedChannelIds', () => {
    expect(route({ channelId: 'thread-1', parentChannelId: 'ch1' })).toMatchObject({
      accept: true,
    });
  });

  it('rejects messages in thread if both thread ID and parent channel ID are not in allowedChannelIds', () => {
    expect(route({ channelId: 'thread-1', parentChannelId: 'disallowed-parent' })).toMatchObject({
      accept: false,
    });
  });

  it('accepts messages in thread if allowedChannelIds is empty but guild ID matches discordServerId', () => {
    const config: Config = { ...baseConfig, allowedChannelIds: [], discordServerId: 'g1' };
    expect(route({ channelId: 'thread-1', parentChannelId: 'disallowed-parent', guildId: 'g1' }, config)).toMatchObject({
      accept: true,
    });
  });

  it('rejects messages in thread if allowedChannelIds is empty but guild ID does not match discordServerId', () => {
    const config: Config = { ...baseConfig, allowedChannelIds: [], discordServerId: 'g1' };
    expect(route({ channelId: 'thread-1', parentChannelId: 'disallowed-parent', guildId: 'g2' }, config)).toMatchObject({
      accept: false,
    });
  });

  it('preserves non-thread (normal channel) allowed behavior', () => {
    expect(route({ channelId: 'ch1', parentChannelId: undefined })).toMatchObject({
      accept: true,
    });
    expect(route({ channelId: 'disallowed-ch', parentChannelId: undefined })).toMatchObject({
      accept: false,
    });
  });

  it('preserves DM routing behavior (independent of channel allowlists)', () => {
    expect(route({ isDM: true, channelId: 'dm-1', parentChannelId: undefined, guildId: null })).toMatchObject({
      accept: true,
    });
  });
});
