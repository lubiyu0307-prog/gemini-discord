import { describe, it, expect } from 'vitest';
import { TraceRendererRegistry } from '../src/daemon/workflow/trace-renderer.js';
import type { TraceEvent } from '../src/daemon/workflow/trace-event.js';

describe('trace renderers', () => {
  const registry = new TraceRendererRegistry();

  it('suppresses shell starts until output is available', () => {
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
    expect(rendered.suppressed).toBe(true);
  });

  it('renders completed shell commands without duplicating title commands', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'acp_execute',
      canonicalToolName: 'acp_execute',
      displayName: 'go run triangle.go',
      toolFamily: 'shell',
      args: { command: 'go run triangle.go' },
      status: 'completed',
      durationMs: 120,
      resultSummary: 'Right-angled Triangle:\n*\n* *',
      resultDetail: 'Right-angled Triangle:\n*\n* *',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.density).toBe('panel');
    expect(rendered.content.match(/go run triangle\.go/g)).toHaveLength(1);
    expect(rendered.content).toContain('```txt');
    expect(rendered.embeds).toBeUndefined();
    expect(rendered.flags).toEqual({
      source: 'trace_renderer',
      doNotRoute: true,
      doNotPersist: true,
    });
  });

  it('renders filesystem writes as code previews instead of inline diffs', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'write_file',
      canonicalToolName: 'write_file',
      displayName: 'WriteFile',
      toolFamily: 'filesystem',
      args: { path: '/tmp/triangle.go' },
      status: 'completed',
      durationMs: 120,
      resultSummary: 'Accepted (+14, -0)',
      resultDetail: 'Diff: /tmp/triangle.go\n+++ new\npackage main\n\nimport "fmt"\n',
      artifactRef: '/tmp/triangle.go',
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.density).toBe('card');
    expect(rendered.content).toContain('WriteFile');
    expect(rendered.content).toContain('/tmp/triangle.go');
    expect(rendered.content).toContain('```go');
    expect(rendered.content).toContain('package main');
    expect(rendered.content).not.toContain('+++ new');
    expect(rendered.embeds).toBeUndefined();
  });

  it('collapses topic updates into compact terminal phase lines', () => {
    const started: TraceEvent = {
      type: 'tool_started',
      timestamp: Date.now(),
      toolName: 'update_topic',
      canonicalToolName: 'update_topic',
      displayName: 'UpdateTopic',
      toolFamily: 'planning',
      args: { topic: 'Creating Go Triangle Script' },
      status: 'started',
      durationMs: null,
      resultSummary: null,
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };
    const completed: TraceEvent = {
      ...started,
      type: 'tool_completed',
      status: 'completed',
      resultSummary: 'Topic: Creating Go Triangle Script\n\nSummary:\nLarge verbose summary',
    };

    expect(registry.render(started).suppressed).toBe(true);
    const rendered = registry.render(completed);
    expect(rendered.content).toBe('**Topic:** Creating Go Triangle Script');
    expect(rendered.content).not.toContain('Summary');
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
    expect(rendered.content).toContain('Phase');
    expect(rendered.content).toContain('Investigating routing table');
  });

  it('renders simple reads and searches as compact rows', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'grep_search',
      canonicalToolName: 'grep_search',
      displayName: 'SearchText',
      toolFamily: 'search',
      args: { pattern: 'messageCreate', dir_path: '/Users/yamato/project/src/daemon' },
      status: 'completed',
      durationMs: 80,
      resultSummary: 'Found 2 matches',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.density).toBe('row');
    expect(rendered.content).toContain('✓ **SearchText**');
    expect(rendered.content).toContain('messageCreate');
    expect(rendered.content).toContain('→ Found 2 matches');
  });

  it('attaches long shell output instead of pasting all of it', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { command: 'npm test' },
      status: 'completed',
      durationMs: 1200,
      resultSummary: 'Tests passed',
      resultDetail: 'line\n'.repeat(500),
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: true },
    };

    const rendered = registry.render(event);
    expect(rendered.files).toHaveLength(1);
    expect(rendered.content).toContain('full output attached');
    expect(rendered.content).toContain('```txt');
    expect(rendered.embeds).toBeUndefined();
  });
});
