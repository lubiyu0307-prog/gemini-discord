import { describe, it, expect } from 'vitest';
import { TraceRendererRegistry } from '../src/daemon/workflow/trace-renderer.js';
import { normalizeAcpUpdate } from '../src/daemon/workflow/trace-normalizer.js';
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
    expect(rendered.content).toBe('**Creating Go Triangle Script:** Large verbose summary');
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

  it('renders short shell commands fully with visible stdout', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { command: 'python3 -c "print(\'hello\')"' },
      status: 'completed',
      durationMs: 80,
      resultSummary: 'hello',
      resultDetail: 'hello',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.content).toContain('✓ **Shell** `python3 -c "print(\'hello\')"`');
    expect(rendered.content).toContain('```txt\nhello\n```');
    expect(rendered.content).not.toContain('python3 -c`');
  });

  it('suppresses successful shell metadata panels when no real output remains', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { command: 'python3 -c "print(\'hello\')"' },
      status: 'completed',
      durationMs: 80,
      resultSummary: '[current working directory ~/project]\n(Executing a simple Python command to print "hello".)',
      resultDetail: '[current working directory ~/project]\n(Executing a simple Python command to print "hello".)',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.content).toBe('✓ **Shell** `python3 -c "print(\'hello\')"`');
    expect(rendered.content).not.toContain('current working directory');
    expect(rendered.content).not.toContain('Executing a simple Python command');
  });

  it('normalizes shell raw stdout and stderr without hiding output', () => {
    const event = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'shell-stdout-1',
      status: 'completed',
      title: 'Shell python3 -c "print(\'hello\')"',
      kind: 'execute',
      rawInput: {
        name: 'run_shell_command',
        args: { command: 'python3 -c "print(\'hello\')"' },
      },
      rawOutput: { exitCode: 0, stdout: 'hello\n', stderr: '' },
    }, new Map());

    const rendered = registry.render(event!);
    expect(rendered.content).toContain('✓ **Shell** `python3 -c "print(\'hello\')"`');
    expect(rendered.content).toContain('```txt\nhello\n```');
    expect(rendered.content).not.toContain('exit code: 0');
  });

  it('correctly normalizes paths, splitting compound heredoc commands, and capping previews', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: {
        commandLine: 'mkdir -p /Users/yamato/Desktop && cat << \'EOF\' > /Users/yamato/Desktop/triangle.py\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nEOF && /Users/yamato/venv/bin/python3 /Users/yamato/Desktop/triangle.py'
      },
      status: 'completed',
      durationMs: 50,
      resultSummary: 'Success',
      resultDetail: 'output line 1\noutput line 2\noutput line 3',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    // Should split into mkdir, cat (WriteFile) and python execution
    expect(rendered.content).toContain('✓ **Shell** `mkdir -p ~/Desktop`');
    expect(rendered.content).toContain('✓ **WriteFile** `~/Desktop/triangle.py` → Created (+12, -0)');
    expect(rendered.content).toContain('✓ **Shell** `python3 ~/Desktop/triangle.py`');
    // Heredoc preview should be exactly 10 lines + truncation line
    expect(rendered.content).toContain('line10');
    expect(rendered.content).not.toContain('line11');
    expect(rendered.content).toContain('... 2 lines truncated ...');
    expect(rendered.content).toContain('output line 1');
  });

  it('truncates output cleanly keeping head/tail appropriately', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { commandLine: 'python3 script.py' },
      status: 'failed',
      durationMs: 10,
      resultSummary: 'Failed',
      resultDetail: Array.from({ length: 25 }, (_, i) => `error line ${i}`).join('\n'),
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    // Since failed, it keeps the tail (last 10 lines)
    expect(rendered.content).toContain('... first 15 lines hidden ...');
    expect(rendered.content).toContain('error line 24');
    expect(rendered.content).not.toContain('error line 9');
  });

  it('renders update_topic as a single compact line with truncated summary', () => {
    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'update_topic',
      canonicalToolName: 'update_topic',
      displayName: 'UpdateTopic',
      toolFamily: 'planning',
      args: { topic: 'Creating Triangle Script' },
      status: 'completed',
      durationMs: 10,
      resultSummary: 'Topic: Creating Triangle Script\n\nSummary:\nI am starting the task to create a script to print triangles using nested loops in Python and save it to my Desktop. This is a very long summary that we want to keep short.',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const rendered = registry.render(event);
    expect(rendered.density).toBe('row');
    expect(rendered.content).toBe('**Creating Triangle Script:** I am starting the task to create a script to print triangles using nested loops in Python and save it to my Desktop. Thi...');
  });

  it('renders GoogleSearch with CLI structure exactly', () => {
    const startedEvent: TraceEvent = {
      type: 'tool_started',
      timestamp: Date.now(),
      toolName: 'google_web_search',
      canonicalToolName: 'google_web_search',
      displayName: 'GoogleSearch',
      toolFamily: 'web',
      args: { query: 'latest One Piece chapter number' },
      status: 'started',
      durationMs: null,
      resultSummary: null,
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    const completedEvent: TraceEvent = {
      ...startedEvent,
      type: 'tool_completed',
      status: 'completed',
      resultSummary: 'Success',
    };

    const renderedStarted = registry.render(startedEvent);
    expect(renderedStarted.density).toBe('row');
    expect(renderedStarted.content).toBe('⌁ **GoogleSearch**  Searching the web for: `\"latest One Piece chapter number\"`');

    const renderedCompleted = registry.render(completedEvent);
    expect(renderedCompleted.density).toBe('row');
    expect(renderedCompleted.content).toBe('✓ **GoogleSearch**  Searching the web for: `\"latest One Piece chapter number\"`\n↳ Search results for `\"latest One Piece chapter number\"` returned.');
  });

  it('normalizes title-only ACP web search events to GoogleSearch rows', () => {
    const event = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'search-1',
      status: 'completed',
      title: 'Searching the web for: "latest One Piece chapter number"',
      kind: 'search',
      content: [
        { type: 'content', content: { type: 'text', text: 'Search results returned.' } },
      ],
    }, new Map());

    expect(event).toMatchObject({
      canonicalToolName: 'google_web_search',
      displayName: 'GoogleSearch',
      toolFamily: 'web',
      args: { query: 'latest One Piece chapter number' },
    });

    const rendered = registry.render(event!);
    expect(rendered.content).toBe('✓ **GoogleSearch**  Searching the web for: `\"latest One Piece chapter number\"`\n↳ Search results for `\"latest One Piece chapter number\"` returned.');
  });

  it('renders title-only directory reads with a canonical tool label', () => {
    const event = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'folder-1',
      status: 'completed',
      title: '.',
      kind: 'read',
      content: [
        { type: 'content', content: { type: 'text', text: 'Found 8 item(s).' } },
      ],
    }, new Map());

    expect(event).toMatchObject({
      canonicalToolName: 'list_directory',
      displayName: 'ListDirectory',
      toolFamily: 'filesystem',
      args: { dir_path: '.' },
    });

    const rendered = registry.render(event!);
    expect(rendered.content).toBe('✓ **ListDirectory** `.` → Listed 8 entries');
    expect(rendered.content).not.toContain('✓ .');
  });
});
