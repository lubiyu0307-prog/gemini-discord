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
  suppressed?: boolean;
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

function suppressed(): RenderedTrace {
  return {
    content: '',
    density: 'row',
    suppressed: true,
    flags: flags(),
  };
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
  if (normalized.startsWith('/Users/yamato/')) {
    return normalized.replace(/^\/Users\/yamato\//, '~/');
  } else if (normalized === '/Users/yamato') {
    return '~';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 4) return normalized;
  return `${parts[0]}/.../${parts.slice(-2).join('/')}`;
}

function splitCommand(cmd: string): string[] {
  const subCmds: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inHeredoc = false;
  let heredocMarker = '';

  const lines = cmd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inHeredoc) {
      const trimmedLine = line.trim();
      const markerRegex = new RegExp(`^${heredocMarker}\\b\\s*(?:&&|;)?(.*)$`);
      const markerMatch = trimmedLine.match(markerRegex);

      if (markerMatch) {
        current += '\n' + heredocMarker;
        inHeredoc = false;
        heredocMarker = '';
        subCmds.push(current.trim());
        current = '';

        const remainingOnLine = markerMatch[1].trim();
        if (remainingOnLine) {
          const remainingSubCmds = splitCommand(remainingOnLine);
          subCmds.push(...remainingSubCmds);
        }
        continue;
      }

      current += '\n' + line;
      continue;
    }

    const heredocMatch = line.match(/<<\s*['"]?(\w+)['"]?/);
    if (heredocMatch) {
      inHeredoc = true;
      heredocMarker = heredocMatch[1];
      const beforeHeredoc = line.substring(0, heredocMatch.index).trim();
      const catMatch = beforeHeredoc.match(/(.*?)\bcat\s*$/i);
      if (catMatch) {
        let left = catMatch[1].trim();
        if (left.endsWith('&&')) {
          left = left.slice(0, -2).trim();
        }
        if (left) {
          subCmds.push(left);
        }
        current = 'cat ' + line.substring(heredocMatch.index!);
      } else {
        if (beforeHeredoc) {
          subCmds.push(beforeHeredoc);
        }
        current = line.substring(heredocMatch.index!);
      }
      continue;
    }

    let startIdx = 0;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (!inSingleQuote && !inDoubleQuote) {
        if (line.startsWith('&&', j)) {
          const part = line.substring(startIdx, j).trim();
          const combined = (current ? current + ' ' : '') + part;
          if (combined.trim()) subCmds.push(combined.trim());
          current = '';
          j++;
          startIdx = j + 1;
        } else if (char === ';') {
          const part = line.substring(startIdx, j).trim();
          const combined = (current ? current + ' ' : '') + part;
          if (combined.trim()) subCmds.push(combined.trim());
          current = '';
          startIdx = j + 1;
        }
      }
    }
    const remaining = line.substring(startIdx).trim();
    if (remaining) {
      current = (current ? current + ' ' : '') + remaining;
    }
    
    if (current.trim()) {
      subCmds.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) {
    subCmds.push(current.trim());
  }
  return subCmds.map(c => c.trim()).filter(Boolean);
}

function parseHeredocTarget(cmd: string): { file: string; lines: number; content: string } | null {
  const match = cmd.match(/(?:cat\s*<<\s*['"]?(\w+)['"]?\s*>\s*(\S+)|cat\s*>\s*(\S+)\s*<<\s*['"]?(\w+)['"]?)/i);
  if (!match) return null;
  const file = shortPath(match[2] || match[3] || '');
  const marker = match[1] || match[4] || 'EOF';
  
  const lines = cmd.split(/\r?\n/);
  const contentLines: string[] = [];
  let inContent = false;
  for (const line of lines) {
    if (inContent) {
      if (line.trim() === marker) {
        break;
      }
      contentLines.push(line);
    } else if (line.includes('<<') && line.includes(marker)) {
      inContent = true;
    }
  }
  return {
    file,
    lines: contentLines.length,
    content: contentLines.join('\n'),
  };
}

function summarizeCommand(cmd: string): string {
  const collapsed = cmd.replace(/\/Users\/yamato\//g, '~/').trim();
  
  if (collapsed.startsWith('mkdir -p ')) {
    return `mkdir -p ${shortPath(collapsed.substring(9))}`;
  }
  const heredoc = parseHeredocTarget(collapsed);
  if (heredoc) {
    return `cat << 'EOF' > ${heredoc.file}`;
  }
  if (collapsed.includes('python') && !/\s-c\s/.test(collapsed)) {
    const match = collapsed.match(/(?:^|\/|~)(?:python3|python)\s+(\S+)/);
    if (match) {
      return `python3 ${shortPath(match[1])}`;
    }
  }
  
  if (collapsed.length <= 120) return collapsed;
  return collapsed.slice(0, 117) + '...';
}

function truncateLines(text: string, maxLines = 10, keepEnd = false): string {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  
  if (keepEnd) {
    const hiddenCount = lines.length - maxLines;
    const preview = lines.slice(hiddenCount).join('\n');
    return `... first ${hiddenCount} lines hidden ...\n${preview}`;
  } else {
    const hiddenCount = lines.length - maxLines;
    const preview = lines.slice(0, maxLines).join('\n');
    return `${preview}\n... ${hiddenCount} lines truncated ...`;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function oneLine(text: string, maxLength = 180): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), maxLength);
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
  return result ? ` → ${oneLine(result, 240)}` : '';
}

function terminalLine(event: TraceEvent, title: string, body = ''): string {
  const suffix = body.trim() ? ` ${body.trim()}` : '';
  return `${statusGlyph(event.status)} **${title}**${suffix}`.trim();
}

function outputBlock(language: string, text: string): string {
  const value = text.trimEnd();
  return value ? codeBlock(language, value) : '';
}

function detailLines(detail: string, maxLines: number): string {
  const lines = detail.trimEnd().split(/\r?\n/);
  const preview = lines.slice(0, maxLines).join('\n');
  return lines.length > maxLines ? `${preview}\n...` : preview;
}

function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'go':
      return 'go';
    case 'ts':
    case 'tsx':
      return 'ts';
    case 'js':
    case 'jsx':
      return 'js';
    case 'json':
      return 'json';
    case 'md':
      return 'md';
    case 'py':
      return 'py';
    case 'sh':
      return 'sh';
    default:
      return 'txt';
  }
}

function diffNewContent(detail: string): string {
  const marker = detail.match(/\+\+\+ new\n([\s\S]*)$/);
  return marker?.[1]?.trimEnd() ?? '';
}

function diffOldNewContent(detail: string): { oldText: string; newText: string } | null {
  const match = detail.match(/--- old\n([\s\S]*?)\n\+\+\+ new\n([\s\S]*)$/);
  if (!match) return null;
  return {
    oldText: match[1].trimEnd(),
    newText: match[2].trimEnd(),
  };
}

function compactDiffHunk(detail: string): string {
  const parsed = diffOldNewContent(detail);
  if (!parsed) return diffNewContent(detail);

  const oldLines = parsed.oldText.split(/\r?\n/);
  const newLines = parsed.newText.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextBefore = oldLines.slice(Math.max(0, prefix - 2), prefix).map((line) => ` ${line}`);
  const removed = oldLines.slice(prefix, oldLines.length - suffix).map((line) => `-${line}`);
  const added = newLines.slice(prefix, newLines.length - suffix).map((line) => `+${line}`);
  const contextAfter = oldLines.slice(oldLines.length - suffix, Math.min(oldLines.length, oldLines.length - suffix + 2)).map((line) => ` ${line}`);
  const hunk = [...contextBefore, ...removed, ...added, ...contextAfter].filter((line) => line.length > 1);
  return hunk.length ? hunk.join('\n') : diffNewContent(detail);
}

function cleanDisplayName(event: TraceEvent, fallback: string): string {
  const display = event.displayName || fallback;
  return display.replace(/\s+/g, ' ').trim();
}

function shellTitle(event: TraceEvent, command: string): string {
  const displayName = cleanDisplayName(event, 'Shell');
  if (!command) return displayName === 'Shell command' ? 'Shell' : displayName;
  if (displayName === 'Shell command' || displayName === 'Shell') {
    return `Shell ${truncate(command, 140)}`;
  }
  return displayName.includes(command)
    ? displayName
    : `${displayName} ${truncate(command, 140)}`;
}

function transcript(event: TraceEvent, title: string, detail: string, language = 'txt'): RenderedTrace {
  const attachment = attachmentFor(event, detail);
  const preview = truncate(detailLines(detail || event.resultSummary || '', 24), PANEL_INLINE_LIMIT);
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

function cleanSuccessfulMetadata(text: string, event: TraceEvent): string {
  if (event.status !== 'completed') return text;

  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !/^\[current working directory\b[^\]]*\]$/i.test(trimmed) &&
        !/^\((?:Executing|Creating|Running|Using|Reading|Compiling|Listing|Writing)\b[\s\S]*\)$/i.test(trimmed);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanShellOutput(event: TraceEvent): string {
  const detail = event.resultDetail || event.resultSummary || '';
  if (/command substitution detected in shell command/i.test(detail)) {
    return '';
  }
  return cleanSuccessfulMetadata(detail, event);
}

function directoryCount(event: TraceEvent): string {
  const text = [event.resultSummary, event.resultDetail].filter(Boolean).join('\n');
  const countMatch = text.match(/Found\s+(\d+)\s+item\(s\)|Listed\s+(\d+)\s+entries|(\d+)\s+entries|(\d+)\s+files|listed\s+(\d+)/i);
  return countMatch?.[1] || countMatch?.[2] || countMatch?.[3] || countMatch?.[4] || countMatch?.[5] || 'n';
}

function writeFileAction(event: TraceEvent): string {
  const text = [event.resultSummary, event.resultDetail].filter(Boolean).join('\n');
  const accepted = text.match(/\bAccepted\s*(\(\+\d+,\s*-\d+\))?/i);
  if (accepted) {
    return accepted[1] ? `Accepted \`${accepted[1].replace(/\s+/g, ' ')}\`` : 'Accepted';
  }
  if (/created|new file|\+\+\+\s+new/i.test(text)) return 'Created';
  return 'Updated';
}

function compactToolResult(text: string, maxLength = 180): string {
  return oneLine(text, maxLength)
    .replace(/\/Users\/yamato\//g, '~/')
    .replace(/:\s*Showing up to \d+ items.*$/i, '.');
}

export class ShellRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.canonicalToolName === 'run_shell_command' || event.toolFamily === 'shell';
  }

  render(event: TraceEvent): RenderedTrace {
    const command = shellCommand(event);
    if (boolArg(event.args, 'is_background', 'isBackground')) {
      const statusText = event.status === 'completed' ? ' → Moved to background' : ' → Starting in background...';
      return {
        content: `${statusGlyph(event.status)} **Shell** ${inlineCode(summarizeCommand(command))}${statusText}`,
        density: 'row',
        flags: flags(),
      };
    }

    if (event.status === 'started') {
      return suppressed();
    }

    if (event.status === 'progress') {
      return suppressed();
    }

    const previewLines: string[] = [];
    const detail = cleanShellOutput(event);
    if (detail.trim()) {
      const attachment = attachmentFor(event, detail);
      const truncatedOutput = truncateLines(detail, 10, event.status === 'failed');
      previewLines.push(outputBlock('txt', truncatedOutput));
      if (attachment) {
        previewLines.push('↳ full output attached');
      }
    }

    const content = [
      `${statusGlyph(event.status)} **Shell** ${inlineCode(summarizeCommand(command))}`,
      ...previewLines,
    ].join('\n');

    const attachment = attachmentFor(event, detail);

    return {
      content,
      files: attachment ? [attachment] : undefined,
      density: previewLines.length > 0 ? 'panel' : 'row',
      flags: flags(),
    };
  }
}

export class FilesystemRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'filesystem';
  }

  render(event: TraceEvent): RenderedTrace {
    const canonical = event.canonicalToolName;
    const path = filePath(event);

    if (event.status === 'started' || event.status === 'progress') {
      return suppressed();
    }

    if (canonical === 'replace') {
      const added = intArg(event.args, 'added', 'lines_added');
      const removed = intArg(event.args, 'removed', 'lines_removed');
      const delta = added !== null || removed !== null ? ` (+${added ?? 0}, -${removed ?? 0})` : '';
      const hunk = event.resultDetail ? compactDiffHunk(event.resultDetail) : '';
      return {
        content: [
          `${statusGlyph(event.status)} **Edit** ${path ? inlineCode(shortPath(path)) : ''} → Accepted${delta}`,
          hunk ? outputBlock('diff', truncateLines(hunk, 12)) : '',
        ].filter(Boolean).join('\n'),
        density: hunk ? 'panel' : 'row',
        flags: flags(),
      };
    }

    if (canonical === 'write_file') {
      const action = writeFileAction(event);
      const statusText = event.status === 'completed' ? ` → ${action}` : '';
      return {
        content: `${statusGlyph(event.status)} **WriteFile** ${path ? inlineCode(shortPath(path)) : ''}${statusText}`,
        density: 'row',
        flags: flags(),
      };
    }

    if (canonical === 'read_file') {
      const detail = event.resultDetail || '';
      return {
        content: [
          `${statusGlyph(event.status)} **ReadFile** ${path ? inlineCode(shortPath(path)) : ''} → ${readFileResult(event)}`,
          detail ? outputBlock(languageForPath(path), truncateLines(detail, 10)) : '',
        ].filter(Boolean).join('\n'),
        density: detail ? 'panel' : 'row',
        flags: flags(),
      };
    }

    if (canonical === 'read_many_files') {
      const include = stringArg(event.args, 'include');
      const filesCount = event.resultSummary?.match(/Read\s+(\d+)\s+file/i)?.[1] || 'n';
      return {
        content: `${statusGlyph(event.status)} **ReadManyFiles** ${include ? inlineCode(include) : 'files'}\n↳ Read ${filesCount} file(s)`,
        density: 'card',
        flags: flags(),
      };
    }

    if (canonical === 'list_directory') {
      const dir = stringArg(event.args, 'dir_path', 'path');
      const count = directoryCount(event);
      return {
        content: `${statusGlyph(event.status)} **ReadFolder** ${dir ? inlineCode(shortPath(dir)) : 'directory'} → Found ${count} item(s)`,
        density: 'row',
        flags: flags(),
      };
    }

    return {
      content: `${statusGlyph(event.status)} **${event.displayName || event.toolName}** ${path ? inlineCode(shortPath(path)) : ''}${resultSuffix(event)}`,
      density: 'row',
      flags: flags(),
    };
  }
}

