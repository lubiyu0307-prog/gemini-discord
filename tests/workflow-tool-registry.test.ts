import { describe, it, expect } from 'vitest';
import { resolveToolEntry, isBuiltinTool, isMcpTool } from '../src/daemon/workflow/tool-registry.js';

describe('tool registry', () => {
  it('identifies built-in tools correctly', () => {
    expect(isBuiltinTool('run_shell_command')).toBe(true);
    expect(isBuiltinTool('read_file')).toBe(true);
    expect(isBuiltinTool('not_a_tool')).toBe(false);
  });

  it('identifies MCP tools correctly', () => {
    expect(isMcpTool('gitserver/git-status')).toBe(true);
    expect(isMcpTool('mcp_local_tool')).toBe(true);
    expect(isMcpTool('run_shell_command')).toBe(false);
  });

  it('resolves built-in tools to correct canonical names and families', () => {
    const shell = resolveToolEntry('run_shell_command');
    expect(shell).toEqual({
      canonical: 'run_shell_command',
      displayName: 'Shell',
      family: 'shell',
    });

    const readFile = resolveToolEntry('read_file');
    expect(readFile).toEqual({
      canonical: 'read_file',
      displayName: 'ReadFile',
      family: 'filesystem',
    });

    const googleSearch = resolveToolEntry('google_web_search');
    expect(googleSearch).toEqual({
      canonical: 'google_web_search',
      displayName: 'GoogleSearch',
      family: 'web',
    });
  });

  it('resolves unknown tools to a generic fallback entry', () => {
    const unknown = resolveToolEntry('some_mysterious_tool');
    expect(unknown).toEqual({
      canonical: 'some_mysterious_tool',
      displayName: 'some_mysterious_tool',
      family: 'unknown',
    });
  });

  it('resolves MCP tools with slash to clean PascalCase display name and mcp family', () => {
    const mcpTool1 = resolveToolEntry('github/create-issue');
    expect(mcpTool1).toEqual({
      canonical: 'github/create-issue',
      displayName: 'CreateIssue',
      family: 'mcp',
    });

    const mcpTool2 = resolveToolEntry('sqlite-db/run_query');
    expect(mcpTool2).toEqual({
      canonical: 'sqlite-db/run_query',
      displayName: 'RunQuery',
      family: 'mcp',
    });
  });
});
