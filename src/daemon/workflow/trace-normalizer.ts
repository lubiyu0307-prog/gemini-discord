import type { TraceEvent, TraceEventType } from './trace-event.js';
import { resolveToolEntry } from './tool-registry.js';
import { redactTraceArgs, redactTraceResult, redactTraceText, redactFilePath } from './redaction.js';
import { runtimeStore } from '../runtime.js';
import { isExplicitSendToCurrentThread } from './policy.js';


function stringifyTraceValue(value: unknown, toolName?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  if (typeof value === 'object' && toolName === 'run_shell_command') {
    const resObj = value as Record<string, unknown>;
    const exitCode = resObj['exitCode'] ?? resObj['exit_code'] ?? resObj['code'];
    const stdout = String(resObj['stdout'] ?? resObj['output'] ?? '');
    const stderr = String(resObj['stderr'] ?? '');
    const lines: string[] = [];
    if (exitCode !== undefined && String(exitCode) !== '0') lines.push(`exit code: ${String(exitCode)}`);
    if (stdout && stderr) {
      lines.push(`stdout:\n${stdout}`);
    } else if (stdout) {
      lines.push(stdout);
    }
    if (stderr) lines.push(`stderr:\n${stderr}`);
    return lines.join('\n');
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function normalizeToolName(value: string): string {
  const withoutServerSuffix = value.replace(/\s*\([^)]*MCP Server\)\s*$/i, '').trim();
  if (withoutServerSuffix === 'discord_message' || withoutServerSuffix.endsWith('/discord_message')) {
    return 'discord_message';
  }
  return withoutServerSuffix || value;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractContentBlockText(value: unknown): string {
  const record = recordValue(value);
  if (!record) return typeof value === 'string' ? value : '';

  if (typeof record['text'] === 'string') return record['text'];
  if (typeof record['thought'] === 'string') return record['thought'];

  const content = record['content'];
  if (content && typeof content === 'object') {
    return extractContentBlockText(content);
  }

  const resource = record['resource'];
  if (resource && typeof resource === 'object') {
    return extractContentBlockText(resource);
  }

  return '';
}

function extractToolContentText(value: unknown): string {
  if (!Array.isArray(value)) return '';

  return value
    .map((entry) => {
      const record = recordValue(entry);
      if (!record) return '';

      if (record['type'] === 'diff') {
        const path = firstString(record['path']) ?? 'diff';
        const oldText = typeof record['oldText'] === 'string' ? record['oldText'] : '';
        const newText = typeof record['newText'] === 'string' ? record['newText'] : '';
        return [
          `Diff: ${path}`,
          oldText ? `--- old\n${oldText}` : '',
          newText ? `+++ new\n${newText}` : '',
        ].filter(Boolean).join('\n');
      }

      if (record['type'] === 'terminal') {
        const terminalId = firstString(record['terminalId']);
        return terminalId ? `Terminal output: ${terminalId}` : 'Terminal output';
      }

      if (record['type'] === 'content') {
        return extractContentBlockText(record['content']);
      }

      return extractContentBlockText(record);
    })
    .filter(Boolean)
    .join('\n\n');
}

function isInternalNarrationText(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  return lines.every((line) =>
    /^\[current working directory\b[^\]]*\]$/i.test(line) ||
    /^\((?:Executing|Creating|Running|Using|Reading|Compiling|Listing)\b[\s\S]*\)$/i.test(line)
  );
}

function summarizePlanEntries(entries: unknown): string | null {
  if (!Array.isArray(entries)) return null;

  const lines = entries
    .map((entry) => {
      const record = recordValue(entry);
      if (!record) return '';
      const content = firstString(record['content']);
      if (!content) return '';
      const status = firstString(record['status']);
      return status ? `${status}: ${content}` : content;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

function resolveAcpStatus(
  sessionUpdate: string,
  rawStatus: unknown,
  hasResultText: boolean,
): { type: TraceEventType; status: TraceEvent['status'] } {
  if (rawStatus === 'failed') return { type: 'tool_failed', status: 'failed' };
  if (rawStatus === 'cancelled') return { type: 'tool_cancelled', status: 'cancelled' };
  if (rawStatus === 'completed' || hasResultText) return { type: 'tool_completed', status: 'completed' };
  if (sessionUpdate === 'tool_call_update') return { type: 'tool_progress', status: 'progress' };
  return { type: 'tool_started', status: 'started' };
}

function resolveDuration(
  id: string,
  type: TraceEventType,
  timestamp: number,
  activeToolTimers: Map<string, number>,
): number | null {
  if (!id) return null;

  if (type === 'tool_started') {
    if (!activeToolTimers.has(id)) {
      activeToolTimers.set(id, timestamp);
    }
    return null;
  }

  const start = activeToolTimers.get(id);
  if (!start) return null;

  if (type === 'tool_completed' || type === 'tool_failed' || type === 'tool_cancelled') {
    activeToolTimers.delete(id);
  }

  return timestamp - start;
}

function familyFromAcpKind(kind: string): string {
  switch (kind) {
    case 'execute':
      return 'shell';
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
      return 'filesystem';
    case 'search':
      return 'search';
    case 'fetch':
      return 'web';
    case 'think':
    case 'switch_mode':
      return 'planning';
    default:
      return 'unknown';
  }
}

function resolveTopLevelToolEntry(payload: Record<string, unknown>): ReturnType<typeof resolveToolEntry> {
  const rawInput = recordValue(payload['rawInput']);
  const rawToolName = firstString(
    rawInput?.['name'],
    rawInput?.['toolName'],
    rawInput?.['tool_name'],
  );
  if (rawToolName) return resolveToolEntry(normalizeToolName(rawToolName));

  const kind = firstString(payload['kind']) ?? 'other';
  const title = firstString(payload['title']) ?? kind;
  if (/^Searching\s+the\s+web\s+for:/i.test(title)) {
    return resolveToolEntry('google_web_search');
  }
  if (/^(?:ReadFolder|ListDirectory)\b/i.test(title) || (kind === 'read' && /^[.~/(]|^[A-Za-z]:[\\/]/.test(title))) {
    return {
      canonical: 'list_directory',
      displayName: 'ReadFolder',
      family: 'filesystem',
    };
  }
  if (/^ReadFile\b/i.test(title)) {
    return resolveToolEntry('read_file');
  }
  return {
    canonical: `acp_${kind}`,
    displayName: title,
    family: familyFromAcpKind(kind),
  };
}

function rawInputArgs(rawInput: unknown): Record<string, unknown> {
  const record = recordValue(rawInput);
  if (!record) return {};

  const args = recordValue(record['args']) ?? recordValue(record['arguments']);
  if (args) return args;
  if (firstString(record['name'], record['toolName'], record['tool_name'])) {
    const rest = { ...record };
    delete rest['name'];
    delete rest['toolName'];
    delete rest['tool_name'];
    return rest;
  }
  return record;
}

function argsWithTitleCommand(args: Record<string, unknown>, toolEntry: ReturnType<typeof resolveToolEntry>, title: string): Record<string, unknown> {
  if (toolEntry.family !== 'shell') return args;
  if (firstString(args['command'], args['commandLine'], args['CommandLine'])) return args;

  const command = title
    .replace(/^Shell(?:\s+command)?\s*/i, '')
    .trim();
  return command ? { ...args, command } : args;
}

function argsWithTitleMetadata(args: Record<string, unknown>, toolEntry: ReturnType<typeof resolveToolEntry>, title: string): Record<string, unknown> {
  const withCommand = argsWithTitleCommand(args, toolEntry, title);
  if (toolEntry.canonical === 'list_directory' && !firstString(withCommand['dir_path'], withCommand['path'])) {
    const dir = title.replace(/^(?:ReadFolder|ListDirectory)\s*/i, '').trim();
    return dir ? { ...withCommand, dir_path: dir } : withCommand;
  }
  if (toolEntry.canonical === 'read_file' && !firstString(withCommand['file_path'], withCommand['path'])) {
    const file = title.replace(/^ReadFile\s*/i, '').trim();
    return file ? { ...withCommand, file_path: file } : withCommand;
  }
  if (toolEntry.canonical !== 'google_web_search') return withCommand;
  if (firstString(withCommand['query'], withCommand['prompt'])) return withCommand;

  const match = title.match(/^Searching\s+the\s+web\s+for:\s*["“]?(.+?)["”]?\s*$/i);
  return match?.[1] ? { ...withCommand, query: match[1] } : withCommand;
}

export function normalizeAcpUpdate(
  sessionUpdate: string,
  updatePayload: Record<string, unknown>,
  activeToolTimers: Map<string, number>,
): TraceEvent | null {
  const timestamp = Date.now();

  if (sessionUpdate === 'plan') {
    let summary = 'Planning next steps...';
    const entriesSummary = summarizePlanEntries(updatePayload['entries']);
    const planVal = updatePayload['plan'];
    if (entriesSummary) {
      summary = entriesSummary;
    } else if (planVal && typeof planVal === 'string') {
      summary = planVal;
    } else if (planVal && typeof planVal === 'object') {
      const steps = (planVal as Record<string, unknown>)['steps'];
      if (Array.isArray(steps)) {
        summary = steps.map(s => String(s)).join('\n');
      } else {
        summary = JSON.stringify(planVal);
      }
    } else {
      const thoughtVal = updatePayload['thought'] || updatePayload['agent_thought_chunk'];
      if (thoughtVal && typeof thoughtVal === 'string') {
        summary = thoughtVal;
      }
    }

    const redacted = redactTraceResult(summary, 500);

    return {
      type: 'phase_started',
      timestamp,
      toolName: null,
      canonicalToolName: null,
      displayName: null,
      toolFamily: 'planning',
      args: {},
      status: 'started',
      durationMs: null,
      resultSummary: redacted.summary,
      resultDetail: redacted.summary,
      artifactRef: null,
      redactionMetadata: {
        fieldsRedacted: [],
        truncated: redacted.truncated,
      },
      raw: updatePayload,
    };
  }

  if (sessionUpdate === 'tool_call' || sessionUpdate === 'tool_call_update') {
    const toolCall = updatePayload['toolCall'] as Record<string, unknown> | undefined;
    if (!toolCall) {
      const id = firstString(updatePayload['toolCallId']) ?? '';
      const title = firstString(updatePayload['title']) ?? '';
      if (!id || !title) return null;

      const toolEntry = resolveTopLevelToolEntry(updatePayload);
      const rawArgs = argsWithTitleMetadata(rawInputArgs(updatePayload['rawInput']), toolEntry, title);
      const { redacted: redactedArgs, fieldsRedacted } = redactTraceArgs(rawArgs);
      const contentText = extractToolContentText(updatePayload['content']);
      const outputText = stringifyTraceValue(
        updatePayload['rawOutput'],
        toolEntry.family === 'shell' ? 'run_shell_command' : toolEntry.canonical,
      );
      const visibleContentText = toolEntry.family === 'shell' && isInternalNarrationText(contentText) ? '' : contentText;
      const resultText = [visibleContentText, outputText].filter(Boolean).join('\n\n');
      const metadataOnlyShellUpdate = toolEntry.family === 'shell' && Boolean(contentText) && !visibleContentText && !outputText;
      const rawStatus = metadataOnlyShellUpdate ? 'in_progress' : updatePayload['status'];
      const statusInfo = resolveAcpStatus(sessionUpdate, rawStatus, Boolean(resultText));
      const durationMs = resolveDuration(id, statusInfo.type, timestamp, activeToolTimers);
      const redactedResult = redactTraceResult(resultText, 200);
      const redactedDetail = redactTraceText(resultText, 12000);

      const isDiscordMessage = toolEntry.canonical === 'discord_message';
      let policySuppressed = false;
      let intercepted = false;
      if (isDiscordMessage) {
        const targetChannelId = String(rawArgs['channel_id'] || rawArgs['channelId'] || '');
        const activeRun = targetChannelId ? runtimeStore.activeWorkflowRuns.get(targetChannelId) : null;
        if (activeRun) {
          if (!isExplicitSendToCurrentThread(activeRun.userContent)) {
            policySuppressed = true;
          }
        }
        const rawOutput = updatePayload['rawOutput'];
        if (rawOutput && typeof rawOutput === 'object' && (rawOutput as any).intercepted === true) {
          intercepted = true;
          policySuppressed = true;
        }
      }

      return {
        type: statusInfo.type,
        timestamp,
        toolName: toolEntry.canonical,
        canonicalToolName: toolEntry.canonical,
        displayName: toolEntry.displayName,
        toolFamily: toolEntry.family,
        args: redactedArgs,
        status: statusInfo.status,
        durationMs,
        resultSummary: redactedResult.summary || null,
        resultDetail: redactedDetail.text || redactedResult.summary || null,
        policySuppressed,
        intercepted,
        artifactRef: null,
        redactionMetadata: {
          fieldsRedacted,
          truncated: redactedResult.truncated || redactedDetail.truncated,
        },
        raw: updatePayload,
      };

    }

    const id = typeof toolCall['id'] === 'string' ? toolCall['id'] : '';
    const name = typeof toolCall['name'] === 'string' ? normalizeToolName(toolCall['name']) : '';
    if (!name) return null;

    const toolEntry = resolveToolEntry(name);

    // Extract args
    const rawArgs = (toolCall['arguments'] ?? toolCall['args'] ?? {}) as Record<string, unknown>;
    const { redacted: redactedArgs, fieldsRedacted } = redactTraceArgs(rawArgs);

    let type: TraceEventType = 'tool_started';
    let status: TraceEvent['status'] = 'started';
    let durationMs: number | null = null;
    let resultSummary: string | null = null;
    let resultDetail: string | null = null;
    let truncated = false;

    // Check status based on presence of progress, result, or error
    const progress = toolCall['progress'];
    const result = toolCall['result'] ?? toolCall['response'];
    const error = toolCall['error'] ?? toolCall['errorMessage'];

    if (error !== undefined && error !== null) {
      type = 'tool_failed';
      status = 'failed';

      const start = activeToolTimers.get(id);
      if (start) {
        durationMs = timestamp - start;
        activeToolTimers.delete(id);
      }

      const errorStr = stringifyTraceValue(error, name);
      const redactedError = redactTraceResult(errorStr, 200);
      const redactedErrorDetail = redactTraceText(errorStr, 12000);
      resultSummary = redactedError.summary;
      resultDetail = redactedErrorDetail.text || resultSummary;
      truncated = redactedError.truncated || redactedErrorDetail.truncated;
    } else if (result !== undefined && result !== null) {
      type = 'tool_completed';
      status = 'completed';

      const start = activeToolTimers.get(id);
      if (start) {
        durationMs = timestamp - start;
        activeToolTimers.delete(id);
      }

      const resultStr = stringifyTraceValue(result, name);
      
      const redactedResult = redactTraceResult(resultStr, 200);
      const redactedDetail = redactTraceText(resultStr, 12000);
      resultSummary = redactedResult.summary;
      resultDetail = redactedDetail.text || resultSummary;
      truncated = redactedResult.truncated || redactedDetail.truncated;
    } else if (sessionUpdate === 'tool_call_update' || (progress !== undefined && progress !== null)) {
      type = 'tool_progress';
      status = 'progress';
      
      const start = activeToolTimers.get(id);
      if (start) {
        durationMs = timestamp - start;
      }

      const progressStr = stringifyTraceValue(progress, name);
      const redactedProgress = redactTraceResult(progressStr, 200);
      const redactedProgressDetail = redactTraceText(progressStr, 12000);
      resultSummary = redactedProgress.summary;
      resultDetail = redactedProgressDetail.text || resultSummary;
      truncated = redactedProgress.truncated || redactedProgressDetail.truncated;
    } else {
      type = 'tool_started';
      status = 'started';
      activeToolTimers.set(id, timestamp);
    }

    // Attempt to extract artifact ref
    let artifactRef: string | null = null;
    if (name === 'write_file' || name === 'replace' || name === 'write_to_file' || name === 'replace_file_content') {
      const pathVal = firstString(rawArgs['file_path'], rawArgs['path'], rawArgs['TargetFile'], rawArgs['filePath']);
      if (typeof pathVal === 'string') {
        artifactRef = redactFilePath(pathVal);
      }
    }

    const isDiscordMessage = name === 'discord_message' || toolEntry.canonical === 'discord_message';
    let policySuppressed = false;
    let intercepted = false;
    if (isDiscordMessage) {
      const targetChannelId = String(rawArgs['channel_id'] || rawArgs['channelId'] || '');
      const activeRun = targetChannelId ? runtimeStore.activeWorkflowRuns.get(targetChannelId) : null;
      if (activeRun) {
        if (!isExplicitSendToCurrentThread(activeRun.userContent)) {
          policySuppressed = true;
        }
      }
      if (result && typeof result === 'object' && (result as any).intercepted === true) {
        intercepted = true;
        policySuppressed = true;
      }
    }

    return {
      type,
      timestamp,
      toolName: name,
      canonicalToolName: toolEntry.canonical,
      displayName: toolEntry.displayName,
      toolFamily: toolEntry.family,
      args: redactedArgs,
      status,
      durationMs,
      resultSummary,
      resultDetail,
      policySuppressed,
      intercepted,
      artifactRef,
      redactionMetadata: {
        fieldsRedacted,
        truncated,
      },
      raw: updatePayload,
    };

  }

  return null;
}
