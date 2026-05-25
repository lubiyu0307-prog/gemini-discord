import { describe, it, expect, vi } from 'vitest';
import { 
  COMMANDS, 
  buildGuildCommandPayloads, 
  buildDmOnlyGlobalCommandPayloads 
} from '../src/daemon/commands.js';
import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';

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
});
