import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  acquireDaemonSingletonLock,
  daemonSingletonScope,
  defaultDaemonLockPath,
  parseDaemonProcesses,
} from '../src/daemon/singleton.js';

describe('daemon singleton guard', () => {
  it('uses a token-scoped per-user lock path outside extension installs', () => {
    expect(defaultDaemonLockPath('token-abc123', 501)).toBe(path.join(os.tmpdir(), 'gemini-discord-daemon-token-abc123-501.lock'));
  });

  it('derives a stable non-secret singleton scope from the Discord bot token', () => {
    const scope = daemonSingletonScope('token-value');

    expect(scope).toMatch(/^token-[a-f0-9]{16}$/);
    expect(scope).toBe(daemonSingletonScope(' token-value '));
    expect(scope).not.toContain('token-value');
  });

  it('detects same-user gemini-discord daemon processes from ps output', () => {
    const output = [
      ' 101 501 /opt/homebrew/bin/node /Users/yamato/.gemini/extensions/gemini-discord/dist/daemon.cjs',
      ' 102 501 /opt/homebrew/bin/node /Users/yamato/yamato-samurai-sanctum/samurai-armory/tools/gemini-discord/dist/server.cjs',
      ' 103 502 /opt/homebrew/bin/node /Users/suyog/.gemini/extensions/gemini-discord/dist/daemon.cjs',
      ' 104 501 /opt/homebrew/bin/node /Users/yamato/yamato-samurai-sanctum/samurai-armory/tools/gemini-discord/dist/daemon.cjs',
    ].join('\n');

    expect(parseDaemonProcesses(output, 501, 104)).toEqual([
      {
        pid: 101,
        command: '/opt/homebrew/bin/node /Users/yamato/.gemini/extensions/gemini-discord/dist/daemon.cjs',
      },
    ]);
  });

  it('fails fast when another legacy same-user daemon is already running', () => {
    expect(() => acquireDaemonSingletonLock({
      pid: 200,
      listPeerProcesses: () => [{ pid: 101, command: 'node /Users/yamato/.gemini/extensions/gemini-discord/dist/daemon.cjs' }],
      lockPath: path.join(os.tmpdir(), `gemini-discord-singleton-${process.pid}-blocked.lock`),
    })).toThrow('Another gemini-discord daemon may already be connected');
  });

  it('reclaims stale lock files and releases owned locks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-singleton-'));
    const lockPath = path.join(dir, 'daemon.lock');

    try {
      fs.writeFileSync(lockPath, '999999999\n', 'utf8');
      const lock = acquireDaemonSingletonLock({
        pid: 12345,
        lockPath,
        listPeerProcesses: () => [],
      });

      expect(fs.readFileSync(lockPath, 'utf8')).toBe('12345\n');
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
