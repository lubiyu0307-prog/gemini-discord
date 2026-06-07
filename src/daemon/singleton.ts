import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export interface DaemonSingletonLock {
  lockPath: string;
  release: () => void;
}

export interface DaemonPeerProcess {
  pid: number;
  command: string;
}

interface LockDeps {
  pid?: number;
  uid?: number | null;
  scope?: string;
  lockPath?: string;
  listPeerProcesses?: () => DaemonPeerProcess[];
}

const LOCK_PREFIX = 'gemini-discord-daemon';

export function acquireDaemonSingletonLock(deps: LockDeps = {}): DaemonSingletonLock {
  const pid = deps.pid ?? process.pid;
  const scope = deps.scope ?? 'default';
  const lockPath = deps.lockPath ?? defaultDaemonLockPath(scope, deps.uid ?? getProcessUid());
  const listPeerProcesses = deps.listPeerProcesses ?? (() => listSameUserDaemonProcesses(pid));

  const peers = listPeerProcesses().filter((peer) => peer.pid !== pid);
  if (peers.length > 0) {
    const peer = peers[0]!;
    throw new Error(`Another gemini-discord daemon may already be connected (pid ${peer.pid}: ${peer.command}). Stop it before starting this daemon.`);
  }

  return acquireLockFile(lockPath, pid);
}

export function defaultDaemonLockPath(scope = 'default', uid: number | null = getProcessUid()): string {
  const suffix = uid == null ? 'unknown' : String(uid);
  const safeScope = scope.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
  return path.join(os.tmpdir(), `${LOCK_PREFIX}-${safeScope}-${suffix}.lock`);
}

export function daemonSingletonScope(discordBotToken: string): string {
  const normalized = discordBotToken.trim();
  if (!normalized) {
    return 'missing-token';
  }
  return `token-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

export function listSameUserDaemonProcesses(currentPid = process.pid): DaemonPeerProcess[] {
  const uid = getProcessUid();
  if (uid == null) {
    return [];
  }

  let output = '';
  try {
    output = execFileSync('ps', ['-axo', 'pid=,uid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }

  return parseDaemonProcesses(output, uid, currentPid);
}

export function parseDaemonProcesses(psOutput: string, uid: number, currentPid: number): DaemonPeerProcess[] {
  const rows: DaemonPeerProcess[] = [];
  for (const line of psOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = Number(match[1]);
    const rowUid = Number(match[2]);
    const command = match[3] ?? '';
    if (!Number.isFinite(pid) || !Number.isFinite(rowUid) || pid === currentPid || rowUid !== uid) {
      continue;
    }

    if (isGeminiDiscordDaemonCommand(command)) {
      rows.push({ pid, command: command.trim() });
    }
  }

  return rows;
}

function acquireLockFile(lockPath: string, pid: number): DaemonSingletonLock {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, `${pid}\n`, 'utf8');
      } catch (err) {
        try { fs.closeSync(fd); } catch {}
        throw err;
      }
      return {
        lockPath,
        release: () => releaseLockFile(lockPath, fd, pid),
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (!removeStaleLock(lockPath)) {
        throw new Error(`Another gemini-discord daemon is already running (lock: ${lockPath}).`);
      }
    }
  }

  throw new Error(`Could not acquire gemini-discord daemon lock: ${lockPath}`);
}

function releaseLockFile(lockPath: string, fd: number, pid: number): void {
  try {
    fs.closeSync(fd);
  } catch {}

  try {
    const lockPid = fs.readFileSync(lockPath, 'utf8').trim();
    if (lockPid === String(pid)) {
      fs.unlinkSync(lockPath);
    }
  } catch {}
}

function removeStaleLock(lockPath: string): boolean {
  let lockPid: number | null = null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    lockPid = raw ? Number(raw) : null;
  } catch {
    return false;
  }

  if (lockPid && Number.isFinite(lockPid) && isProcessAlive(lockPid)) {
    return false;
  }

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function isGeminiDiscordDaemonCommand(command: string): boolean {
  return command.includes('gemini-discord')
    && command.includes('dist/daemon.cjs')
    && !command.includes('dist/server.cjs');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST');
}
