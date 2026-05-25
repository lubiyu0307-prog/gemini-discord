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
    expect(rendered.density).toBe('panel');
    const embed = rendered.embeds?.[0]?.toJSON();
    expect(embed?.description).toContain('Shell');
    expect(embed?.description).toContain('ls -la');
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
    expect(rendered.density).toBe('card');
    const embed = rendered.embeds?.[0]?.toJSON();
    expect(embed?.description).toContain('WriteFile');
    expect(embed?.description).toContain('/tmp/test.txt');
    expect(embed?.description).toContain('Wrote 15 bytes');
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
    const embed = rendered.embeds?.[0]?.toJSON();
    expect(rendered.files).toHaveLength(1);
    expect(embed?.description).toContain('full output attached');
  });
});
