import { vi } from 'vitest';
import { CONFIG_ENV_KEYS } from '../../src/shared/config-vars.js';

// Stub all known config environment variables to ensure test isolation from the host environment.
for (const key of CONFIG_ENV_KEYS) {
  vi.stubEnv(key, '');
}

// Stub Discord bridge role context markers.
vi.stubEnv('GEMINI_DISCORD_ROLE', '');
vi.stubEnv('GEMINI_DISCORD_SENDER_ID', '');
vi.stubEnv('GEMINI_DISCORD_SENDER_LABEL', '');
