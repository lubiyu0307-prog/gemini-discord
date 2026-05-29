const WORKFLOW_FINAL_MARKER = '\u2726';

export function formatWorkflowFinalDisplay(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith(WORKFLOW_FINAL_MARKER)) {
    return trimmed.replace(/^\u2726\s*/, `${WORKFLOW_FINAL_MARKER} `);
  }

  return `${WORKFLOW_FINAL_MARKER} ${trimmed}`;
}
