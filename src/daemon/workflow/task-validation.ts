const VAGUE_SINGLE_WORDS = new Set([
  'do',
  'fix',
  'help',
  'issue',
  'job',
  'run',
  'task',
  'test',
  'thing',
  'this',
  'that',
  'todo',
  'work',
]);

export class WorkflowTaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowTaskValidationError';
  }
}

export function normalizeWorkflowTaskSummary(task: string): string {
  return task.trim().replace(/\s+/g, ' ');
}

export function validateWorkflowTaskSummary(task: string): string {
  const normalized = normalizeWorkflowTaskSummary(task);
  if (!normalized) {
    throw new WorkflowTaskValidationError('Workflow task is required. Please provide a specific task.');
  }

  const tokens = normalized.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  if (tokens.length === 1) {
    const token = tokens[0].toLowerCase();
    if (token.length < 4 || VAGUE_SINGLE_WORDS.has(token)) {
      throw new WorkflowTaskValidationError(
        `Workflow task "${normalized}" is too vague. Please provide a specific task, for example "fix CI failure" or "run tests".`,
      );
    }
  }

  return normalized;
}
