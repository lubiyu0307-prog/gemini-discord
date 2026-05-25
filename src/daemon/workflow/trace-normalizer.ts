import type { TraceEvent, TraceEventType } from './trace-event.js';
import { resolveToolEntry } from './tool-registry.js';
import { redactTraceArgs, redactTraceResult, redactFilePath } from './redaction.js';

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
    const rawArgs = (toolCall['arguments'] || toolCall['args'] || {}) as Record<string, unknown>;
    const { redacted: redactedArgs, fieldsRedacted } = redactTraceArgs(rawArgs);

    let type: TraceEventType = 'tool_started';
    let status: TraceEvent['status'] = 'started';
    let durationMs: number | null = null;
    let resultSummary: string | null = null;
    let truncated = false;

    // Check status based on presence of progress, result, or error
    const progress = toolCall['progress'];
    const result = toolCall['result'] || toolCall['response'];
    const error = toolCall['error'] || toolCall['errorMessage'];

    if (sessionUpdate === 'tool_call_update' || (progress !== undefined && progress !== null)) {
      type = 'tool_progress';
      status = 'progress';
      
      const start = activeToolTimers.get(id);
      if (start) {
        durationMs = timestamp - start;
      }

      const progressStr = typeof progress === 'string' ? progress : JSON.stringify(progress);
      const redactedProgress = redactTraceResult(progressStr, 200);
      resultSummary = redactedProgress.summary;
      truncated = redactedProgress.truncated;
    } else if (result !== undefined && result !== null) {
      type = 'tool_completed';
      status = 'completed';

      const start = activeToolTimers.get(id);
      if (start) {
        durationMs = timestamp - start;
        activeToolTimers.delete(id);
      }

      // Format result
      let resultStr = '';
      if (typeof result === 'string') {
        resultStr = result;
      } else if (typeof result === 'object') {
        if (name === 'run_shell_command') {
          const resObj = result as Record<string, unknown>;
          const exitCode = resObj['exitCode'];
          const stdout = String(resObj['stdout'] || '');
          const stderr = String(resObj['stderr'] || '');
          resultStr = `exit code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
        } else {
          resultStr = JSON.stringify(result);
        }
      }
      
      const redactedResult = redactTraceResult(resultStr, 200);
      resultSummary = redactedResult.summary;
      truncated = redactedResult.truncated;
    } else if (error !== undefined && error !== null) {
      type = 'tool_failed';
      status = 'failed';

      const start = activeToolTimers.get(id);
      if (start) {
        durationMs = timestamp - start;
        activeToolTimers.delete(id);
      }

      const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
      const redactedError = redactTraceResult(errorStr, 200);
      resultSummary = redactedError.summary;
      truncated = redactedError.truncated;
    } else {
      type = 'tool_started';
      status = 'started';
      activeToolTimers.set(id, timestamp);
    }

    // Attempt to extract artifact ref
    let artifactRef: string | null = null;
    if (name === 'write_file' || name === 'replace' || name === 'write_to_file' || name === 'replace_file_content') {
      const pathVal = rawArgs['path'] || rawArgs['TargetFile'] || rawArgs['filePath'] || rawArgs['TargetFile'];
      if (typeof pathVal === 'string') {
        // Redact using same path rules
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
