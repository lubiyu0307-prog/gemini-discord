import type { TextChannel, ThreadChannel, Message } from 'discord.js';
import type { TraceEvent } from './trace-event.js';
import { TraceRendererRegistry } from './trace-renderer.js';
import type { ThreadManifest } from './thread-manifest.js';
import { log } from '../log.js';

export class TraceDispatcher {
  private activeMessages = new Map<string, Message>();

  constructor(
    private threadChannel: ThreadChannel | TextChannel,
    private registry: TraceRendererRegistry,
  ) {}

  async dispatch(event: TraceEvent): Promise<void> {
    try {
      const rendered = this.registry.render(event);
      const content = `${rendered.content}\n<!-- trace:doNotPersist -->`;

      const toolCall = event.raw?.toolCall as Record<string, unknown> | undefined;
      const toolCallId = typeof toolCall?.id === 'string' ? toolCall.id : null;

      if (toolCallId) {
        const existingMessage = this.activeMessages.get(toolCallId);
        
        if (existingMessage) {
          if (event.status === 'progress') {
            await existingMessage.edit(content);
            return;
          } else if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
            await existingMessage.edit(content);
            this.activeMessages.delete(toolCallId);
            return;
          }
        }
      }

      const sent = await this.threadChannel.send({ content });
      
      if (toolCallId && event.status === 'started') {
        this.activeMessages.set(toolCallId, sent);
      }
    } catch (error) {
      log.warn('Failed to dispatch trace event to Discord', { error: String(error) });
    }
  }

  async dispatchRunHeader(manifest: ThreadManifest): Promise<void> {
    try {
      await this.threadChannel.send({
        content: `⚡ **Running workflow task**: "${manifest.taskSummary}"\n*Starting execution engine...*\n<!-- trace:doNotPersist -->`,
      });
    } catch (error) {
      log.warn('Failed to dispatch run header', { error: String(error) });
    }
  }

  async dispatchFinalResponse(response: string): Promise<void> {
    try {
      await this.threadChannel.send({
        content: response,
      });
    } catch (error) {
      log.warn('Failed to dispatch final response', { error: String(error) });
    }
  }
}
