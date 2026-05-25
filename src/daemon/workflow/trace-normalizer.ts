import type { TraceEvent, TraceEventType } from './trace-event.js';
import { resolveToolEntry } from './tool-registry.js';
import { redactTraceArgs, redactTraceResult, redactTraceText, redactFilePath } from './redaction.js';

function stringifyTraceValue(value: unknown, toolName?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  if (typeof value === 'object' && toolName === 'run_shell_command') {
    const resObj = value as Record<string, unknown>;
    const exitCode = resObj['exitCode'] ?? resObj['exit_code'] ?? resObj['code'];
    const stdout = String(resObj['stdout'] ?? resObj['output'] ?? '');
    const stderr = String(resObj['stderr'] ?? '');
    const lines: string[] = [];
    if (exitCode !== undefined) lines.push(`exit code: ${String(exitCode)}`);
    if (stdout) lines.push(`stdout:\n${stdout}`);
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

export function normalizeAcpUpdate(
  sessionUpdate: string,
  updatePayload: Record<string, unknown>,
  activeToolTimers: Map<string, number>,
): TraceEvent | null {
  const timestamp = Date.now();

  if (sessionUpdate === 'plan') {
    let summary = 'Planning next steps...';
    const planVal = updatePayload['plan'];
    if (planVal && typeof planVal === 'string') {
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
    if (!toolCall) return null;

    const id = typeof toolCall['id'] === 'string' ? toolCall['id'] : '';
    const name = typeof toolCall['name'] === 'string' ? toolCall['name'] : '';
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
