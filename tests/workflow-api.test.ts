import { describe, expect, it, vi, afterEach } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startControlApi } from '../src/daemon/api.js';
import { createConfig } from './test-utils/factories.js';

// We need to mock daemonRequest for the tool test
vi.mock('../src/tools/client.js', () => ({
  daemonRequest: vi.fn(),
}));

import { daemonRequest } from '../src/tools/client.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAdminTool } from '../src/tools/admin.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Workflow API', () => {
  it('creates a workflow thread through the /workflow route', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-workflow-api-'));
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
      discordChannelId: 'channel-1',
      discordServerId: 'guild-1',
    });

    const mockThread = {
      id: 'thread-123',
      send: vi.fn().mockResolvedValue({ id: 'seed-msg' }),
    };

    const mockChannel = {
      id: 'channel-1',
      isTextBased: () => true,
      isDMBased: () => false,
      send: vi.fn(),
      threads: {
        create: vi.fn().mockResolvedValue(mockThread),
      },
      guildId: 'guild-1',
    };

    const client = {
      user: { id: 'bot-user', tag: 'Bot#0001' },
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel),
      },
    };

    const server = startControlApi({
      config,
      state: { status: 'ready' } as any,
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      
      const response = await fetch(`http://127.0.0.1:${port}/workflow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.daemonApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'Fix the job',
          creator_user_id: '111111111111111111',
          source_channel_id: 'channel-1',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        ok: true,
        threadId: 'thread-123',
        task: 'Fix the job',
      });

      expect(client.channels.fetch).toHaveBeenCalledWith('channel-1');
      expect(mockChannel.threads.create).toHaveBeenCalledWith({
        name: 'gemini-workflow-fix-the-job',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails if required fields are missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-workflow-api-fail-'));
    const config = createConfig({ daemonPort: 0 });
    const server = startControlApi({
      config,
      state: { status: 'ready' } as any,
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: {} as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      
      const response = await fetch(`http://127.0.0.1:${port}/workflow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.daemonApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'Missing fields',
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('required'),
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Admin Tool Workflow Action', () => {
  it('triggers a workflow creation through the admin tool', async () => {
    const config = createConfig({
      discordBossUserId: '111111111111111111',
      discordChannelId: 'channel-1',
    });

    let handler: any;
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    vi.spyOn(server, 'tool').mockImplementation((name, desc, schema, h) => {
      if (name === 'discord_admin') handler = h;
    });

    registerAdminTool(server, config);

    (daemonRequest as any).mockResolvedValue({
      ok: true,
      data: { threadId: 'thread-456' },
    });

    const result = await handler({
      action: 'workflow',
      task: 'Tool task',
    });

    expect(daemonRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflow',
      config,
      body: {
        task: 'Tool task',
        creator_user_id: '111111111111111111',
        source_channel_id: 'channel-1',
      },
    });

    expect(result.content[0].text).toContain('thread-456');
    expect(result.content[0].text).toContain('Tool task');
  });
});
