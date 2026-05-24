import { describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startControlApi, type DaemonState } from '../src/daemon/api.js';
import { createConfig } from './test-utils/factories.js';

describe('control API thread creation', () => {
  it('allows the boss to create a thread from a message', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-thread-'));
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    const channel = {
      id: 'channel-1',
      isTextBased: () => true,
      send: vi.fn(),
      messages: {
        fetch: vi.fn().mockResolvedValue({
          id: 'message-1',
          startThread,
        }),
      },
    };
    const client = {
      user: { id: 'bot-user', tag: 'Bot#0001' },
      channels: {
        fetch: vi.fn().mockResolvedValue(channel),
      },
    };
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
      allowedChannelIds: ['channel-1'],
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: { add: vi.fn() } as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/thread`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          channel_id: 'channel-1',
          message_id: 'message-1',
          name: 'GO',
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ ok: true, threadId: 'thread-1' });
      expect(startThread).toHaveBeenCalledWith({ name: 'GO' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('allows the boss to create a thread in a channel', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-thread-channel-'));
    const create = vi.fn().mockResolvedValue({ id: 'thread-2' });
    const channel = {
      id: 'channel-1',
      isTextBased: () => true,
      send: vi.fn(),
      threads: { create },
    };
    const client = {
      user: { id: 'bot-user', tag: 'Bot#0001' },
      channels: {
        fetch: vi.fn().mockResolvedValue(channel),
      },
    };
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
      allowedChannelIds: ['channel-1'],
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: { add: vi.fn() } as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/thread`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          channel_id: 'channel-1',
          name: 'NEW THREAD',
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ ok: true, threadId: 'thread-2' });
      expect(create).toHaveBeenCalledWith({ name: 'NEW THREAD' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('denies thread creation for guests', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-thread-guest-'));
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: null,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/thread`, {
        method: 'POST',
        headers: guestHeaders(config.daemonApiToken),
        body: JSON.stringify({
          channel_id: 'channel-1',
          name: 'GUEST THREAD',
        }),
      });

      expect(response.status).toBe(403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects native thread creation outside allowed channels', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-thread-disallowed-'));
    const create = vi.fn().mockResolvedValue({ id: 'thread-3' });
    const channel = {
      id: 'channel-3',
      guildId: 'guild-1',
      isTextBased: () => true,
      send: vi.fn(),
      threads: { create },
    };
    const client = {
      user: { id: 'bot-user', tag: 'Bot#0001' },
      channels: {
        fetch: vi.fn().mockResolvedValue(channel),
      },
    };
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
      allowedChannelIds: ['channel-1'],
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: { add: vi.fn() } as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/thread`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          channel_id: 'channel-3',
          name: 'NOPE',
        }),
      });

      expect(response.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function createState(bridgeAdminUserId: string | null = 'bot-user'): DaemonState {
  return {
    status: 'ready',
    startedAt: new Date(0).toISOString(),
    geminiReachable: true,
    geminiVersion: 'test',
    messagesHandled: 0,
    lastMessageAt: null,
    lastError: null,
    exchangeLog: [],
    bridgeAdminUserId,
    bridgeAdminTag: 'Bot#0001',
  };
}

function bossHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Gemini-Discord-Role': 'BOSS',
    'X-Gemini-Discord-Sender-Id': '111111111111111111',
    'X-Gemini-Discord-Sender-Label': 'Authorized#0001',
  };
}

function guestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Gemini-Discord-Role': 'GUEST',
    'X-Gemini-Discord-Sender-Id': '222222222222222222',
    'X-Gemini-Discord-Sender-Label': 'Guest#0001',
  };
}
