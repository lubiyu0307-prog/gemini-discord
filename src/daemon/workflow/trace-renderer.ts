import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
import type { TraceEvent } from './trace-event.js';

const TRACE_LIMIT = 1900;
const PANEL_INLINE_LIMIT = 900;
const ATTACHMENT_THRESHOLD = 1200;

type TraceDensity = 'row' | 'card' | 'panel';

export interface RenderedTrace {
  content: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  density: TraceDensity;
  flags: {
    source: 'trace_renderer';
    doNotRoute: true;
    doNotPersist: true;
  };
}

export interface ToolRenderer {
  canRender(event: TraceEvent): boolean;
  render(event: TraceEvent): RenderedTrace;
}

function flags(): RenderedTrace['flags'] {
  return { source: 'trace_renderer', doNotRoute: true, doNotPersist: true };
}

export function statusGlyph(status: TraceEvent['status']): string {
  switch (status) {
    case 'started':
      return '⌁';
    case 'progress':
      return '↻';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'cancelled':
      return '⚠';
  }
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function boolArg(args: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => args[key] === true || args[key] === 'true');
}

function intArg(args: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

function shortPath(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 4) return normalized;
  return `${parts[0]}/.../${parts.slice(-2).join('/')}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function inlineCode(text: string): string {
  const safe = text.replace(/`/g, '\'');
  return `\`${truncate(safe, 180)}\``;
}

