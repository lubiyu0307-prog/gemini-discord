import type { TextChannel, ThreadChannel, Message } from 'discord.js';
import type { TraceEvent } from './trace-event.js';
import { TraceRendererRegistry } from './trace-renderer.js';
import type { ThreadManifest } from './thread-manifest.js';
import { log } from '../log.js';
import { SUPPRESS_DISCORD_MENTIONS } from '../mention-safety.js';

export class TraceDispatcher {
  private activeMessages = new Map<string, Message>();
  private headerMessage: Message | null = null;
  private startedAt = Date.now();
  private toolCallCount = 0;
  private currentStep: string | null = null;
  private seenToolCallIds = new Set<string>();
  private hasTraceEvents = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackCounters = new Map<string, number>();
  private lastEditTimes = new Map<string, number>();
  private logicalToolCallIds = new Map<string, string>();
  private renderedTopic = false;
  private topicMessage: Message | null = null;

  constructor(
    private threadChannel: ThreadChannel | TextChannel,
    private registry: TraceRendererRegistry,
  ) {}

  private getEffectiveToolCallId(event: TraceEvent): string | null {
    const id = resolveToolCallId(event);
    const logicalKey = resolveLogicalToolKey(event);
    if (logicalKey) {
      const existing = this.logicalToolCallIds.get(logicalKey);
      if (existing) return existing;
      if (id) {
        this.logicalToolCallIds.set(logicalKey, id);
        return id;
      }
    } else if (id) {
      return id;
    }
    if (!event.canonicalToolName) return null;

    const baseKey = logicalKey ?? `fallback:${event.canonicalToolName}`;
    if (!this.fallbackCounters.has(baseKey)) {
      this.fallbackCounters.set(baseKey, 1);
    }
    let count = this.fallbackCounters.get(baseKey)!;
    if (event.status === 'started' || event.type === 'tool_started') {
      if (this.activeMessages.has(`${baseKey}:${count}`)) {
        count += 1;
        this.fallbackCounters.set(baseKey, count);
      }
    }
    const fallbackId = `${baseKey}:${count}`;
    if (logicalKey) {
      this.logicalToolCallIds.set(logicalKey, fallbackId);
    }
    return fallbackId;
  }

