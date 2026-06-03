import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Client } from 'discord.js';
import { initCron, listJobs, scheduleJob, scheduleReminder, shutdownCron } from '../src/daemon/cron.js';
import type { Config } from '../src/shared/types.js';

let tmpDir: string;

describe('cron jobs', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cron-'));
    initCron(createConfig(), {} as Client, tmpDir);
  });

  afterEach(() => {
    shutdownCron();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores the final reminder message instead of a meta instruction and defaults to run-once', () => {
    scheduleJob({
      cronExpression: '0 9 * * *',
      message: 'Update: drink water.',
      channelId: '123',
      authorId: 'owner',
    });

    const [job] = listJobs();
    expect(job.message).toBe('Update: drink water.');
    expect(job.runOnce).toBe(true);
  });

  it('supports simple delay-based reminders without requiring raw cron syntax', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T10:00:00.000Z'));

    scheduleReminder({
      message: 'Reminder: stretch now.',
      channelId: '123',
      authorId: 'owner',
      delayMinutes: 15,
    });

    const [job] = listJobs();
    expect(job.message).toBe('Reminder: stretch now.');
    expect(job.runOnce).toBe(true);
    expect(job.cronExpression).toBe('once:2026-05-01T10:15:00.000Z');
    expect(job.nextRun).toBe(new Date('2026-05-01T10:15:00.000Z').getTime());
  });

  it('prevents overlapping runs of the same job', async () => {
    vi.useFakeTimers();
    let resolveSend: any;
    const mockSend = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveSend = resolve;
    }));
    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send: mockSend,
        }),
      },
    } as any;

    initCron(createConfig(), mockClient, tmpDir);

    scheduleReminder({
      message: 'Slow job',
      channelId: '123',
      authorId: 'owner',
      delayMinutes: 1,
    });

    const [job] = listJobs();
    job.nextRun = Date.now() - 1000;

    // Trigger checkJobs by advancing timer by 60s
    await vi.advanceTimersByTimeAsync(60_000);

    // mockSend should have been called once
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Trigger checkJobs again while first is still running
    await vi.advanceTimersByTimeAsync(60_000);

    // mockSend should STILL only have been called once because of the lock
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Resolve the send call
    resolveSend();
    // Allow promises to resolve
    await vi.advanceTimersByTimeAsync(0);
  });

  it('decrements attempts on failed delivery and deletes after attempts expire', async () => {
    vi.useFakeTimers();
    const mockClient = {
      channels: {
        fetch: vi.fn().mockRejectedValue(new Error('Channel deleted')),
      },
    } as any;

    initCron(createConfig(), mockClient, tmpDir);

    scheduleReminder({
      message: 'Broken channel job',
      channelId: '999',
      authorId: 'owner',
      delayMinutes: 1,
    });

    const [job] = listJobs();
    job.nextRun = Date.now() - 1000;
    job.attempts = 3; // set to 3 for faster test

    // Run 1: fails, reschedules (attempts becomes 2)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listJobs().length).toBe(1);
    expect(listJobs()[0].attempts).toBe(2);

    // Move nextRun back to trigger it again
    listJobs()[0].nextRun = Date.now() - 1000;

    // Run 2: fails, reschedules (attempts becomes 1)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listJobs().length).toBe(1);
    expect(listJobs()[0].attempts).toBe(1);

    // Move nextRun back to trigger it again
    listJobs()[0].nextRun = Date.now() - 1000;

    // Run 3: fails, discards (attempts becomes 0/deleted)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listJobs().length).toBe(0);
  });
});

function createConfig(): Config {
  return {
    discordBotToken: '',
    discordChannelId: '123',
    workflowParentChannelId: '',
    discordServerId: '',
    discordServerName: '',
    discordBossUserId: '111111111111111111',
    ownerIds: [],
    discordAdminId: 'owner',
    allowedChannelIds: ['123'],
    allowedUserIds: [],
    allowedAgentIds: [],
    daemonApiToken: '',
    discordPrefix: '!',
    discordResetCmd: '!reset',
    daemonPort: 0,
    geminiPath: 'gemini',
    geminiModel: 'gemini-3.1-flash-lite-preview',
    geminiTimeoutMs: 0,
    geminiMaxConcurrent: 1,
    conversationHistoryLength: 1,
    promptHistoryMessageLimit: 1,
    promptHistoryCharBudget: 1,
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
    cliIdleTimeoutMs: 1,
    setupValidationPending: false,
  };
}