export class SearchRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'search';
  }

  render(event: TraceEvent): RenderedTrace {
    if (event.status === 'started' || event.status === 'progress') {
      return suppressed();
    }

    const canonical = event.canonicalToolName;
    const query = searchTarget(event);
    const dir = stringArg(event.args, 'dir_path', 'path');

    if (canonical === 'grep_search') {
      const matchCount = event.resultSummary?.match(/Found\s+(\d+)\s+matches/i)?.[1] || 'n';
      const dirText = dir ? ` in ${inlineCode(shortPath(dir))}` : '';
      return {
        content: `${statusGlyph(event.status)} **SearchText** '${query}'${dirText} → Found ${matchCount} matches`,
        density: 'row',
        flags: flags(),
      };
    }

    if (canonical === 'glob') {
      const fileCount = event.resultSummary?.match(/Found\s+(\d+)\s+files/i)?.[1] || 'n';
      return {
        content: `${statusGlyph(event.status)} **Glob** ${query ? inlineCode(query) : 'pattern'} → Found ${fileCount} files`,
        density: 'row',
        flags: flags(),
      };
    }

    const within = dir ? ` within ${inlineCode(shortPath(dir))}` : '';
    return {
      content: `${statusGlyph(event.status)} **${event.displayName || event.toolName}** ${query ? inlineCode(query) : ''}${within}${resultSuffix(event)}`,
      density: 'row',
      flags: flags(),
    };
  }
}

