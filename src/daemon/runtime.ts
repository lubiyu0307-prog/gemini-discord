import type { Client, ThreadChannel } from 'discord.js';
import type { ConversationMemory } from './memory.js';
import type { ChannelQueue } from './queue.js';
import type { Semaphore } from './semaphore.js';
import type { CliProcessPool } from './cli-pool.js';
import type { RoleContext } from './permissions.js';

export interface WorkflowRuntimeRunRequest {
  thread: ThreadChannel;
  task: string;
  creatorUserId: string;
  sourceChannelId: string;
  sourceMessageId?: string;
  roleContext?: RoleContext;
}

export interface DaemonRuntime {
  client: Client | null;
  memory: ConversationMemory | null;
  queue: ChannelQueue | null;
  geminiSemaphore: Semaphore | null;
  cliPool: CliProcessPool | null;
  isShuttingDown: boolean;
  agentExchangeCount: Map<string, number>;
  lastInteractiveMessageAt: number | null;
  enqueueWorkflowRun: ((request: WorkflowRuntimeRunRequest) => boolean) | null;
}

export const runtimeStore: DaemonRuntime = {
  client: null,
  memory: null,
  queue: null,
  geminiSemaphore: null,
  cliPool: null,
  isShuttingDown: false,
  agentExchangeCount: new Map<string, number>(),
  lastInteractiveMessageAt: null,
  enqueueWorkflowRun: null,
};

export function getRuntime(): DaemonRuntime {
  return runtimeStore;
}
