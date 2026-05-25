import { describe, it, expect } from 'vitest';
import { TraceRendererRegistry } from '../src/daemon/workflow/trace-renderer.js';
import type { TraceEvent } from '../src/daemon/workflow/trace-event.js';

describe('trace renderers', () => {
  const registry = new TraceRendererRegistry();

  it('renders shell commands correctly', () => {
    const event: TraceEvent = {
      type: 'tool_started',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { commandLine: 'ls -la' },
      status: 'started',
      durationMs: null,
      resultSummary: null,
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.content).toContain('Shell');
    expect(rendered.content).toContain('ls -la');
    expect(rendered.flags).toEqual({
      source: 'trace_renderer',
      doNotRoute: true,
      doNotPersist: true,
    });
  });

  it('renders filesystem operations correctly', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'write_file',
      canonicalToolName: 'write_file',
      displayName: 'WriteFile',
      toolFamily: 'filesystem',
      args: { path: '/tmp/test.txt' },
      status: 'completed',
      durationMs: 120,
      resultSummary: 'Wrote 15 bytes',
      artifactRef: '/tmp/test.txt',
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.content).toContain('File [WriteFile]');
    expect(rendered.content).toContain('/tmp/test.txt');
    expect(rendered.content).toContain('completed');
  });

  it('renders planning phases correctly', () => {
    const event: TraceEvent = {
      type: 'phase_started',
      timestamp: Date.now(),
      toolName: null,
      canonicalToolName: null,
      displayName: null,
      toolFamily: 'planning',
      args: {},
      status: 'started',
      durationMs: null,
      resultSummary: 'Investigating routing table',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.content).toContain('Planning');
    expect(rendered.content).toContain('Investigating routing table');
  });
});
