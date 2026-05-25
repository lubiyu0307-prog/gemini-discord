import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runtimeStore } from '../src/daemon/runtime.js';
import { isExplicitSendToCurrentThread } from '../src/daemon/workflow/policy.js';
import { normalizeAcpUpdate } from '../src/daemon/workflow/trace-normalizer.js';
import { TraceDispatcher } from '../src/daemon/workflow/trace-dispatcher.js';
import { TraceRendererRegistry } from '../src/daemon/workflow/trace-renderer.js';
import { finalizeAssistantResponse } from '../src/daemon/engine-cli.js';

describe('Workflow Thread Policy & Interception', () => {
  beforeEach(() => {
    runtimeStore.activeWorkflowRuns.clear();
    runtimeStore.workflowResponseCandidates.clear();
    vi.restoreAllMocks();
  });

  describe('isExplicitSendToCurrentThread policy helper', () => {
    it('blocks conversational phrases containing "reply with"', () => {
      expect(isExplicitSendToCurrentThread('do a quick web search and reply with only the chapter number')).toBe(false);
      expect(isExplicitSendToCurrentThread('reply only with the number')).toBe(false);
      expect(isExplicitSendToCurrentThread('reply to this with the result')).toBe(false);
      expect(isExplicitSendToCurrentThread('reply back with chapter 1183')).toBe(false);
    });

    it('allows explicit requests containing send, post, or publish', () => {
      expect(isExplicitSendToCurrentThread('send a message to #updates')).toBe(true);
      expect(isExplicitSendToCurrentThread('post that here')).toBe(true);
      expect(isExplicitSendToCurrentThread('publish to Discord')).toBe(true);
      expect(isExplicitSendToCurrentThread('send hello')).toBe(true);
    });
  });

  describe('Trace Normalizer & Dispatcher policy suppression', () => {
    it('suppresses and excludes intercepted current-thread discord_message tool calls', async () => {
      const channelId = 'workflow-thread-123';
      const requestMessageId = 'msg-1';
      
      // Set active run metadata
      runtimeStore.activeWorkflowRuns.set(channelId, {
        requestMessageId,
        channelId,
        userContent: 'do a quick web search and reply with only the chapter number',
        startedAt: Date.now(),
      });

      // 1. Check Tool Started event normalization
      const startedEvent = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-msg-send',
          name: 'discord_message',
          arguments: { channel_id: channelId, content: '✦ 1183', action: 'send' },
        },
      }, new Map());

      expect(startedEvent).not.toBeNull();
      expect(startedEvent!.policySuppressed).toBe(true);

      // 2. Check Tool Completed event normalization with intercepted result
      const completedEvent = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-msg-send',
          name: 'discord_message',
          arguments: { channel_id: channelId, content: '✦ 1183', action: 'send' },
          result: { ok: true, intercepted: true, chunks: 0, messageIds: [] },
        },
      }, new Map());

      expect(completedEvent).not.toBeNull();
      expect(completedEvent!.policySuppressed).toBe(true);
      expect(completedEvent!.intercepted).toBe(true);

      // 3. Dispatch to TraceDispatcher and verify exclusion
      const mockHeaderEdit = vi.fn();
      const mockChannel = {
        id: channelId,
        send: vi.fn().mockResolvedValue({ id: 'sent-msg' }),
      } as any;

      const registry = new TraceRendererRegistry();
      const dispatcher = new TraceDispatcher(mockChannel, registry);

      // Set headerMessage to test it doesn't edit/post messages for suppressed events
      (dispatcher as any).headerMessage = { edit: mockHeaderEdit };
      
      await dispatcher.dispatch(startedEvent!);
      await dispatcher.dispatch(completedEvent!);

      // Intercepted messages must not be sent to Discord
      expect(mockChannel.send).not.toHaveBeenCalled();
      // Intercepted messages must not increment the tool call count
      expect((dispatcher as any).toolCallCount).toBe(0);
    });

    it('suppresses MCP-suffixed current-thread discord_message tool calls', async () => {
      const channelId = 'workflow-thread-123';
      runtimeStore.activeWorkflowRuns.set(channelId, {
        requestMessageId: 'msg-1',
        channelId,
        userContent: 'reply with exactly "ok"',
        startedAt: Date.now(),
      });

      const startedEvent = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-msg-send',
          name: 'discord_message (discord-bridge MCP Server)',
          arguments: { channel_id: channelId, content: 'ok', action: 'send' },
        },
      }, new Map());

      expect(startedEvent).toMatchObject({
        canonicalToolName: 'discord_message',
        policySuppressed: true,
      });

      const completedEvent = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-msg-send',
          name: 'discord_message (discord-bridge MCP Server)',
          arguments: { channel_id: channelId, content: 'ok', action: 'send' },
          result: {
            ok: true,
            intercepted: true,
            chunks: 0,
            messageIds: [],
            channel_id: channelId,
            note: 'Captured as final response candidate for current workflow thread; no Discord send was performed.',
          },
        },
      }, new Map());

      expect(completedEvent).toMatchObject({
        canonicalToolName: 'discord_message',
        policySuppressed: true,
        intercepted: true,
      });

      const header = { id: 'header', edit: vi.fn().mockResolvedValue(undefined) };
      const mockChannel = {
        id: channelId,
        send: vi.fn().mockResolvedValue({ id: 'sent-msg' }),
      } as any;
      const dispatcher = new TraceDispatcher(mockChannel, new TraceRendererRegistry());
      (dispatcher as any).headerMessage = header;

      await dispatcher.dispatch(startedEvent!);
      await dispatcher.dispatch(completedEvent!);
      await dispatcher.dispatchRunComplete();

      expect(mockChannel.send).not.toHaveBeenCalled();
      expect((dispatcher as any).toolCallCount).toBe(0);
      expect(header.edit).toHaveBeenLastCalledWith(expect.stringContaining('`0` tool calls'));
    });

    it('allows and counts explicit user-requested Discord send tools', async () => {
      const channelId = 'workflow-thread-123';
      const requestMessageId = 'msg-1';
      
      // Set active run metadata with explicit intent
      runtimeStore.activeWorkflowRuns.set(channelId, {
        requestMessageId,
        channelId,
        userContent: 'send a message saying Hello World to #updates',
        startedAt: Date.now(),
      });

      const startedEvent = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-msg-send',
          name: 'discord_message',
          arguments: { channel_id: channelId, content: 'Hello World', action: 'send' },
        },
      }, new Map());

      expect(startedEvent).not.toBeNull();
      expect(startedEvent!.policySuppressed).toBe(false);

      const mockHeaderEdit = vi.fn();
      const mockChannel = {
        id: channelId,
        send: vi.fn().mockResolvedValue({ id: 'sent-msg' }),
      } as any;

      const registry = new TraceRendererRegistry();
      const dispatcher = new TraceDispatcher(mockChannel, registry);
      (dispatcher as any).headerMessage = { edit: mockHeaderEdit };

      await dispatcher.dispatch(startedEvent!);

      // Explicit tool calls must be sent
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      // Explicit tool calls must increment the count
      expect((dispatcher as any).toolCallCount).toBe(1);
    });

    it('keeps MCP-suffixed explicit Discord sends visible and countable', async () => {
      const channelId = 'workflow-thread-123';
      runtimeStore.activeWorkflowRuns.set(channelId, {
        requestMessageId: 'msg-1',
        channelId,
        userContent: 'send a message saying Hello World to #updates',
        startedAt: Date.now(),
      });

      const event = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-msg-send',
          name: 'discord_message (discord-bridge MCP Server)',
          arguments: { channel_id: channelId, content: 'Hello World', action: 'send' },
        },
      }, new Map());

      expect(event).toMatchObject({
        canonicalToolName: 'discord_message',
        policySuppressed: false,
      });

      const mockChannel = {
        id: channelId,
        send: vi.fn().mockResolvedValue({ id: 'sent-msg' }),
      } as any;
      const dispatcher = new TraceDispatcher(mockChannel, new TraceRendererRegistry());
      (dispatcher as any).headerMessage = { edit: vi.fn().mockResolvedValue(undefined) };

      await dispatcher.dispatch(event!);

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect((dispatcher as any).toolCallCount).toBe(1);
    });

    it('excludes update_topic from visible tool counts', async () => {
      const event = normalizeAcpUpdate('tool_call', {
        sessionUpdate: 'tool_call',
        toolCall: {
          id: 'call-topic-1',
          name: 'update_topic',
          arguments: { topic: 'Phase 1' },
          result: { exitCode: 0 },
        },
      }, new Map());

      expect(event).not.toBeNull();

      const mockHeaderEdit = vi.fn();
      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: 'sent-msg' }),
      } as any;

      const registry = new TraceRendererRegistry();
      const dispatcher = new TraceDispatcher(mockChannel, registry);
      (dispatcher as any).headerMessage = { edit: mockHeaderEdit };

      await dispatcher.dispatch(event!);

      expect((dispatcher as any).toolCallCount).toBe(0);
    });
  });

  describe('finalizeAssistantResponse options', () => {
    it('normal channel/DM final response path remains unchanged and handles options cleanly', async () => {
      const mockMessage = {
        client: {
          channels: { fetch: vi.fn() },
        },
      } as any;

      const res = await finalizeAssistantResponse('Hello World', mockMessage, {
        allowPrivilegedActions: true,
      });

      expect(res.displayText).toBe('✦ Hello World');
      expect(res.responseText).toBe('Hello World');
    });

    it('does not prepend newlines when prependNewlines is false', async () => {
      const mockMessage = {
        client: {
          channels: { fetch: vi.fn() },
        },
      } as any;

      const res = await finalizeAssistantResponse('Hello World', mockMessage, {
        allowPrivilegedActions: true,
        prependNewlines: false,
      });

      expect(res.displayText).toBe('✦ Hello World');
    });

    it('normalizes compact sparkle-prefixed workflow final answers', async () => {
      const mockMessage = {
        client: {
          channels: { fetch: vi.fn() },
        },
      } as any;

      const res = await finalizeAssistantResponse('✦1183', mockMessage, {
        allowPrivilegedActions: true,
        prependNewlines: false,
      });

      expect(res.displayText).toBe('✦ 1183');
      expect(res.responseText).toBe('✦1183');
    });

    it('keeps grouped workflow final answers readable with leading spacing', async () => {
      const mockMessage = {
        client: {
          channels: { fetch: vi.fn() },
        },
      } as any;

      const res = await finalizeAssistantResponse('✦1183', mockMessage, {
        allowPrivilegedActions: true,
        prependNewlines: true,
      });

      expect(res.displayText).toBe('\n\n✦ 1183');
      expect(res.responseText).toBe('✦1183');
    });

    it('prepends newlines when prependNewlines is true', async () => {
      const mockMessage = {
        client: {
          channels: { fetch: vi.fn() },
        },
      } as any;

      const res = await finalizeAssistantResponse('Hello World', mockMessage, {
        allowPrivilegedActions: true,
        prependNewlines: true,
      });

      expect(res.displayText).toBe('\n\n✦ Hello World');
    });
  });
});
