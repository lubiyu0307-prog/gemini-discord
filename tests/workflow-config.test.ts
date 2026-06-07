import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { Config } from '../src/shared/types.js';
import { createWorkflowThread } from '../src/daemon/workflow/thread-creator.js';

const mockBaseConfig: Config = {
  discordBotToken: 'token',
  discordChannelId: 'ch1',
  discordServerId: 'g1',
  discordServerName: 'Test Guild',
  discordBossUserId: 'owner-1',
  ownerIds: ['owner-1'],
  discordAdminId: 'owner-1',
  allowedChannelIds: ['ch1'],
  allowedUserIds: ['owner-1'],
  allowedAgentIds: [],
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
  workflowParentChannelId: '', // Unset initially
};

describe('DM workflow config validation', () => {
  it('throws error when WORKFLOW_PARENT_CHANNEL_ID is unset and origin is DM', async () => {
    // Mock origin channel (DM)
    const mockDmChannel = {
      id: 'dm-1',
      isTextBased: () => true,
      isDMBased: () => true,
      send: vi.fn(),
    };

    const mockClient = {
      channels: {
        fetch: vi.fn().mockImplementation(async (id) => {
          if (id === 'dm-1') return mockDmChannel;
          return null;
        }),
      },
      users: {
        fetch: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    await expect(
      createWorkflowThread(mockClient, mockBaseConfig, '/tmp', {
        taskSummary: 'Test DM task',
        creatorUserId: 'owner-1',
        sourceChannelId: 'dm-1',
      })
    ).rejects.toThrow('WORKFLOW_PARENT_CHANNEL_ID is not configured. Workflow threads cannot be created from DMs without a configured parent channel.');
  });

  it('throws error when WORKFLOW_PARENT_CHANNEL_ID is configured but channel does not exist/is not text-based/not thread-capable', async () => {
    const mockDmChannel = {
      id: 'dm-1',
      isTextBased: () => true,
      isDMBased: () => true,
      send: vi.fn(),
    };

    const config = {
      ...mockBaseConfig,
      workflowParentChannelId: 'invalid-parent',
    };

    const mockClient = {
      channels: {
        fetch: vi.fn().mockImplementation(async (id) => {
          if (id === 'dm-1') return mockDmChannel;
          if (id === 'invalid-parent') {
            // Not text-based or lacks threads property
            return {
              id: 'invalid-parent',
              isTextBased: () => false,
              isDMBased: () => false,
            };
          }
          return null;
        }),
      },
      users: {
        fetch: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    await expect(
      createWorkflowThread(mockClient, config, '/tmp', {
        taskSummary: 'Test DM task',
        creatorUserId: 'owner-1',
        sourceChannelId: 'dm-1',
      })
    ).rejects.toThrow('Configured WORKFLOW_PARENT_CHANNEL_ID invalid-parent is not a valid thread-capable guild text channel.');
  });

  it('throws error when resolved parent channel is not allowed under allowedChannelIds', async () => {
    const mockDmChannel = {
      id: 'dm-1',
      isTextBased: () => true,
      isDMBased: () => true,
      send: vi.fn(),
    };

    const config = {
      ...mockBaseConfig,
      allowedChannelIds: ['only-allowed-channel'],
      workflowParentChannelId: 'disallowed-parent',
    };

    const mockParentChannel = {
      id: 'disallowed-parent',
      isTextBased: () => true,
      isDMBased: () => false,
      threads: {},
      guildId: 'g1',
      send: vi.fn(),
    };

    const mockClient = {
      channels: {
        fetch: vi.fn().mockImplementation(async (id) => {
          if (id === 'dm-1') return mockDmChannel;
          if (id === 'disallowed-parent') return mockParentChannel;
          return null;
        }),
      },
      users: {
        fetch: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    await expect(
      createWorkflowThread(mockClient, config, '/tmp', {
        taskSummary: 'Test DM task',
        creatorUserId: 'owner-1',
        sourceChannelId: 'dm-1',
      })
    ).rejects.toThrow('Parent channel disallowed-parent is not writable or allowed under configured allowedChannelIds.');
  });
});
