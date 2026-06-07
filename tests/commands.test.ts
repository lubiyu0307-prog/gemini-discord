import { describe, it, expect, vi } from 'vitest';
import { 
  COMMANDS, 
  buildGuildCommandPayloads, 
  buildDmOnlyGlobalCommandPayloads,
  setupInteractionHandler,
} from '../src/daemon/commands.js';
import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { createConfig } from './test-utils/factories.js';

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
});
