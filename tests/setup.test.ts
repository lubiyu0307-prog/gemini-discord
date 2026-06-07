import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSetupEnv,
  promptForSetupInput,
  validateSetupInput,
  writeSetupConfig,
} from '../scripts/setup.js';
import { readManagedConfigFile } from '../src/shared/managed-config.js';
import { resolveRuntimePaths } from '../src/shared/runtime-paths.js';
import { loadConfig } from '../src/shared/config.js';
import { ENV } from '../src/shared/config-vars.js';

describe('setup script helpers', () => {
  it('prompts for exactly the three required setup inputs', async () => {
    const prompts: string[] = [];
    const answers = ['token', '123456789012345', '234567890123456'];

    const result = await promptForSetupInput({
      question: async (prompt: string) => {
        prompts.push(prompt);
        return answers[prompts.length - 1];
      },
    } as any);

    expect(prompts).toEqual(['Bot Token: ', 'Boss User ID: ', 'Server ID: ']);
    expect(result).toEqual({
      botToken: 'token',
      userId: '123456789012345',
      serverId: '234567890123456',
    });
  });

  it('builds managed setup env without channel or env-file writes', () => {
    const env = buildSetupEnv({
      botToken: 'token',
      userId: '123456789012345',
      serverId: '234567890123456',
    });

    expect(env).toMatchObject({
      [ENV.DISCORD_BOT_TOKEN]: 'token',
      [ENV.DISCORD_BOSS_USER_ID]: '123456789012345',
      [ENV.DISCORD_OWNER_IDS]: '123456789012345',
      [ENV.DISCORD_ADMIN_ID]: '123456789012345',
      [ENV.DISCORD_SERVER_ID]: '234567890123456',
      [ENV.SETUP_VALIDATION_PENDING]: 'true',
      [ENV.REQUIRE_MENTION]: 'true',
    });
    expect(env).not.toHaveProperty(ENV.DISCORD_ALLOWED_USER_IDS);
    expect(env).not.toHaveProperty(ENV.DISCORD_CHANNEL_ID);
  });

  it('rejects missing token or malformed Discord ids without reprompting', () => {
    expect(() => validateSetupInput({
      botToken: '',
      userId: '123456789012345',
      serverId: '234567890123456',
    })).toThrow(/Bot Token/);

    expect(() => validateSetupInput({
      botToken: 'token',
      userId: 'not-a-user-id',
      serverId: '234567890123456',
    })).toThrow(/User ID/);
  });

  it('writes ignored managed config and clears stale channel pinning', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-setup-'));

    try {
      writeSetupConfig(tmpDir, {
        botToken: 'token',
        userId: '123456789012345',
        serverId: '234567890123456',
      });

      const config = readManagedConfigFile(resolveRuntimePaths(tmpDir).managedConfigFile);
      expect(config.env[ENV.DISCORD_BOT_TOKEN]).toBe('token');
      expect(config.env[ENV.DISCORD_BOSS_USER_ID]).toBe('123456789012345');
      expect(config.env[ENV.DISCORD_SERVER_ID]).toBe('234567890123456');
      expect(config.env[ENV.DISCORD_CHANNEL_ID]).toBeUndefined();
      expect(config.env[ENV.REQUIRE_MENTION]).toBe('true');
      expect(config.discord.primaryGuildId).toBe('234567890123456');
      expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('installer persistence regression', () => {
  it('round-trips writeSetupConfig through loadConfig with derived values', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-persist-'));

    try {
      writeSetupConfig(tmpDir, {
        botToken: 'persist-token',
        userId: '111111111111111111',
        serverId: '222222222222222222',
      });

      const config = loadConfig(tmpDir);
      expect(config.discordBotToken).toBe('persist-token');
      expect(config.discordBossUserId).toBe('111111111111111111');
      expect(config.discordServerId).toBe('222222222222222222');
      // Owner IDs derived from boss via buildSetupEnv
      expect(config.ownerIds).toContain('111111111111111111');
      // Admin ID derived from owner IDs (which is the boss)
      expect(config.discordAdminId).toBe('111111111111111111');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not create .env during writeSetupConfig', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-noenv-'));

    try {
      writeSetupConfig(tmpDir, {
        botToken: 'no-env-token',
        userId: '111111111111111111',
        serverId: '222222222222222222',
      });

      expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(false);
      // But managed config exists
      expect(fs.existsSync(resolveRuntimePaths(tmpDir).managedConfigFile)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads a fresh extension-style config with only the three install keys', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-minimal-'));

    try {
      // Simulate what the Gemini CLI extension host does: sets only the
      // INSTALL_SETTING_ENV_KEYS via gemini-extension.json settings.
      const runtimePaths = resolveRuntimePaths(tmpDir);
      fs.mkdirSync(path.dirname(runtimePaths.managedConfigFile), { recursive: true });
      fs.writeFileSync(runtimePaths.managedConfigFile, JSON.stringify({
        version: 2,
        updatedAt: new Date().toISOString(),
        env: {
          [ENV.DISCORD_BOT_TOKEN]: 'ext-token',
          [ENV.DISCORD_BOSS_USER_ID]: '333333333333333333',
          [ENV.DISCORD_SERVER_ID]: '444444444444444444',
        },
        discord: {},
      }));

      const config = loadConfig(tmpDir);
      expect(config.discordBotToken).toBe('ext-token');
      expect(config.discordBossUserId).toBe('333333333333333333');
      expect(config.discordServerId).toBe('444444444444444444');
      // Owner IDs derived from boss since DISCORD_OWNER_IDS is absent
      expect(config.ownerIds).toEqual(['333333333333333333']);
      // Admin ID derived from derived owner IDs
      expect(config.discordAdminId).toBe('333333333333333333');
      // Guests default false
      expect(config.enableGuests).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails to read values that were prompted but never saved', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-nosave-'));

    try {
      // Simulate promptForSetupInput returning values but writeSetupConfig
      // never being called — the config should NOT contain those values.
      const config = loadConfig(tmpDir);
      expect(config.discordBotToken).toBe('');
      expect(config.discordBossUserId).toBe('');
      expect(config.discordServerId).toBe('');
      expect(config.ownerIds).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