  async dispatch(event: TraceEvent): Promise<void> {
    try {
      if (event.policySuppressed) {
        this.hasTraceEvents = true;
        if (event.displayName || event.toolName) {
          this.currentStep = event.displayName || event.toolName;
        }
        await this.updateRunHeader('running');
        return;
      }

      const rendered = this.registry.render(event);

      const isUpdateTopic = event.canonicalToolName === 'update_topic' ||
        event.toolName === 'update_topic' ||
        event.displayName?.toLowerCase().includes('update topic') ||
        event.displayName?.toLowerCase().includes('updatetopic');

      if (isUpdateTopic) {
        if (!rendered.suppressed) {
          if (this.renderedTopic) {
            return;
          }
          this.renderedTopic = true;
        }
      }

      if (rendered.suppressed) {
        this.hasTraceEvents = true;
        if (event.displayName || event.toolName) {
          this.currentStep = event.displayName || event.toolName;
        }
        await this.updateRunHeader('running');
        return;
      }

      const payload = {
        content: rendered.content,
        embeds: rendered.embeds,
        files: rendered.files,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      };

      this.hasTraceEvents = true;
      const toolCallId = this.getEffectiveToolCallId(event);
      if (!isUpdateTopic && (toolCallId ? !this.seenToolCallIds.has(toolCallId) : event.type === 'tool_started')) {
        this.toolCallCount += 1;
        if (toolCallId) {
          this.seenToolCallIds.add(toolCallId);
        }
      }
      if (event.displayName || event.toolName) {
        this.currentStep = event.displayName || event.toolName;
      }
      await this.updateRunHeader('running');

      if (toolCallId) {
        const existingMessage = this.activeMessages.get(toolCallId);
        
        if (existingMessage) {
          if (event.status === 'progress') {
            const lastEdit = this.lastEditTimes.get(toolCallId) ?? 0;
            if (Date.now() - lastEdit >= 1000) {
              await existingMessage.edit(payload);
              this.lastEditTimes.set(toolCallId, Date.now());
            }
            return;
          } else if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
            await existingMessage.edit(payload);
            this.lastEditTimes.set(toolCallId, Date.now());
            return;
          }
        }
      }

      const sent = await this.threadChannel.send(payload);
      
      if (isUpdateTopic) {
        this.topicMessage = sent;
      } else if (toolCallId) {
        this.activeMessages.set(toolCallId, sent);
        this.lastEditTimes.set(toolCallId, Date.now());
      }
    } catch (error) {
      log.warn('Failed to dispatch trace event to Discord', { error: String(error) });
    }
  }

  async dispatchRunHeader(manifest: ThreadManifest): Promise<void> {
    try {
      this.startedAt = Date.now();
      this.toolCallCount = 0;
      this.currentStep = null;
      this.seenToolCallIds.clear();
      this.logicalToolCallIds.clear();
      this.hasTraceEvents = false;
      this.renderedTopic = false;
      this.topicMessage = null;
      this.headerMessage = await this.threadChannel.send({
        content: `◌ **Queued** · ${this.formatTask(manifest.taskSummary)}`,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      });
      this.startHeartbeat();
      await this.updateRunHeader('running');
    } catch (error) {
      log.warn('Failed to dispatch run header', { error: String(error) });
    }
  }

  async dispatchRunComplete(): Promise<void> {
    this.stopHeartbeat();
    await this.updateRunHeader('complete');
    await this.cleanupSimpleWorkflowTopic();
  }

  async dispatchRunFailed(error: unknown): Promise<void> {
    this.stopHeartbeat();
    const message = error instanceof Error ? error.message : String(error);
    await this.updateRunHeader('failed', message);
    await this.cleanupSimpleWorkflowTopic();
  }

  private async cleanupSimpleWorkflowTopic(): Promise<void> {
    if (this.toolCallCount <= 1 && this.topicMessage) {
      try {
        if (typeof this.topicMessage.delete === 'function') {
          await this.topicMessage.delete();
        }
      } catch (error) {
        log.warn('Failed to delete topic message for simple workflow', { error: String(error) });
      }
      this.topicMessage = null;
    }
  }

  async dispatchFinalResponse(response: string): Promise<void> {
    try {
      await this.threadChannel.send({
        content: response,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      });
    } catch (error) {
      log.warn('Failed to dispatch final response', { error: String(error) });
    }
  }

  private async updateRunHeader(state: 'running' | 'complete' | 'failed', detail?: string): Promise<void> {
    if (!this.headerMessage) return;

    const elapsed = this.formatElapsed(Date.now() - this.startedAt);
    let content: string;
    if (state === 'complete') {
      content = `✓ **Complete** \`${elapsed}\` · \`${this.toolCallCount}\` tool call${this.toolCallCount === 1 ? '' : 's'}`;
    } else if (state === 'failed') {
      const suffix = detail ? ` · ${detail.slice(0, 160)}` : '';
      content = `✗ **Failed** \`${elapsed}\` · \`${this.toolCallCount}\` tool call${this.toolCallCount === 1 ? '' : 's'}${suffix}`;
    } else {
      const suffix = this.currentStep
        ? ` · current step: \`${this.currentStep}\``
        : (this.hasTraceEvents ? '' : ' · waiting for first tool event');
      content = `⌁ **Running** \`${elapsed}\`${suffix}`;
    }

    try {
      await this.headerMessage.edit({
        content,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      });
    } catch (error) {
      log.warn('Failed to update trace run header', { error: String(error) });
    }
  }

  private formatElapsed(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
  }

  private formatTask(task: string): string {
    const trimmed = task.trim().replace(/\s+/g, ' ');
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.updateRunHeader('running').catch(() => {});
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

function resolveToolCallId(event: TraceEvent): string | null {
  if (typeof event.raw?.['toolCallId'] === 'string') {
    return event.raw['toolCallId'];
  }

  const toolCall = event.raw?.toolCall as Record<string, unknown> | undefined;
  return typeof toolCall?.id === 'string' ? toolCall.id : null;
}

function resolveLogicalToolKey(event: TraceEvent): string | null {
  const canonical = event.canonicalToolName;
  if (!canonical) return null;

  if (canonical === 'run_shell_command' || event.toolFamily === 'shell') {
    const command = stringArg(event.args, 'command', 'commandLine', 'CommandLine');
    return command ? `logical:shell:${command.replace(/\s+/g, ' ').trim()}` : null;
  }

  if (canonical === 'write_file' || canonical === 'replace') {
    const path = stringArg(event.args, 'file_path', 'path', 'filePath', 'TargetFile');
    return path ? `logical:${canonical}:${path}` : null;
  }

  return null;
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}
