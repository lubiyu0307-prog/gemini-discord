import type { TraceEvent } from './trace-event.js';

export interface RenderedTrace {
  content: string;
  embed?: object;
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

export class ShellRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.canonicalToolName === 'run_shell_command';
  }

  render(event: TraceEvent): RenderedTrace {
    const cmd = event.args.commandLine || event.args.CommandLine || event.args.command || '';
    const duration = event.durationMs !== null ? `${event.durationMs}ms` : 'running';
    let output = '';
    if (event.status === 'completed') {
      output = `\n\`\`\`\n${event.resultSummary || 'Success'}\n\`\`\``;
    } else if (event.status === 'failed') {
      output = `\n⚠️ **Failed**:\n\`\`\`\n${event.resultSummary || 'Error'}\n\`\`\``;
    } else if (event.status === 'progress') {
      output = `\n\`\`\`\n${event.resultSummary || ''}\n\`\`\``;
    }
    
    return {
      content: `💻 **Shell**: \`${cmd}\` (${duration})${output}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class FilesystemRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'filesystem';
  }

  render(event: TraceEvent): RenderedTrace {
    const path = event.args.path || event.args.TargetFile || event.args.filePath || '';
    const details = event.resultSummary ? `\n\`\`\`\n${event.resultSummary}\n\`\`\`` : '';
    return {
      content: `📁 **File [${event.displayName}]**: \`${path}\` (${event.status})${details}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class SearchRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'search';
  }

  render(event: TraceEvent): RenderedTrace {
    const query = event.args.query || event.args.Query || '';
    const details = event.resultSummary ? `\nResults: ${event.resultSummary}` : '';
    return {
      content: `🔍 **Search [${event.displayName}]**: \`${query}\` (${event.status})${details}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class WebRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'web';
  }

  render(event: TraceEvent): RenderedTrace {
    const url = event.args.url || event.args.Url || event.args.query || '';
    const details = event.resultSummary ? `\nResult: ${event.resultSummary}` : '';
    return {
      content: `🌐 **Web [${event.displayName}]**: \`${url}\` (${event.status})${details}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class PlanningRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'planning' || event.type === 'phase_started';
  }

  render(event: TraceEvent): RenderedTrace {
    const details = event.resultSummary ? `\n> ${event.resultSummary}` : '';
    return {
      content: `📌 **Planning [${event.displayName || 'Phase'}]** (${event.status})${details}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class McpRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'mcp';
  }

  render(event: TraceEvent): RenderedTrace {
    return {
      content: `🔌 **MCP [${event.displayName}]**: ${event.status}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class InteractionRenderer implements ToolRenderer {
  canRender(event: TraceEvent): boolean {
    return event.toolFamily === 'interaction';
  }

  render(event: TraceEvent): RenderedTrace {
    const prompt = event.args.prompt || event.args.question || '';
    return {
      content: `👤 **Interaction [${event.displayName}]**: \`${prompt}\` (${event.status})`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
    };
  }
}

export class GenericFallbackRenderer implements ToolRenderer {
  canRender(): boolean {
    return true;
  }

  render(event: TraceEvent): RenderedTrace {
    return {
      content: `🛠️ **Tool [${event.displayName || event.toolName || 'Unknown'}]** (${event.status}): ${event.resultSummary || 'N/A'}`,
      flags: { source: 'trace_renderer', doNotRoute: true, doNotPersist: true }
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
        return renderer.render(event);
      }
    }
    return this.fallbackRenderer.render(event);
  }
}
