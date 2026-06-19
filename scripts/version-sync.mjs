#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const VERSION_SOURCE_PATH = path.join('src', 'shared', 'version.ts');

export function isValidVersion(version) {
  return VERSION_PATTERN.test(version);
}

export function readJson(rootDir, relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

export function writeJson(rootDir, relativePath, value) {
  const fullPath = path.join(rootDir, relativePath);
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readRuntimeVersion(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, VERSION_SOURCE_PATH), 'utf8');
  const match = source.match(/GEMINI_DISCORD_VERSION = '([^']+)'/);
  if (!match) {
    throw new Error(`${VERSION_SOURCE_PATH} does not export GEMINI_DISCORD_VERSION`);
  }
  return match[1];
}

export function writeRuntimeVersion(rootDir, version) {
  const fullPath = path.join(rootDir, VERSION_SOURCE_PATH);
  const source = fs.readFileSync(fullPath, 'utf8');
  const next = source.replace(
    /GEMINI_DISCORD_VERSION = '([^']+)'/,
    `GEMINI_DISCORD_VERSION = '${version}'`,
  );
  if (next === source) {
    throw new Error(`${VERSION_SOURCE_PATH} does not export GEMINI_DISCORD_VERSION`);
  }
  fs.writeFileSync(fullPath, next);
}

export function readVersionState(rootDir = process.cwd()) {
  const packageJson = readJson(rootDir, 'package.json');
  const packageLock = readJson(rootDir, 'package-lock.json');
  const extensionManifest = readJson(rootDir, 'gemini-extension.json');

  return {
    source: packageJson.version,
    values: [
      ['package.json', packageJson.version],
      ['package-lock.json', packageLock.version],
      ['package-lock.json packages[""]', packageLock.packages?.['']?.version],
      ['gemini-extension.json', extensionManifest.version],
      [VERSION_SOURCE_PATH, readRuntimeVersion(rootDir)],
    ],
  };
}

export function findVersionMismatches(rootDir = process.cwd()) {
  const state = readVersionState(rootDir);
  if (!isValidVersion(state.source)) {
    return [`package.json has invalid semver version "${state.source}"`];
  }

  return state.values
    .filter(([, version]) => version !== state.source)
    .map(([label, version]) => `${label} has "${version}", expected "${state.source}"`);
}

export function bumpVersion(version, rootDir = process.cwd()) {
  if (!isValidVersion(version)) {
    throw new Error(`Invalid semver version "${version}"`);
  }

  const packageJson = readJson(rootDir, 'package.json');
  packageJson.version = version;
  writeJson(rootDir, 'package.json', packageJson);

  const packageLock = readJson(rootDir, 'package-lock.json');
  packageLock.version = version;
  if (!packageLock.packages?.['']) {
    throw new Error('package-lock.json is missing packages[""]');
  }
  packageLock.packages[''].version = version;
  writeJson(rootDir, 'package-lock.json', packageLock);

  const extensionManifest = readJson(rootDir, 'gemini-extension.json');
  extensionManifest.version = version;
  writeJson(rootDir, 'gemini-extension.json', extensionManifest);

  writeRuntimeVersion(rootDir, version);
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/version-sync.mjs check
  node scripts/version-sync.mjs bump <version>
`);
}

function main() {
  const [command, version] = process.argv.slice(2);

  if (command === 'check') {
    const mismatches = findVersionMismatches();
    if (mismatches.length > 0) {
      process.stderr.write(`Version fields are out of sync:\n${mismatches.map((line) => `- ${line}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`Version fields are in sync at ${readVersionState().source}\n`);
    return;
  }

  if (command === 'bump') {
    if (!version) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    bumpVersion(version);
    process.stdout.write(`Updated version fields to ${version}\n`);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
