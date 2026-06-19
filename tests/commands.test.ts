import { afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { 
  COMMANDS, 
  buildGuildCommandPayloads, 
  buildDmOnlyGlobalCommandPayloads,
  setupInteractionHandler,
} from '../src/daemon/commands.js';
import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { createConfig } from './test-utils/factories.js';
import { runtimeStore } from '../src/daemon/runtime.js';

afterEach(() => {
  spawnMock.mockReset();
  runtimeStore.cliPool = null;
});

describe('Slash Command Registration', () => {
  it('buildDmOnlyGlobalCommandPayloads meets strict DM requirements', () => {
    const globalPayloads = buildDmOnlyGlobalCommandPayloads();
    
    // Only includes approved DM commands
    const expectedNames = new Set(['new', 'model', 'status', 'ping', 'pool', 'kill', 'workflow']);
    expect(globalPayloads.length).toBe(expectedNames.size);
    
    globalPayloads.forEach(cmd => {
      expect(expectedNames.has(cmd.name)).toBe(true);
      expect(cmd.contexts).toEqual([InteractionContextType.BotDM]);
      expect(cmd.contexts).not.toContain(InteractionContextType.Guild);
      expect(cmd.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    });
  });

  it('buildGuildCommandPayloads is clean of contexts and integration_types', () => {
    const guildPayloads = buildGuildCommandPayloads();
    expect(guildPayloads.length).toBe(COMMANDS.length);
    
    guildPayloads.forEach(cmd => {
      expect(cmd).not.toHaveProperty('contexts');
      expect(cmd).not.toHaveProperty('integration_types');
    });
  });

  it('suppresses mentions on slash workflow validation replies', async () => {
    let interactionHandler: ((interaction: any) => Promise<void>) | undefined;
    const client = {
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'interactionCreate') {
          interactionHandler = handler;
        }
      }),
    };
    const config = createConfig({
      discordBossUserId: '111111111111111111',
      ownerIds: ['111111111111111111'],
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      commandName: 'workflow',
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: '111111111111111111', tag: 'Boss#0001' },
      options: {
        getString: vi.fn((name: string) => name === 'task' ? 'job' : null),
      },
      reply,
    };

    setupInteractionHandler(
      client as any,
      config,
      { startedAt: new Date(0).toISOString() } as any,
      {} as any,
      'unused-extension-dir',
    );

    await interactionHandler!(interaction);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('too vague'),
      ephemeral: true,
      allowedMentions: { parse: [], repliedUser: false },
    }));
  });

  it('supports autocomplete filtering using config.geminiAvailableModels', async () => {
    let interactionHandler: ((interaction: any) => Promise<void>) | undefined;
    const client = {
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'interactionCreate') {
          interactionHandler = handler;
        }
      }),
    };
    const config = createConfig({
      geminiAvailableModels: ['custom-model-a', 'custom-model-b'],
    });
    const respond = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isAutocomplete: () => true,
      isChatInputCommand: () => false,
      options: {
        getFocused: () => 'custom-model',
      },
      respond,
    };

    setupInteractionHandler(
      client as any,
      config,
      {} as any,
      {} as any,
      'unused-extension-dir',
    );

    await interactionHandler!(interaction);

    expect(respond).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'custom-model-a', value: 'custom-model-a' }),
      expect.objectContaining({ name: 'custom-model-b', value: 'custom-model-b' }),
    ]));
  });

  it('includes built-in model aliases alongside custom autocomplete suggestions', async () => {
    let interactionHandler: ((interaction: any) => Promise<void>) | undefined;
    const client = {
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'interactionCreate') {
          interactionHandler = handler;
        }
      }),
    };
    const config = createConfig({
      geminiAvailableModels: ['custom-model-a'],
    });
    const respond = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isAutocomplete: () => true,
      isChatInputCommand: () => false,
      options: {
        getFocused: () => '',
      },
      respond,
    };

    setupInteractionHandler(
      client as any,
      config,
      {} as any,
      {} as any,
      'unused-extension-dir',
    );

    await interactionHandler!(interaction);

    expect(respond).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'auto', value: 'auto' }),
      expect.objectContaining({ name: 'pro', value: 'pro' }),
      expect.objectContaining({ name: 'flash', value: 'flash' }),
      expect.objectContaining({ name: 'flash-lite', value: 'flash-lite' }),
      expect.objectContaining({ name: 'gemini-3.5-flash', value: 'gemini-3.5-flash' }),
      expect.objectContaining({ name: 'gemini-3.1-flash-lite', value: 'gemini-3.1-flash-lite' }),
      expect.objectContaining({ name: 'custom-model-a', value: 'custom-model-a' }),
    ]));
  });

  it('rejects model switches while the CLI pool is busy', async () => {
    let interactionHandler: ((interaction: any) => Promise<void>) | undefined;
    const client = {
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'interactionCreate') {
          interactionHandler = handler;
        }
      }),
    };
    const config = createConfig({ geminiModel: 'auto' });
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const killAll = vi.fn();
    runtimeStore.cliPool = {
      status: () => ({ total: 1, busy: 1, idle: 0, maxSize: 3, processes: [] }),
      killAll,
    } as any;

    setupInteractionHandler(
      client as any,
      config,
      {} as any,
      {} as any,
      'unused-extension-dir',
    );

    await interactionHandler!(createModelInteraction({
      model: 'gemini-3.5-flash',
      reply,
      deferReply,
    }));

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Gemini is busy'),
      ephemeral: true,
    }));
    expect(deferReply).not.toHaveBeenCalled();
    expect(killAll).not.toHaveBeenCalled();
    expect(config.geminiModel).toBe('auto');
  });

  it('persists an idle model switch before updating runtime config and recycling the pool', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-model-'));
    try {
      let interactionHandler: ((interaction: any) => Promise<void>) | undefined;
      const client = {
        on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
          if (event === 'interactionCreate') {
            interactionHandler = handler;
          }
        }),
      };
      const config = createConfig({ geminiModel: 'auto' });
      fs.writeFileSync(path.join(tmpDir, '.env'), 'GEMINI_MODEL=auto\n');
      const deferReply = vi.fn().mockResolvedValue(undefined);
      const editReply = vi.fn().mockResolvedValue(undefined);
      const killAll = vi.fn(() => {
        expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')).toContain('GEMINI_MODEL=custom-model-a');
        expect(config.geminiModel).toBe('custom-model-a');
      });
      runtimeStore.cliPool = {
        status: () => ({ total: 1, busy: 0, idle: 1, maxSize: 3, processes: [] }),
        killAll,
      } as any;

      setupInteractionHandler(
        client as any,
        config,
        {} as any,
        {} as any,
        tmpDir,
      );

      await interactionHandler!(createModelInteraction({
        model: 'custom-model-a',
        deferReply,
        editReply,
      }));

      expect(spawnMock).not.toHaveBeenCalled();
      expect(deferReply).toHaveBeenCalledTimes(1);
      expect(killAll).toHaveBeenCalledTimes(1);
      expect(editReply).toHaveBeenCalledWith(expect.stringContaining('next turn will start'));
      expect(config.geminiModel).toBe('custom-model-a');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function createModelInteraction(overrides: {
  model: string;
  reply?: ReturnType<typeof vi.fn>;
  deferReply?: ReturnType<typeof vi.fn>;
  editReply?: ReturnType<typeof vi.fn>;
}) {
  return {
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    commandName: 'model',
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: '111111111111111111', tag: 'Boss#0001' },
    options: {
      getString: vi.fn(() => overrides.model),
    },
    reply: overrides.reply ?? vi.fn().mockResolvedValue(undefined),
    deferReply: overrides.deferReply ?? vi.fn().mockResolvedValue(undefined),
    editReply: overrides.editReply ?? vi.fn().mockResolvedValue(undefined),
  };
}
