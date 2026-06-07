import { describe, expect, it } from 'vitest';
import {
  validateWorkflowTaskSummary,
  WorkflowTaskValidationError,
} from '../src/daemon/workflow/task-validation.js';

describe('workflow task validation', () => {
  it('rejects low-information single-token tasks', () => {
    expect(() => validateWorkflowTaskSummary('job')).toThrow(WorkflowTaskValidationError);
    expect(() => validateWorkflowTaskSummary('run')).toThrow('too vague');
    expect(() => validateWorkflowTaskSummary('')).toThrow('required');
  });

  it('accepts specific workflow tasks and normalizes whitespace', () => {
    expect(validateWorkflowTaskSummary('fix CI')).toBe('fix CI');
    expect(validateWorkflowTaskSummary('  run   tests  ')).toBe('run tests');
  });
});
