import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from 'discord.js';
import type { Config } from '../src/shared/types.js';
import { resolveProcessingContext } from '../src/daemon/engine-cli.js';
import { saveThreadManifest, type ThreadManifest } from '../src/daemon/workflow/thread-manifest.js';
import { resetConversationSession } from '../src/daemon/session-reset.js';
import { runtimeStore } from '../src/daemon/runtime.js';

let tmpDir: string;

const baseConfig: Config = {
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
  memoryScope: 'channel',
  autoStartDaemon: true,
  useGeminiCliSessions: true,
  geminiSessionBindingScope: 'channel',
  cliIdleTimeoutMs: 300000,
  setupValidationPending: false,
  workflowParentChannelId: 'ch1',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-session-test-'));
  runtimeStore.cliPool = {
    kill: vi.fn(),
  } as any;
});

afterEach(() => {
  runtimeStore.cliPool = null;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('workflow session resolution', () => {
  it('resolves thread:threadId keys for Boss in a workflow thread', () => {
    // 1. Create a manifest for thread-1
    const manifest: ThreadManifest = {
      threadId: 'thread-1',
      parentChannelId: 'ch1',
      guildId: 'g1',
      creatorUserId: 'owner-1',
      starterMessageId: 'msg-1',
      createdAt: new Date().toISOString(),
      mode: 'monitored_workflow',
      taskSummary: 'Task 1',
      traceMode: 'compact',
      originContext: { type: 'channel', sourceChannelId: 'ch1' },
    };
    saveThreadManifest(tmpDir, manifest);

    // 2. Build message in thread-1 from Boss
    const message = {
      channelId: 'thread-1',
      guildId: 'g1',
      author: { id: 'owner-1', tag: 'Boss#0001' },
    } as unknown as Message;

    const accepted = {
      channelName: 'thread-name',
      guildName: 'Test Guild',
      trigger: 'channel',
      roleContext: {
        role: 'BOSS',
        senderDiscordId: 'owner-1',
        senderDisplayLabel: 'Boss#0001',
        bossLabel: 'the boss',
        bossConfigValid: true,
      },
    } as any;

    const context = resolveProcessingContext(baseConfig, message, accepted, tmpDir);

    expect(context.sessionKey).toBe('thread:thread-1');
    expect(context.bindingKey).toBe('thread:thread-1');
  });

  it('resolves standard guest-ephemeral keys for Guest in a workflow thread', () => {
    // 1. Create manifest
    const manifest: ThreadManifest = {
      threadId: 'thread-1',
      parentChannelId: 'ch1',
      guildId: 'g1',
      creatorUserId: 'owner-1',
      starterMessageId: 'msg-1',
      createdAt: new Date().toISOString(),
      mode: 'monitored_workflow',
      taskSummary: 'Task 1',
      traceMode: 'compact',
      originContext: { type: 'channel', sourceChannelId: 'ch1' },
    };
    saveThreadManifest(tmpDir, manifest);

    // 2. Build message from Guest
    const message = {
      id: 'msg-100',
      channelId: 'thread-1',
      guildId: 'g1',
      author: { id: 'guest-1', tag: 'Guest#9999' },
    } as unknown as Message;

    const accepted = {
      channelName: 'thread-name',
      guildName: 'Test Guild',
      trigger: 'channel',
      roleContext: {
        role: 'GUEST',
        senderDiscordId: 'guest-1',
        senderDisplayLabel: 'Guest#9999',
        bossLabel: 'the boss',
        bossConfigValid: true,
      },
    } as any;

    const context = resolveProcessingContext(baseConfig, message, accepted, tmpDir);

    expect(context.sessionKey).toBe('guest:guest-1:channel:thread-1:message:msg-100');
    expect(context.bindingKey).toBe('guest:guest-1:channel:thread-1:message:msg-100');
  });

  it('uses standard channel keys for non-workflow threads under allowed channels', () => {
    // thread-2 has NO manifest
    const message = {
      channelId: 'thread-2',
      guildId: 'g1',
      author: { id: 'owner-1', tag: 'Boss#0001' },
    } as unknown as Message;

    const accepted = {
      channelName: 'thread-name',
      guildName: 'Test Guild',
      trigger: 'channel',
      roleContext: {
        role: 'BOSS',
        senderDiscordId: 'owner-1',
        senderDisplayLabel: 'Boss#0001',
        bossLabel: 'the boss',
        bossConfigValid: true,
      },
    } as any;

    const context = resolveProcessingContext(baseConfig, message, accepted, tmpDir);

    // Because it is NOT a workflow thread, it uses the fallback key based on channel/thread id
    expect(context.sessionKey).toBe('channel:thread-2');
    expect(context.bindingKey).toBe('channel:thread-2');
  });

  it('resets the correct thread-scoped keys in resetConversationSession', () => {
    const memory = {
      archiveAndReset: vi.fn(),
    } as any;

    const result = resetConversationSession(baseConfig, memory, tmpDir, {
      channelId: 'ch1',
      guildId: 'g1',
      threadId: 'thread-1',
    });

    expect(result.sessionKey).toBe('thread:thread-1');
    expect(result.bindingKey).toBe('thread:thread-1');
    expect(memory.archiveAndReset).toHaveBeenCalledWith('thread:thread-1', {
      bindingKey: 'thread:thread-1',
      lastSessionId: undefined,
    });
    expect((runtimeStore.cliPool as any).kill).toHaveBeenCalledWith('thread:thread-1');
  });
});
