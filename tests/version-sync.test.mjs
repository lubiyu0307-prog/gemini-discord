import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bumpVersion,
  findVersionMismatches,
  isValidVersion,
  readVersionState,
} from '../scripts/version-sync.mjs';

describe('version sync tooling', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-version-'));
    fs.mkdirSync(path.join(tmpDir, 'src', 'shared'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'gemini-discord', version: '0.1.1' }, null, 2) + '\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify({
        name: 'gemini-discord',
        version: '0.1.1',
        lockfileVersion: 3,
        packages: {
          '': { name: 'gemini-discord', version: '0.1.1' },
        },
      }, null, 2) + '\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'gemini-extension.json'),
      JSON.stringify({ name: 'gemini-discord', version: '0.1.1' }, null, 2) + '\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'shared', 'version.ts'),
      "export const GEMINI_DISCORD_VERSION = '0.1.1';\n",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts semver versions used for releases', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('1.2.3-beta.1')).toBe(true);
    expect(isValidVersion('1.2')).toBe(false);
    expect(isValidVersion('01.2.3')).toBe(false);
  });

  it('reports no mismatches when all version fields match package.json', () => {
    expect(findVersionMismatches(tmpDir)).toEqual([]);
  });

  it('reports every version field that drifts from package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'gemini-extension.json'),
      JSON.stringify({ name: 'gemini-discord', version: '0.1.0' }, null, 2) + '\n',
    );

    expect(findVersionMismatches(tmpDir)).toEqual([
      'gemini-extension.json has "0.1.0", expected "0.1.1"',
    ]);
  });

  it('bumps package, lockfile, extension manifest, and runtime metadata together', () => {
    bumpVersion('0.2.0', tmpDir);

    expect(readVersionState(tmpDir).values).toEqual([
      ['package.json', '0.2.0'],
      ['package-lock.json', '0.2.0'],
      ['package-lock.json packages[""]', '0.2.0'],
      ['gemini-extension.json', '0.2.0'],
      [path.join('src', 'shared', 'version.ts'), '0.2.0'],
    ]);
  });
});