export class WebRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'web';
  }

  render(event: TraceEvent): RenderedTrace {
    const canonical = event.canonicalToolName;
    const query = stringArg(event.args, 'query', 'prompt', 'url', 'Url');

    if (canonical === 'google_web_search') {
      if (event.status === 'started' || event.status === 'progress') {
        return {
          content: `${statusGlyph(event.status)} **GoogleSearch**  Searching the web for: \`"${oneLine(query, 120)}"\``,
          density: 'row',
          flags: flags(),
        };
      }
      
      const resultText = event.status === 'completed'
        ? `↳ Search results for \`"${oneLine(query, 120)}"\` returned.`
        : `↳ Failed or cancelled search.`;

      return {
        content: `${statusGlyph(event.status)} **GoogleSearch**  Searching the web for: \`"${oneLine(query, 120)}"\`\n${resultText}`,
        density: 'row',
        flags: flags(),
      };
    }

    if (canonical === 'web_fetch') {
      const target = query ? inlineCode(oneLine(query, 160)) : 'prompt';
      const summary = event.status === 'completed'
        ? compactToolResult(event.resultSummary || 'Content retrieved')
        : event.status === 'failed'
          ? compactToolResult(event.resultSummary || 'Fetch failed')
          : '';
      return {
        content: [
          `${statusGlyph(event.status)} **Web Fetch** ${target}`,
          summary ? `↳ ${summary}` : '',
        ].filter(Boolean).join('\n'),
        density: summary ? 'card' : 'row',
        flags: flags(),
      };
    }

    if (event.status === 'started' || event.status === 'progress') {
      return {
        content: `${statusGlyph(event.status)} **WebFetch** ${query ? inlineCode(oneLine(query, 160)) : ''}`.trim(),
        density: 'row',
        flags: flags(),
      };
    }

    const title = event.displayName || 'WebFetch';
    return {
      content: `${statusGlyph(event.status)} **${title}** ${query ? inlineCode(query) : ''}${resultSuffix(event, 'Content retrieved')}`,
      density: 'row',
      flags: flags(),
    };
  }
}

