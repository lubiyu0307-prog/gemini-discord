import { describe, it, expect } from 'vitest';
import type { Config } from '../src/shared/types.js';
import { isDirectMessageAuthorAllowed, shouldAcceptMessage } from '../src/daemon/routing.js';

const baseConfig: Config = {
  discordBotToken: 'token',
  discordChannelId: 'ch1',
  discordServerId: '',
  discordServerName: '',
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

describe('shouldAcceptMessage', () => {
  it('accepts the boss always', () => {
    expect(route({ authorId: '111111111111111111' })).toMatchObject({
      accept: true,
      trigger: 'channel',
    });
  });

  it('rejects fresh-install non-boss humans by default', () => {
    const config: Config = { ...baseConfig, allowedUserIds: [], enableGuests: false };
    expect(route({ authorId: '222222222222222222' }, config)).toMatchObject({ accept: false });
  });

  it('accepts allowlisted humans when guests are globally disabled', () => {
    expect(route({ authorId: 'owner-1' })).toMatchObject({
      accept: true,
      speakerKind: 'human',
      trigger: 'channel',
      content: 'hello',
    });
  });

  it('strips command prefixes for authorized users', () => {
    const config: Config = { ...baseConfig, enableGuests: true };
    expect(route({ authorId: 'owner-1', content: '!hello there' }, config)).toMatchObject({
      accept: true,
      trigger: 'prefix',
      content: 'hello there',
    });
  });

  it('rejects non-allowlisted humans when guests are disabled', () => {
    expect(route({ authorId: '222222222222222222' })).toMatchObject({ accept: false });
  });

  it('accepts non-allowlisted humans when guests are enabled', () => {
    const config: Config = { ...baseConfig, enableGuests: true };
    expect(route({ authorId: '222222222222222222' }, config)).toMatchObject({
      accept: true,
      speakerKind: 'human',
      trigger: 'channel',
      content: 'hello',
    });
  });

  it('does not treat bot users as human guests when guests are enabled', () => {
    const config: Config = { ...baseConfig, allowedAgentIds: [], enableGuests: true };
    expect(route({
      authorId: '333333333333333333',
      authorTag: 'PeerBot#9999',
      isBot: true,
      mentionedBot: true,
      content: '<@bot1> hello',
    }, config)).toMatchObject({ accept: false });
  });

  it('requires explicit triggers for peer agents even if they are allowlisted', () => {
    const config: Config = { ...baseConfig, enableGuests: true };
    expect(route({
      authorId: 'agent1',
      authorTag: 'OtherAgent#9999',
      isBot: true,
      content: 'hello',
    }, config)).toMatchObject({ accept: false });

    expect(route({
      authorId: 'agent1',
      authorTag: 'OtherAgent#9999',
      isBot: true,
      content: '<@bot1> hello',
      mentionedBot: true,
    }, config)).toMatchObject({
      accept: true,
      speakerKind: 'agent',
      trigger: 'mention',
      content: 'hello',
    });
  });

  it('supports DMs for authorized users only', () => {
    const config: Config = { ...baseConfig, enableGuests: true };
    expect(route({
      authorId: 'owner-1',
      isDM: true,
      guildId: null,
      guildName: null,
      channelId: 'dm1',
      channelName: 'dm-user',
      content: 'private hello',
    }, config)).toMatchObject({
      accept: true,
      trigger: 'dm',
      content: 'private hello',
    });

    expect(route({
      authorId: '222222222222222222',
      isDM: true,
      guildId: null,
      guildName: null,
      channelId: 'dm1',
      channelName: 'dm-user',
      content: 'private hello',
    }, baseConfig)).toMatchObject({ accept: false });
  });

  it('matches the shared authorization helper', () => {
    const enabledConfig = { ...baseConfig, enableGuests: true };
    expect(isDirectMessageAuthorAllowed('111111111111111111', baseConfig)).toBe(true);
    expect(isDirectMessageAuthorAllowed('owner-1', baseConfig)).toBe(true); // allowlisted
    expect(isDirectMessageAuthorAllowed('222222222222222222', baseConfig)).toBe(false); // disabled + not allowlisted
    expect(isDirectMessageAuthorAllowed('222222222222222222', enabledConfig)).toBe(true); // enabled guest
  });

  it('accepts attachment-only messages from authorized users', () => {
    const config: Config = { ...baseConfig, enableGuests: true };
    expect(route({ authorId: 'owner-1', content: '', attachmentCount: 1 }, config)).toMatchObject({
      accept: true,
      content: '',
      trigger: 'channel',
    });
  });

  it('honors requireMention for authorized users in guild channels', () => {
    const config: Config = { ...baseConfig, enableGuests: true, requireMention: true };
    expect(route({ authorId: 'owner-1' }, config)).toMatchObject({ accept: false });
    expect(route({ authorId: 'owner-1', mentionedBot: true, content: '<@bot1> hello' }, config)).toMatchObject({
      accept: true,
      trigger: 'mention',
      content: 'hello',
    });
  });

  it('accepts a bare bot mention so the agent can answer from immediate context', () => {
    expect(route({ authorId: 'owner-1', mentionedBot: true, content: '<@bot1>' })).toMatchObject({
      accept: true,
      trigger: 'mention',
      content: '',
    });
  });

  it('allows setup-only server routing before channel discovery has populated channels', () => {
    const config: Config = {
      ...baseConfig,
      discordChannelId: '',
      discordServerId: 'g1',
      allowedChannelIds: [],
      requireMention: true,
    };

    expect(route({
      authorId: '111111111111111111', // Boss
      channelId: 'new-channel',
      guildId: 'g1',
      mentionedBot: true,
      content: '<@bot1> hello from setup server',
    }, config)).toMatchObject({
      accept: true,
      trigger: 'mention',
      content: 'hello from setup server',
    });
  });
});
