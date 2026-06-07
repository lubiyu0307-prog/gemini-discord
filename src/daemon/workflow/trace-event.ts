export type TraceEventType =
  | 'run_started'
  | 'run_status'
  | 'phase_started'
  | 'tool_started'
  | 'tool_progress'
  | 'tool_completed'
  | 'tool_failed'
  | 'tool_cancelled'
  | 'shell_output_summary'
  | 'file_edit_summary'
  | 'artifact_created'
  | 'final_response';

export interface TraceEvent {
  type: TraceEventType;
  timestamp: number;
  toolName: string | null;          // raw tool name from ACP
  canonicalToolName: string | null;  // normalized canonical name
  displayName: string | null;        // human-readable display name
  toolFamily: string | null;         // grouping: 'filesystem', 'search', 'shell', 'web', 'planning', 'mcp', 'unknown'
  args: Record<string, unknown>;     // safe compact args (redacted)
  status: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
  durationMs: number | null;
  resultSummary: string | null;      // short safe result text
  resultDetail?: string | null;      // longer safe result text for panels/attachments
  artifactRef: string | null;        // optional file/log/diff reference
  policySuppressed?: boolean;        // true if tool execution was suppressed by turn policy (e.g. intercepted discord_message)
  intercepted?: boolean;             // true if tool call was captured as final response candidate instead of posting to Discord
  redactionMetadata: {
    fieldsRedacted: string[];
    truncated: boolean;
  };
  raw?: Record<string, unknown>;     // original ACP payload (debug only, not rendered)
}