export class PlanningRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    const isUpdateTopic = event.canonicalToolName === 'update_topic' ||
      event.toolName === 'update_topic' ||
      !!event.displayName?.toLowerCase().includes('update topic') ||
      !!event.displayName?.toLowerCase().includes('updatetopic');
    return event.toolFamily === 'planning' || event.type === 'phase_started' || isUpdateTopic;
  }

  render(event: TraceEvent): RenderedTrace {
    const displayName = event.displayName || '';
    if (/update\s+tactical\s+intent|tactical\s+intent/i.test(displayName)) {
      return suppressed();
    }

    const isUpdateTopic = event.canonicalToolName === 'update_topic' ||
      event.toolName === 'update_topic' ||
      !!displayName.toLowerCase().includes('update topic') ||
      !!displayName.toLowerCase().includes('updatetopic');

    if (isUpdateTopic) {
      if (event.status === 'started' || event.status === 'progress') {
        return suppressed();
      }
      const title = stringArg(event.args, 'topic', 'title') ||
        event.resultSummary?.match(/Topic:\s*([^\n]+)/)?.[1] ||
        event.displayName?.replace(/^Update\s+topic\s+to\s*/i, '') ||
        '';

      let summaryLine = stringArg(event.args, 'summary');
      if (!summaryLine) {
        const summaryMatch = event.resultSummary?.match(/Summary:\s*([^\n]+)/i);
        if (summaryMatch) {
          summaryLine = summaryMatch[1];
        }
      }
      if (summaryLine) {
        summaryLine = summaryLine.trim().split(/\r?\n/)[0];
        summaryLine = summaryLine.replace(/^(Strategy|Intent|Summary):\s*/i, '');
        summaryLine = oneLine(summaryLine, 120);
      }
      
      const content = summaryLine
        ? `**${oneLine(title, 120)}:** ${summaryLine}`
        : `**${oneLine(title, 120)}**`;

      return {
        content: title ? content : '',
        density: 'row',
        suppressed: !title,
        flags: flags(),
      };
    }

    const summary = event.resultSummary || compactArgs(event.args, ['title', 'summary', 'reason', 'taskId']);
    if (event.type === 'phase_started') {
      return suppressed();
    }
    return card(event, event.displayName || 'Planning', summary ? [summary] : []);
  }
}