function codeBlock(language: string, text: string): string {
  const safe = text.replace(/```/g, '\'\'\'');
  return `\`\`\`${language}\n${safe}\n\`\`\``;
}

function filenameFor(event: TraceEvent): string {
  const rawName = event.displayName || event.toolName || 'tool-output';
  const safeName = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tool-output';
  return `workflow-${safeName}-${event.timestamp}.txt`;
}

function attachmentFor(event: TraceEvent, detail: string): AttachmentBuilder | null {
  if (detail.length < ATTACHMENT_THRESHOLD) return null;
  return new AttachmentBuilder(Buffer.from(detail, 'utf8'), { name: filenameFor(event) });
}

function compactArgs(args: Record<string, unknown>, preferred: string[]): string {
  const parts: string[] = [];
  for (const key of preferred) {
    const value = args[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') {
      parts.push(`${key}: ${truncate(value, 80)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}: ${String(value)}`);
    } else {
      parts.push(`${key}: ${truncate(JSON.stringify(value), 80)}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(', ');
}

function resultSuffix(event: TraceEvent, fallback = ''): string {
  const result = event.resultSummary || fallback;
  return result ? ` → ${truncate(result.replace(/\s+/g, ' '), 240)}` : '';
}

function terminalLine(event: TraceEvent, title: string, body = ''): string {
  const suffix = body.trim() ? ` ${body.trim()}` : '';
  return `${statusGlyph(event.status)} **${title}**${suffix}`.trim();
}

function outputBlock(language: string, text: string): string {
  const value = text.trimEnd();
  return value ? codeBlock(language, value) : '';
}

function transcript(event: TraceEvent, title: string, detail: string, language = 'txt'): RenderedTrace {
  const attachment = attachmentFor(event, detail);
  const preview = truncate(detail || event.resultSummary || '', PANEL_INLINE_LIMIT);
  const lines = [
    terminalLine(event, title),
    preview ? `\n${outputBlock(language, preview)}` : '',
    attachment ? '↳ full output attached' : '',
  ].filter(Boolean);

  return {
    content: lines.join('\n'),
    files: attachment ? [attachment] : undefined,
    density: 'panel',
    flags: flags(),
  };
}

function row(event: TraceEvent, body: string): RenderedTrace {
  return {
    content: terminalLine(event, event.displayName || event.toolName || 'Tool', body),
    density: 'row',
    flags: flags(),
  };
}

function panel(event: TraceEvent, title: string, detail: string, language = 'txt'): RenderedTrace {
  return transcript(event, title, detail, language);
}

function card(event: TraceEvent, title: string, lines: string[]): RenderedTrace {
  return {
    content: [
      terminalLine(event, title),
      ...lines.filter(Boolean).slice(0, 4),
    ].join('\n'),
    density: 'card',
    flags: flags(),
  };
}

function shellCommand(event: TraceEvent): string {
  return stringArg(event.args, 'command', 'commandLine', 'CommandLine');
}

function filePath(event: TraceEvent): string {
  return stringArg(event.args, 'file_path', 'path', 'filePath', 'TargetFile');
}

function searchTarget(event: TraceEvent): string {
  return stringArg(event.args, 'pattern', 'query', 'Query', 'include');
}

function readFileResult(event: TraceEvent): string {
  const start = intArg(event.args, 'start_line', 'startLine', 'offset');
  const end = intArg(event.args, 'end_line', 'endLine');
  const limit = intArg(event.args, 'limit');
  if (start !== null && end !== null) return `Read lines ${start}-${end}`;
  if (start !== null && limit !== null) return `Read lines ${start}-${start + limit}`;
  return event.resultSummary ? truncate(event.resultSummary.replace(/\s+/g, ' '), 180) : 'Read file';
}

export class ShellRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.canonicalToolName === 'run_shell_command' || event.toolFamily === 'shell';
  }

  render(event: TraceEvent): RenderedTrace {
    const command = shellCommand(event);
    const displayName = event.displayName && event.displayName !== 'Shell command'
      ? event.displayName
      : 'Shell';
    const title = command ? `${displayName} ${truncate(command, 140)}` : displayName;
    if (boolArg(event.args, 'is_background', 'isBackground')) {
      const detail = event.status === 'completed'
        ? 'Command moved to background. Output hidden.'
        : 'Starting background command...';
      return panel(event, title, detail);
    }

    if (event.status === 'started') {
      return panel(event, title, '');
    }

    const detail = event.resultDetail || event.resultSummary || '';
    return panel(event, title, detail);
  }
}

export class FilesystemRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'filesystem';
  }

  render(event: TraceEvent): RenderedTrace {
    const canonical = event.canonicalToolName;
    const path = filePath(event);

    if (canonical === 'replace') {
      const added = intArg(event.args, 'added', 'lines_added');
      const removed = intArg(event.args, 'removed', 'lines_removed');
      const summary = event.resultSummary || 'Accepted';
      const delta = added !== null || removed !== null ? ` (+${added ?? 0}, -${removed ?? 0})` : '';
      return card(event, `Edit ${path ? inlineCode(shortPath(path)) : ''} → ${summary}${delta}`, []);
    }

    if (canonical === 'write_file') {
      return card(event, `WriteFile ${path ? inlineCode(shortPath(path)) : ''}${resultSuffix(event, 'Wrote file')}`, []);
    }

    if (canonical === 'read_file') {
      return row(event, `${path ? inlineCode(shortPath(path)) : ''} → ${readFileResult(event)}`);
    }

    if (canonical === 'read_many_files') {
      const include = stringArg(event.args, 'include');
      return row(event, `${include ? inlineCode(include) : 'files'}${resultSuffix(event, 'Read files')}`);
    }

    if (canonical === 'list_directory') {
      const dir = stringArg(event.args, 'dir_path', 'path');
      return row(event, `${dir ? inlineCode(shortPath(dir)) : 'directory'}${resultSuffix(event, 'Listed directory')}`);
    }

    return row(event, `${path ? inlineCode(shortPath(path)) : ''}${resultSuffix(event)}`);
  }
}

export class SearchRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'search';
  }

  render(event: TraceEvent): RenderedTrace {
    const query = searchTarget(event);
    const dir = stringArg(event.args, 'dir_path', 'path');
    const within = dir ? ` within ${inlineCode(shortPath(dir))}` : '';
    return row(event, `${query ? inlineCode(query) : ''}${within}${resultSuffix(event)}`);
  }
}

export class WebRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'web';
  }

  render(event: TraceEvent): RenderedTrace {
    const query = stringArg(event.args, 'query', 'prompt', 'url', 'Url');
    const title = event.displayName || (event.canonicalToolName === 'google_web_search' ? 'GoogleSearch' : 'Web');
    const action = event.canonicalToolName === 'google_web_search' ? 'Searching the web for:' : 'Fetching';
    const body = query ? `${action} "${truncate(query.replace(/\s+/g, ' '), 180)}"` : '';
    if (event.resultDetail && event.resultDetail.length > 500) {
      return transcript(event, `${title} ${body}`.trim(), event.resultDetail);
    }
    return {
      content: [
        terminalLine(event, title, body),
        event.resultSummary ? `↳ ${truncate(event.resultSummary.replace(/\s+/g, ' '), 240)}` : '',
      ].filter(Boolean).join('\n'),
      density: 'card',
      flags: flags(),
    };
  }
}

export class PlanningRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'planning' || event.type === 'phase_started';
  }

  render(event: TraceEvent): RenderedTrace {
    const summary = event.resultSummary || compactArgs(event.args, ['title', 'summary', 'reason', 'taskId']);
    if (event.type === 'phase_started') {
      const phase = summary || 'Planning next step';
      return {
        content: phase.includes(':') ? `**${phase.split(':')[0]}:**${phase.slice(phase.indexOf(':') + 1)}` : `**Phase:** ${phase}`,
        density: 'row',
        flags: flags(),
      };
    }
    return card(event, event.displayName || 'Planning', summary ? [summary] : []);
  }
}

export class McpRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'mcp';
  }

  render(event: TraceEvent): RenderedTrace {
    const args = compactArgs(event.args, ['namespace', 'query', 'name', 'path', 'uri']);
    const result = event.resultSummary ? `→ ${event.resultSummary}` : '';
    return card(event, event.displayName || event.toolName || 'MCP', [args, result]);
  }
}

export class InteractionRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'interaction';
  }

  render(event: TraceEvent): RenderedTrace {
    const prompt = stringArg(event.args, 'prompt', 'question');
    return card(event, event.displayName || 'AskUser', [prompt ? inlineCode(prompt) : '? clarification needed']);
  }
}

export class GenericFallbackRenderer implements ToolRenderer {
  canRender(): boolean {
    return true;
  }

  render(event: TraceEvent): RenderedTrace {
    const args = compactArgs(event.args, Object.keys(event.args));
    const title = event.displayName || event.toolName || 'Tool';
    if (event.resultDetail && event.resultDetail.length > 500) {
      return panel(event, title, event.resultDetail);
    }
    return card(event, title, [args, event.resultSummary ? `→ ${event.resultSummary}` : '']);
  }
}

export class TraceRendererRegistry {
  private renderers: ToolRenderer[] = [];
  private fallbackRenderer = new GenericFallbackRenderer();

  constructor() {
    this.register(new ShellRenderer());
    this.register(new FilesystemRenderer());
    this.register(new SearchRenderer());
    this.register(new WebRenderer());
    this.register(new PlanningRenderer());
    this.register(new McpRenderer());
    this.register(new InteractionRenderer());
  }

  register(renderer: ToolRenderer): void {
    this.renderers.push(renderer);
  }

  render(event: TraceEvent): RenderedTrace {
    for (const renderer of this.renderers) {
      if (renderer.canRender(event)) {
        const rendered = renderer.render(event);
        if (rendered.content.length > TRACE_LIMIT) {
          rendered.content = truncate(rendered.content, TRACE_LIMIT);
        }
        return rendered;
      }
    }
    return this.fallbackRenderer.render(event);
  }
}
