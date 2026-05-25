export function redactFilePath(path: string): string {
  if (typeof path !== 'string') return path;
  // Replace /Users/{username}/ with ~/
  return path.replace(/\/Users\/[^/]+\//g, '~/');
}

export function redactDiscordId(id: string): string {
  if (typeof id !== 'string') return id;
  // Discord IDs are usually 17-19 digit strings
  return id.replace(/\b\d{17,20}\b/g, (match) => {
    return match.slice(0, 6) + '...';
  });
}

// Redact IP addresses (v4 and v6)
export function redactIpAddresses(text: string): string {
  if (typeof text !== 'string') return text;
  // IPv4 regex
  let redacted = text.replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '[IP_REDACTED]');
  // IPv6 regex (simplified, but covers most common formats)
  redacted = redacted.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, '[IP_REDACTED]');
  redacted = redacted.replace(/\b((?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{0,4})\b/g, '[IP_REDACTED]');
  return redacted;
}

// Redacts flags in command lines, e.g. --token=foo or -token foo
export function redactCommandFlags(cmd: string, fieldsRedacted: string[]): string {
  if (typeof cmd !== 'string') return cmd;
  let redacted = cmd;
  
  // Pattern: --(token|secret|password|key|env|e)(?:=|\s+)([^\s]+)
  // Let's replace the value with [REDACTED]
  const flagRegex = /(--(?:token|secret|password|key|env)|-(?:token|secret|password|key|env|e))(=|\s+)([^\s]+)/gi;
  redacted = redacted.replace(flagRegex, (match, flag, separator, value) => {
    fieldsRedacted.push(flag.replace(/^-+/, ''));
    return `${flag}${separator}[REDACTED]`;
  });

  return redacted;
}

export function redactTraceArgs(args: Record<string, unknown>): {
  redacted: Record<string, unknown>;
  fieldsRedacted: string[];
} {
  const fieldsRedacted: string[] = [];

  function redactValue(val: unknown, keyName?: string): unknown {
    if (val === null || val === undefined) return val;

    if (typeof val === 'string') {
      let s = val;

      // Check if key implies secret/token
      if (keyName) {
        const lowerKey = keyName.toLowerCase();
        if (
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('key') ||
          lowerKey.includes('password') ||
          lowerKey.includes('credential') ||
          lowerKey.includes('auth')
        ) {
          fieldsRedacted.push(keyName);
          return '[REDACTED]';
        }
      }

      // Check content for JWT-like patterns
      if (/\bey[Jj][a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\b/.test(s)) {
        fieldsRedacted.push(keyName || 'jwt');
        s = '[REDACTED]';
      }

      // Check content for Bearer token patterns
      if (/bearer\s+[a-zA-Z0-9-_.]+/i.test(s)) {
        fieldsRedacted.push(keyName || 'bearer_token');
        s = s.replace(/bearer\s+[a-zA-Z0-9-_.]+/gi, 'Bearer [REDACTED]');
      }

      // Redact command line flags if this is command line input
      if (keyName === 'commandLine' || keyName === 'command' || keyName === 'args' || keyName === 'CommandLine') {
        s = redactCommandFlags(s, fieldsRedacted);
      }

      s = redactFilePath(s);
      s = redactDiscordId(s);
      s = redactIpAddresses(s);
      return s;
    }

    if (Array.isArray(val)) {
      return val.map(item => redactValue(item, keyName));
    }

    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const newObj: Record<string, unknown> = {};
      for (const k of Object.keys(obj)) {
        newObj[k] = redactValue(obj[k], k);
      }
      return newObj;
    }

    return val;
  }

  const redacted = redactValue(args) as Record<string, unknown>;

  return {
    redacted,
    fieldsRedacted: Array.from(new Set(fieldsRedacted)),
  };
}

export function redactTraceResult(result: string, maxLength = 200): {
  summary: string;
  truncated: boolean;
} {
  if (typeof result !== 'string') {
    return { summary: '', truncated: false };
  }

  let s = redactFilePath(result);
  s = redactDiscordId(s);
  s = redactIpAddresses(s);

  if (s.length <= maxLength) {
    return { summary: s, truncated: false };
  }

  const truncatedCount = s.length - maxLength;
  const summary = s.slice(0, maxLength) + `... [${truncatedCount} chars truncated]`;
  return {
    summary,
    truncated: true,
  };
}