export class McpRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'mcp';
  }

  render(event: TraceEvent): RenderedTrace {
    if (event.canonicalToolName === 'activate_skill') {
      const skillName = stringArg(event.args, 'name', 'skill', 'skillName');
      const label = skillName ? inlineCode(skillName) : 'skill';
      const summary = event.status === 'completed'
        ? compactToolResult(event.resultSummary || 'Skill activated')
        : event.status === 'failed'
          ? compactToolResult(event.resultSummary || 'Activation failed')
          : '';
      return {
        content: [
          `${statusGlyph(event.status)} **Activate Skill** ${label}`,
          summary ? `↳ ${summary}` : '',
        ].filter(Boolean).join('\n'),
        density: summary ? 'card' : 'row',
        flags: flags(),
      };
    }

    const rawToolName = event.toolName || '';
    let serverName = '';
    if (rawToolName.includes('/')) {
      serverName = rawToolName.split('/')[0];
    } else if (rawToolName.startsWith('mcp_')) {
      const parts = rawToolName.split('_');
      if (parts.length > 1) {
        serverName = parts[1];
      }
    }
    if (!serverName) serverName = 'mcp';

    const args = compactArgs(event.args, ['namespace', 'query', 'name', 'path', 'uri', 'prompt']);
    if (event.status === 'started' || event.status === 'progress') {
      return {
        content: `${statusGlyph(event.status)} **MCPTool** (${serverName}) ${args ? `{${args}}` : ''}`,
        density: 'row',
        flags: flags(),
      };
    }

    const resultText = event.resultSummary ? ` → ${oneLine(event.resultSummary, 120)}` : '';
    return {
      content: `${statusGlyph(event.status)} **MCPTool** (${serverName}) ${args ? `{${args}}` : ''}${resultText}`,
      density: 'row',
      flags: flags(),
    };
  }
}

