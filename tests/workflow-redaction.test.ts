import { describe, it, expect } from 'vitest';
import {
  redactFilePath,
  redactDiscordId,
  redactIpAddresses,
  redactTraceArgs,
  redactTraceResult,
} from '../src/daemon/workflow/redaction.js';

describe('redaction pipeline', () => {
  it('redacts absolute paths containing /Users/', () => {
    expect(redactFilePath('/Users/example/project/src/index.ts')).toBe('~/project/src/index.ts');
    expect(redactFilePath('/Users/anotheruser/docs/file.txt')).toBe('~/docs/file.txt');
    expect(redactFilePath('/var/log/syslog')).toBe('/var/log/syslog');
  });

  it('redacts Discord IDs (17-20 digits)', () => {
    expect(redactDiscordId('853141321774006282')).toBe('853141...');
    expect(redactDiscordId('My ID is 853141321774006282 and yours is 1234567890123456789.')).toBe(
      'My ID is 853141... and yours is 123456....'
    );
    expect(redactDiscordId('12345')).toBe('12345');
  });

  it('redacts IP addresses (IPv4 and IPv6)', () => {
    expect(redactIpAddresses('Connecting to 192.168.1.100 now')).toBe('Connecting to [IP_REDACTED] now');
    expect(redactIpAddresses('IPv6 is 2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
      'IPv6 is [IP_REDACTED]'
    );
  });

  it('redacts secrets, tokens, keys and command flags in args', () => {
    const args = {
      commandLine: 'curl -H "Authorization: Bearer secret-token-abc" https://api.example.com --token abcdef123 --secret=mysecretpass',
      token: 'super-secret-token',
      apiKey: 'xyz987',
      normalField: 'hello-world',
      nested: {
        SECRET_ENV: 'my_raw_secret',
        normalNested: 'nested-val',
      },
    };

    const { redacted, fieldsRedacted } = redactTraceArgs(args);

    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.normalField).toBe('hello-world');
    expect((redacted.nested as any).SECRET_ENV).toBe('[REDACTED]');
    expect((redacted.nested as any).normalNested).toBe('nested-val');

    // Command flag redaction
    const cmd = redacted.commandLine as string;
    expect(cmd).toContain('--token [REDACTED]');
    expect(cmd).toContain('--secret=[REDACTED]');
    expect(cmd).toContain('Bearer [REDACTED]');
    expect(cmd).not.toContain('secret-token-abc');
    expect(cmd).not.toContain('abcdef123');
    expect(cmd).not.toContain('mysecretpass');

    expect(fieldsRedacted).toContain('token');
    expect(fieldsRedacted).toContain('apiKey');
    expect(fieldsRedacted).toContain('SECRET_ENV');
  });

  it('redacts and truncates trace results', () => {
    const longOutput = 'A'.repeat(300);
    const result1 = redactTraceResult(longOutput, 200);
    expect(result1.truncated).toBe(true);
    expect(result1.summary).toHaveLength(200 + '... [100 chars truncated]'.length);
    expect(result1.summary).toContain('... [100 chars truncated]');

    const shortOutput = 'Hello, this is a short log.';
    const result2 = redactTraceResult(shortOutput, 200);
    expect(result2.truncated).toBe(false);
    expect(result2.summary).toBe(shortOutput);
  });
});
