import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  saveThreadManifest,
  loadThreadManifest,
  isWorkflowThread,
  listWorkflowThreads,
  type ThreadManifest,
} from '../src/daemon/workflow/thread-manifest.js';

describe('thread manifest persistence', () => {
  it('saves, loads, checks and lists thread manifests correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-manifest-'));

    try {
      const manifest: ThreadManifest = {
        threadId: 'thread_123',
        parentChannelId: 'channel_abc',
        guildId: 'guild_xyz',
        creatorUserId: 'user_boss',
        starterMessageId: 'msg_999',
        createdAt: new Date().toISOString(),
        mode: 'monitored_workflow',
        taskSummary: 'Implement login page',
        traceMode: 'compact',
        originContext: {
          type: 'channel',
          sourceChannelId: 'channel_abc',
        },
      };

      expect(isWorkflowThread(tmpDir, 'thread_123')).toBe(false);
      expect(loadThreadManifest(tmpDir, 'thread_123')).toBeNull();

      saveThreadManifest(tmpDir, manifest);

      expect(isWorkflowThread(tmpDir, 'thread_123')).toBe(true);
      const loaded = loadThreadManifest(tmpDir, 'thread_123');
      expect(loaded).toEqual(manifest);

      const list = listWorkflowThreads(tmpDir);
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual(manifest);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
