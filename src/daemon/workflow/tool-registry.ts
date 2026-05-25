export interface ToolRegistryEntry {
  canonical: string;
  displayName: string;
  family: string;
}

// Built-in Gemini CLI tools
const BUILTIN_TOOL_REGISTRY: Record<string, ToolRegistryEntry> = {
  'run_shell_command':      { canonical: 'run_shell_command',      displayName: 'Shell',          family: 'shell' },
  'grep_search':            { canonical: 'grep_search',            displayName: 'SearchText',     family: 'search' },
  'read_file':              { canonical: 'read_file',              displayName: 'ReadFile',       family: 'filesystem' },
  'read_many_files':        { canonical: 'read_many_files',        displayName: 'ReadManyFiles',  family: 'filesystem' },
  'replace':                { canonical: 'replace',                displayName: 'Edit',           family: 'filesystem' },
  'write_file':             { canonical: 'write_file',             displayName: 'WriteFile',      family: 'filesystem' },
  'list_directory':         { canonical: 'list_directory',         displayName: 'ListDirectory',  family: 'filesystem' },
  'glob':                   { canonical: 'glob',                   displayName: 'Glob',           family: 'search' },
  'google_web_search':      { canonical: 'google_web_search',      displayName: 'GoogleSearch',   family: 'web' },
  'web_fetch':              { canonical: 'web_fetch',              displayName: 'WebFetch',       family: 'web' },
  'ask_user':               { canonical: 'ask_user',               displayName: 'AskUser',        family: 'interaction' },
  'write_todos':            { canonical: 'write_todos',            displayName: 'TodoWrite',      family: 'planning' },
  'tracker_create_task':    { canonical: 'tracker_create_task',    displayName: 'CreateTask',     family: 'planning' },
  'tracker_update_task':    { canonical: 'tracker_update_task',    displayName: 'UpdateTask',     family: 'planning' },
  'tracker_get_task':       { canonical: 'tracker_get_task',       displayName: 'GetTask',        family: 'planning' },
  'tracker_list_tasks':     { canonical: 'tracker_list_tasks',     displayName: 'ListTasks',      family: 'planning' },
  'tracker_add_dependency': { canonical: 'tracker_add_dependency', displayName: 'AddDependency', family: 'planning' },
  'tracker_visualize':      { canonical: 'tracker_visualize',      displayName: 'Visualize',      family: 'planning' },
  'update_topic':           { canonical: 'update_topic',           displayName: 'UpdateTopic',    family: 'planning' },
  'list_mcp_resources':     { canonical: 'list_mcp_resources',     displayName: 'ListMCPResources', family: 'mcp' },
  'read_mcp_resource':      { canonical: 'read_mcp_resource',      displayName: 'ReadMCPResource',  family: 'mcp' },
  'activate_skill':         { canonical: 'activate_skill',         displayName: 'ActivateSkill',  family: 'mcp' },
  'get_internal_docs':      { canonical: 'get_internal_docs',      displayName: 'InternalDocs',   family: 'mcp' },
  'enter_plan_mode':        { canonical: 'enter_plan_mode',        displayName: 'PlanMode',       family: 'planning' },
  'exit_plan_mode':         { canonical: 'exit_plan_mode',         displayName: 'ExitPlanMode',   family: 'planning' },
  'complete_task':          { canonical: 'complete_task',          displayName: 'CompleteTask',   family: 'planning' },
};

export function isBuiltinTool(name: string): boolean {
  return name in BUILTIN_TOOL_REGISTRY;
}

export function isMcpTool(name: string): boolean {
  return name.includes('/') || name.startsWith('mcp_');
}

export function resolveToolEntry(rawToolName: string): ToolRegistryEntry {
  if (isBuiltinTool(rawToolName)) {
    return BUILTIN_TOOL_REGISTRY[rawToolName];
  }
  
  const family = isMcpTool(rawToolName) ? 'mcp' : 'unknown';
  
  // Format MCP display name: e.g., 'gitserver/git-status' -> 'GitStatus' (or just clean title)
  let displayName = rawToolName;
  if (rawToolName.includes('/')) {
    const parts = rawToolName.split('/');
    const toolPart = parts[parts.length - 1];
    displayName = toolPart
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  return {
    canonical: rawToolName,
    displayName,
    family,
  };
}
