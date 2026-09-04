import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  return {
    ...actual,
    createConnection: createConnectionMock,
  };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkPortInUse, classifyGeminiAuth } from '../src/daemon/preflight.js';
import { ENV } from '../src/shared/config-vars.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('checkPortInUse', () => {
  it('returns true when the port accepts a connection', async () => {
    const socket = createFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const resultPromise = checkPortInUse(18790);
    socket.emit('connect');

    await expect(resultPromise).resolves.toBe(true);
    expect(createConnectionMock).toHaveBeenCalledWith({ host: '127.0.0.1', port: 18790 });
    expect(socket.setTimeout).toHaveBeenCalledWith(750);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns false when localhost refuses the connection', async () => {
    const socket = createFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const resultPromise = checkPortInUse(18790);
    socket.emit('error', { code: 'ECONNREFUSED' });

    await expect(resultPromise).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns false when sandboxed localhost probes are blocked', async () => {
    const socket = createFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const resultPromise = checkPortInUse(18790);
    socket.emit('error', { code: 'EPERM' });

    await expect(resultPromise).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('classifyGeminiAuth', () => {
  it('accepts Gemini API key auth and selects gemini-api-key', () => {
    expect(classifyGeminiAuth({
      [ENV.GEMINI_API_KEY]: 'gemini-key',
    })).toEqual({
      complete: true,
      selectedType: 'gemini-api-key',
      warnings: [],
    });
  });

  it('accepts complete Vertex auth when explicitly enabled', () => {
    expect(classifyGeminiAuth({
      [ENV.GOOGLE_GENAI_USE_VERTEXAI]: 'true',
      [ENV.GOOGLE_CLOUD_PROJECT]: 'project-1',
      [ENV.GOOGLE_CLOUD_LOCATION]: 'us-central1',
    })).toEqual({
      complete: true,
      selectedType: 'vertex-ai',
      warnings: [],
    });
  });

  it('selects Google login when no key is configured and a login exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-login-'));
    try {
      fs.writeFileSync(path.join(dir, 'oauth_creds.json'), '{}');
      expect(classifyGeminiAuth({}, { userGeminiDir: dir })).toEqual({
        complete: true,
        selectedType: 'oauth-personal',
        warnings: [],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when no key is configured and no Google login exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-nologin-'));
    try {
      expect(classifyGeminiAuth({}, { userGeminiDir: dir })).toEqual({
        complete: false,
        selectedType: 'oauth-personal',
        warnings: [expect.stringContaining('sign in with Google')],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when Vertex is enabled but incomplete', () => {
    expect(classifyGeminiAuth({
      [ENV.GOOGLE_GENAI_USE_VERTEXAI]: 'true',
      [ENV.GOOGLE_CLOUD_PROJECT]: 'project-1',
    })).toEqual({
      complete: false,
      selectedType: 'gemini-api-key',
      warnings: [expect.stringContaining('Vertex AI auth is incomplete')],
    });
  });

  it('warns when GOOGLE_API_KEY is set without Vertex enabled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-nologin-'));
    try {
      expect(classifyGeminiAuth({
        [ENV.GOOGLE_API_KEY]: 'vertex-key',
      }, { userGeminiDir: dir })).toEqual({
        complete: false,
        selectedType: 'oauth-personal',
        warnings: [
          expect.stringContaining('Gemini CLI auth is not configured'),
          expect.stringContaining('GOOGLE_API_KEY is set'),
        ],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  socket.setTimeout = vi.fn();
  socket.destroy = vi.fn();
  return socket;
}
