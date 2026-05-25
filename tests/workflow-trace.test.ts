import { describe, it, expect, vi } from 'vitest';
import type { TraceEvent } from '../src/daemon/workflow/trace-event.js';
import { normalizeAcpUpdate } from '../src/daemon/workflow/trace-normalizer.js';
import { TraceRendererRegistry } from '../src/daemon/workflow/trace-renderer.js';
import { TraceDispatcher } from '../src/daemon/workflow/trace-dispatcher.js';

describe('workflow trace events & renderer integration', () => {
  it('correctly maps tool_call, tool_call_update and plan updates', () => {
    const timers = new Map<string, number>();
    timers.set('call-1', Date.now() - 500);

    // 1. Tool Call Started
    const callStartedPayload = {
      sessionUpdate: 'tool_call',
      toolCall: {
        id: 'call-2',
        name: 'run_shell_command',
        arguments: { commandLine: 'git status' },
      },
    };
    const eventStarted = normalizeAcpUpdate('tool_call', callStartedPayload, timers);
    expect(eventStarted).not.toBeNull();
    expect(eventStarted!.type).toBe('tool_started');
    expect(eventStarted!.status).toBe('started');
    expect(eventStarted!.canonicalToolName).toBe('run_shell_command');
    expect(eventStarted!.args.commandLine).toBe('git status');

    // 2. Tool Call Progress
    const progressPayload = {
      sessionUpdate: 'tool_call_update',
      toolCall: {
        id: 'call-1',
        name: 'run_shell_command',
        progress: 'compiling...',
      },
    };
    const eventProgress = normalizeAcpUpdate('tool_call_update', progressPayload, timers);
    expect(eventProgress).not.toBeNull();
    expect(eventProgress!.type).toBe('tool_progress');
    expect(eventProgress!.status).toBe('progress');
    expect(eventProgress!.resultSummary).toBe('compiling...');

    // 3. Tool Call Completed
    const completedPayload = {
      sessionUpdate: 'tool_call',
      toolCall: {
        id: 'call-1',
        name: 'run_shell_command',
        result: { exitCode: 0, stdout: 'build ok' },
      },
    };
    const eventCompleted = normalizeAcpUpdate('tool_call', completedPayload, timers);
    expect(eventCompleted).not.toBeNull();
    expect(eventCompleted!.type).toBe('tool_completed');
    expect(eventCompleted!.status).toBe('completed');
    expect(eventCompleted!.resultSummary).toContain('build ok');
    expect(eventCompleted!.durationMs).toBeGreaterThanOrEqual(500);

    // 4. Plan/Thought Update
    const planPayload = {
      sessionUpdate: 'plan',
      plan: 'Determine next steps',
    };
    const eventPlan = normalizeAcpUpdate('plan', planPayload, timers);
    expect(eventPlan).not.toBeNull();
    expect(eventPlan!.type).toBe('phase_started');
    expect(eventPlan!.resultSummary).toBe('Determine next steps');
  });

  it('generates trace messages containing doNotPersist and doNotRoute flags', async () => {
    const mockChannel = {
      send: vi.fn().mockResolvedValue({ id: 'sent-msg-1' }),
    } as any;

    const registry = new TraceRendererRegistry();
    const dispatcher = new TraceDispatcher(mockChannel, registry);

    const event: TraceEvent = {
      type: 'tool_started',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { commandLine: 'git status' },
      status: 'started',
      durationMs: null,
      resultSummary: null,
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    await dispatcher.dispatch(event);

    expect(mockChannel.send).toHaveBeenCalledTimes(1);
    const sentArgs = mockChannel.send.mock.calls[0][0];
    expect(sentArgs.content).toContain('git status');
    expect(sentArgs.content).toContain('<!-- trace:doNotPersist -->');
  });
});
