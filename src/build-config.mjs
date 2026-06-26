import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const localOutputEnvKey = 'ATLAS_EXTENSION_LOCAL_OUT';

export function parseDotEnvText(text) {
  const values = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(trimmedLine.slice(separatorIndex + 1).trim());

    if (key !== '') {
      values[key] = value;
    }
  }

  return values;
}

export function readDotEnv(root) {
  const envPath = path.join(root, '.env');

  if (!fs.existsSync(envPath)) {
    return {};
  }

  return parseDotEnvText(fs.readFileSync(envPath, 'utf8'));
}

export function loadBuildEnv(root, baseEnv = process.env) {
  return {
    ...baseEnv,
    ...readDotEnv(root),
  };
}

export function getLocalOutputPaths(version, homeDirectory = os.homedir(), env = {}) {
  const root = env[localOutputEnvKey] ?? path.join(homeDirectory, 'Downloads', 'atlas-extension');

  return {
    current: root,
    release: null,
    root,
  };
}

export function resolveBuildDestination({ argv, env = {}, root }) {
  const outIndex = argv.indexOf('--out');

  if (outIndex !== -1) {
    return resolveRequiredPathArg(argv, outIndex, '--out');
  }

  if (argv.includes('--local')) {
    const localOutput = env[localOutputEnvKey];

    if (!localOutput) {
      throw new Error(`Missing ${localOutputEnvKey} in .env`);
    }

    return path.resolve(localOutput);
  }

  return path.join(root, 'dist', `atlas-extension-v${readPackageVersion(root)}`);
}

export function readPackageVersion(root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
    throw new Error(`package.json has invalid version: ${packageJson.version}`);
  }

  return packageJson.version;
}

function resolveRequiredPathArg(argv, index, flag) {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }

  return path.resolve(value);
}

function unquoteEnvValue(value) {
  if (value.length < 2) {
    return value;
  }

  const quote = value.at(0);

  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    return value.slice(1, -1);
  }

  return value;
}
