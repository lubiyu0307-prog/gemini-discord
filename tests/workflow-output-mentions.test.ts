import { describe, expect, it, vi } from 'vitest';
import { sendPreparedDisplayText } from '../src/daemon/engine-cli.js';
import { createConfig } from './test-utils/factories.js';

describe('workflow output mention safety', () => {
  it('suppresses mentions on prepared workflow responses so model text cannot ping Discord users', async () => {
    const channel = {
      send: vi.fn().mockResolvedValue({ id: 'message-1' }),
    };

    const messageIds = await sendPreparedDisplayText(
      channel as any,
      '@everyone review <@123456789012345678>',
      createConfig(),
      { suppressMentions: true },
    );

    expect(messageIds).toEqual(['message-1']);
    expect(channel.send).toHaveBeenCalledWith({
      content: '@everyone review <@123456789012345678>',
      allowedMentions: { parse: [], repliedUser: false },
    });
  });

  it('leaves normal prepared responses unchanged unless mention suppression is requested', async () => {
    const channel = {
      send: vi.fn().mockResolvedValue({ id: 'message-1' }),
    };

    await sendPreparedDisplayText(channel as any, 'normal response', createConfig());

    expect(channel.send).toHaveBeenCalledWith({
      content: 'normal response',
      allowedMentions: { parse: ['users'], repliedUser: true },
    });
  });
});
