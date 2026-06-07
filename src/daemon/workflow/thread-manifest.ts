import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ThreadManifest {
  threadId: string;
  parentChannelId: string;
  guildId: string;
  creatorUserId: string;
  starterMessageId: string | null;
  createdAt: string;
  mode: 'monitored_workflow';
  taskSummary: string;
  traceMode: 'compact' | 'verbose';
  originContext: {
    type: 'channel' | 'dm';
    sourceChannelId: string;
    sourceMessageId?: string;
  };
}

function getManifestDir(extensionDir: string): string {
  return path.join(extensionDir, 'threads');
}

function getManifestPath(extensionDir: string, threadId: string): string {
  return path.join(getManifestDir(extensionDir), `${threadId}.json`);
}

export function saveThreadManifest(extensionDir: string, manifest: ThreadManifest): void {
  const dir = getManifestDir(extensionDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = getManifestPath(extensionDir, manifest.threadId);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf8');
}

export function loadThreadManifest(extensionDir: string, threadId: string): ThreadManifest | null {
  const filePath = getManifestPath(extensionDir, threadId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data) as ThreadManifest;
  } catch {
    return null;
  }
}

export function isWorkflowThread(extensionDir: string, threadId: string): boolean {
  return fs.existsSync(getManifestPath(extensionDir, threadId));
}

export function listWorkflowThreads(extensionDir: string): ThreadManifest[] {
  const dir = getManifestDir(extensionDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  try {
    const files = fs.readdirSync(dir);
    const manifests: ThreadManifest[] = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const threadId = path.basename(file, '.json');
        const manifest = loadThreadManifest(extensionDir, threadId);
        if (manifest) {
          manifests.push(manifest);
        }
      }
    }
    return manifests;
  } catch {
    return [];
  }
}