export class InteractionRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'interaction';
  }

  render(event: TraceEvent): RenderedTrace {
    if (event.status === 'started' || event.status === 'progress') {
      return suppressed();
    }

    const prompt = stringArg(event.args, 'prompt', 'question');
    return card(event, event.displayName || 'AskUser', [prompt ? inlineCode(prompt) : '? clarification needed']);
  }
}

export class GenericFallbackRenderer implements ToolRenderer {
  canRender(): boolean {
    return true;
  }

  render(event: TraceEvent): RenderedTrace {
    const title = event.displayName || event.toolName || 'Tool';
    if (/update\s+tactical\s+intent|tactical\s+intent/i.test(title)) {
      return suppressed();
    }

    const args = compactArgs(event.args, Object.keys(event.args));
    if (event.status === 'started' || event.status === 'progress') {
      return {
        content: `${statusGlyph(event.status)} **${title}** ${args ? `\`{${args}}\`` : ''}`,
        density: 'row',
        flags: flags(),
      };
    }

    const result = event.resultSummary ? ` → ${oneLine(event.resultSummary, 120)}` : '';
    return {
      content: `${statusGlyph(event.status)} **${title}** ${args ? `\`{${args}}\`` : ''}${result}`,
      density: 'row',
      flags: flags(),
    };
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
