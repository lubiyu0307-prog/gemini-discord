import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Client } from 'discord.js';
import type { Config, DmPairingSnapshot } from '../shared/types.js';
import { ensureRuntimePaths, resolveRuntimePaths } from '../shared/runtime-paths.js';
import { log } from './log.js';

interface StoredDmPairing {
  userId: string;
  channelId: string;
  pairedAt: string;
  lastSeenAt: string;
}

interface DmPairingFile {
  version: 1;
  pairings: StoredDmPairing[];
}

function pairingsPath(extensionDir: string): string {
  return resolveRuntimePaths(extensionDir).dmPairingsFile;
}

const pairingsCacheMap = new Map<string, Map<string, StoredDmPairing>>();

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadPairingMap(extensionDir: string): Map<string, StoredDmPairing> {
  let cache = pairingsCacheMap.get(extensionDir);
  if (cache) {
    return cache;
  }
  const filePath = pairingsPath(extensionDir);
  try {
    if (!fs.existsSync(filePath)) {
      cache = new Map();
      pairingsCacheMap.set(extensionDir, cache);
      return cache;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<DmPairingFile>;
    const pairings = Array.isArray(parsed.pairings) ? parsed.pairings : [];
    cache = new Map(
      pairings
        .filter((entry): entry is StoredDmPairing => Boolean(entry && typeof entry.userId === 'string' && typeof entry.channelId === 'string'))
        .map((entry) => [entry.userId, entry]),
    );
    pairingsCacheMap.set(extensionDir, cache);
    return cache;
  } catch {
    cache = new Map();
    pairingsCacheMap.set(extensionDir, cache);
    return cache;
  }
}

function savePairingMap(extensionDir: string, pairings: Map<string, StoredDmPairing>): void {
  pairingsCacheMap.set(extensionDir, pairings);
  const filePath = pairingsPath(extensionDir);
  ensureParentDir(filePath);
  const payload: DmPairingFile = {
    version: 1,
    pairings: [...pairings.values()].sort((left, right) => left.userId.localeCompare(right.userId)),
  };
  fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 })
    .catch((err) => {
      log.error('Failed to save DM pairing map asynchronously', { error: err });
    });
}

export function resolveDmPairingKey(userId: string): string {
  return `dm:${userId}`;
}

export function touchDmPairing(extensionDir: string, userId: string, channelId: string): StoredDmPairing {
  const pairings = loadPairingMap(extensionDir);
  const now = new Date().toISOString();
  const existing = pairings.get(userId);
  const next: StoredDmPairing = {
    userId,
    channelId,
    pairedAt: existing?.pairedAt ?? now,
    lastSeenAt: now,
  };
  pairings.set(userId, next);
  savePairingMap(extensionDir, pairings);
  return next;
}

export function listDmPairings(extensionDir: string): DmPairingSnapshot[] {
  return [...loadPairingMap(extensionDir).values()]
    .sort((left, right) => left.userId.localeCompare(right.userId))
    .map((entry) => ({
      userId: entry.userId,
      channelId: entry.channelId,
      pairedAt: entry.pairedAt,
      lastSeenAt: entry.lastSeenAt,
    }));
}

export function resolveDmUserIdForChannel(extensionDir: string, channelId: string): string | null {
  for (const pairing of loadPairingMap(extensionDir).values()) {
    if (pairing.channelId === channelId) {
      return pairing.userId;
    }
  }
  return null;
}

export async function ensureOwnerDmPairings(client: Client, config: Config, extensionDir: string): Promise<void> {
  ensureRuntimePaths(extensionDir);
  if (!config.enableDMs) {
    return;
  }

  const userIds = [...new Set([...config.ownerIds, ...config.allowedUserIds])];
  for (const userId of userIds) {
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const pairing = touchDmPairing(extensionDir, userId, dm.id);
      log.info('DM pairing ready', pairing);
    } catch (error) {
      log.warn('Failed to bootstrap DM pairing', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
