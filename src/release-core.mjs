import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  getLocalOutputPaths,
  loadBuildEnv,
  readPackageVersion,
} from './build-config.mjs';
import { copyStaticAssets } from './static-assets.mjs';

const execFileAsync = promisify(execFile);

export const extensionFiles = [
  'manifest.json',
  'options.html',
];

const bumpTypes = new Set(['major', 'minor', 'patch']);

export {
  getLocalOutputPaths,
  loadBuildEnv,
  localOutputEnvKey,
  parseDotEnvText,
  readDotEnv,
  readPackageVersion,
  resolveBuildDestination,
} from './build-config.mjs';
export { copyStaticAssets } from './static-assets.mjs';

export function getCommitRange(lastReleaseTag) {
  return lastReleaseTag ? `${lastReleaseTag}..HEAD` : 'HEAD';
}

export function incrementVersion(version, bump) {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/.exec(version);

  if (!match?.groups) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  const next = {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };

  if (bump === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (bump === 'minor') {
    next.minor += 1;
    next.patch = 0;
  } else if (bump === 'patch') {
    next.patch += 1;
  } else {
    throw new Error(`Unsupported version bump: ${bump}`);
  }

  return `${next.major}.${next.minor}.${next.patch}`;
}

export function parseBumpRecommendation(text) {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const parsedJson = parseJsonObject(trimmed);

  if (parsedJson !== null) {
    if (typeof parsedJson.version === 'string' && isSemanticVersion(parsedJson.version)) {
      return { version: parsedJson.version };
    }

    if (typeof parsedJson.bump === 'string' && bumpTypes.has(parsedJson.bump)) {
      return { bump: parsedJson.bump };
    }
  }

  if (bumpTypes.has(trimmed)) {
    return { bump: trimmed };
  }

  const versionMatch = /(?<version>\d+\.\d+\.\d+)/.exec(trimmed);

  if (versionMatch?.groups?.version) {
    return { version: versionMatch.groups.version };
  }

  const bumpMatch = /\b(?<bump>major|minor|patch)\b/i.exec(trimmed);

  if (bumpMatch?.groups?.bump) {
    return { bump: bumpMatch.groups.bump.toLowerCase() };
  }

  return null;
}

export function resolveTargetVersion({
  codexRecommendation,
  commits,
  currentVersion,
  lastReleaseTag,
}) {
  if (!lastReleaseTag) {
    return {
      bump: 'initial',
      source: 'initial-release',
      version: currentVersion,
    };
  }

  if (codexRecommendation?.version) {
    return {
      bump: 'codex-version',
      source: 'codex-version',
      version: codexRecommendation.version,
    };
  }

  if (codexRecommendation?.bump) {
    return {
      bump: codexRecommendation.bump,
      source: 'codex-bump',
      version: incrementVersion(currentVersion, codexRecommendation.bump),
    };
  }

  const fallbackBump = inferBumpFromCommits(commits);

  return {
    bump: fallbackBump,
    source: 'heuristic',
    version: incrementVersion(currentVersion, fallbackBump),
  };
}

export function inferBumpFromCommits(commits) {
  if (/\bBREAKING CHANGE\b|!:/i.test(commits)) {
    return 'major';
  }

  if (/\bfeat(?:\([^)]+\))?:/i.test(commits)) {
    return 'minor';
  }

  return 'patch';
}

export function buildCodexPrompt({ commits, currentVersion, lastReleaseTag }) {
  const releaseBase = lastReleaseTag ?? 'no previous release tag';

  return [
    'You are selecting the next semantic version bump for the Atlas Extension browser extension.',
    'Respond with JSON only, using exactly this shape: {"bump":"patch"}.',
    'Allowed bump values are "major", "minor", "patch".',
    `Current version: ${currentVersion}`,
    `Last release: ${releaseBase}`,
    'Use the commits below. Choose major only for breaking changes, minor for user-visible features, patch for fixes/tooling/docs/internal changes.',
    '',
    commits.trim() || '(no commits)',
  ].join('\n');
}

export function updateJsonVersion(text, version) {
  const data = JSON.parse(text);
  data.version = version;

  return `${JSON.stringify(data, null, 2)}\n`;
}

export function copyDirectory({ destination, source }) {
  fs.rmSync(destination, { force: true, recursive: true });
  fs.mkdirSync(destination, { recursive: true });

  const copied = [];

  for (const file of walkFiles(source)) {
    const relativePath = path.relative(source, file);
    const destinationPath = path.join(destination, relativePath);

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(file, destinationPath);
    copied.push(relativePath.replaceAll(path.sep, '/'));
  }

  return copied.sort((left, right) => left.localeCompare(right));
}

export function copyContentBuild({ buildOutputPath, contentOutputPath, entryName = 'content' }) {
  const files = [...walkFiles(contentOutputPath)]
    .map((file) => path.relative(contentOutputPath, file).replaceAll(path.sep, '/'))
    .sort((left, right) => left.localeCompare(right));
  const expectedEntry = `assets/${entryName}.js`;

  if (JSON.stringify(files) !== JSON.stringify([expectedEntry])) {
    throw new Error(`${entryName} build must emit only ${expectedEntry}. Found: ${files.join(', ')}`);
  }

  const source = path.join(contentOutputPath, 'assets', `${entryName}.js`);
  const destination = path.join(buildOutputPath, 'assets', `${entryName}.js`);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

export async function buildExtension({ destination, root }) {
  const buildOutputPath = getBuildOutputPath(root);
  const backgroundOutputPath = getBackgroundBuildOutputPath(root);
  const contentOutputPath = getContentBuildOutputPath(root);

  fs.rmSync(buildOutputPath, { force: true, recursive: true });
  fs.rmSync(backgroundOutputPath, { force: true, recursive: true });
  fs.rmSync(contentOutputPath, { force: true, recursive: true });
  await runViteBuild({ outDir: buildOutputPath, root, target: 'options' });
  await runViteBuild({ outDir: backgroundOutputPath, root, target: 'background' });
  await runViteBuild({ outDir: contentOutputPath, root, target: 'content' });
  copyContentBuild({
    buildOutputPath,
    contentOutputPath: backgroundOutputPath,
    entryName: 'background',
  });
  copyContentBuild({ buildOutputPath, contentOutputPath });
  fs.rmSync(backgroundOutputPath, { force: true, recursive: true });
  fs.rmSync(contentOutputPath, { force: true, recursive: true });
  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(buildOutputPath, 'manifest.json'));
  copyStaticAssets({ buildOutputPath, root });

  const copied = copyDirectory({ destination, source: buildOutputPath });

  return {
    copied,
    destination,
  };
}

export async function runRelease({ argv = [], env = process.env, root = process.cwd() }) {
  const options = parseReleaseArgs(argv);

  await runChecked('npm', ['test'], { root });
  await runChecked('npm', ['run', 'lint'], { root });
  await commitPendingChanges({ message: 'Prepare extension release workflow', root });

  const currentVersion = readPackageVersion(root);
  const lastReleaseTag = await getLastReleaseTag(root);
  const commits = await getRecentCommits({ lastReleaseTag, root });
  const codexRecommendation = shouldAskCodexForRelease(lastReleaseTag)
    ? await getCodexRecommendation({
      commits,
      currentVersion,
      env,
      lastReleaseTag,
      root,
    })
    : null;
  const target = resolveTargetVersion({
    codexRecommendation,
    commits,
    currentVersion,
    lastReleaseTag,
  });

  if (target.version !== currentVersion) {
    updateVersionFiles({ root, version: target.version });
  }

  const distPath = path.join(root, 'dist', `atlas-extension-v${target.version}`);
  await buildExtension({ destination: distPath, root });
  await runChecked('npm', ['test'], { root });

  if (target.version !== currentVersion) {
    await commitPendingChanges({ message: `Release v${target.version}`, root });
  }

  await createReleaseTag({ root, version: target.version });

  const localOutputs = [];

  if (options.local) {
    const localPaths = getLocalOutputPaths(target.version, undefined, loadBuildEnv(root, env));
    copyDirectory({ destination: localPaths.current, source: distPath });
    localOutputs.push(localPaths.current);
  }

  return {
    codexRecommendation,
    distPath,
    localOutputs,
    target,
  };
}

export function parseReleaseArgs(argv) {
  return {
    local: argv.includes('--local'),
  };
}

export function shouldAskCodexForRelease(lastReleaseTag) {
  return lastReleaseTag !== null;
}

export function updateVersionFiles({ root, version }) {
  for (const relativePath of ['package.json', 'manifest.json']) {
    const fullPath = path.join(root, relativePath);
    const next = updateJsonVersion(fs.readFileSync(fullPath, 'utf8'), version);
    fs.writeFileSync(fullPath, next);
  }
}

export async function getLastReleaseTag(root) {
  const result = await runGit(['tag', '--list', 'v[0-9]*', '--sort=-creatordate'], { root });
  const tag = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return tag ?? null;
}

export async function getRecentCommits({ lastReleaseTag, root }) {
  const range = getCommitRange(lastReleaseTag);
  const result = await runGit(['log', '--format=%h %s', range], { root });

  return result.stdout.trim();
}

export async function getCodexRecommendation({ commits, currentVersion, env, lastReleaseTag, root }) {
  const prompt = buildCodexPrompt({ commits, currentVersion, lastReleaseTag });

  try {
    const result = await execFileAsync(
      resolveExecutable('codex'),
      ['exec', '--ephemeral', '--ignore-rules', '--sandbox', 'read-only', '-C', root, prompt],
      {
        cwd: root,
        env,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true,
      },
    );

    return parseBumpRecommendation(result.stdout) ?? parseBumpRecommendation(result.stderr) ?? null;
  } catch {
    return null;
  }
}

export async function commitPendingChanges({ message, root }) {
  const status = await runGit(['status', '--porcelain'], { root });

  if (status.stdout.trim().length === 0) {
    return false;
  }

  await runGit(['add', '-A'], { root });
  await runGit(['commit', '-m', message], { root });

  return true;
}

export async function createReleaseTag({ root, version }) {
  const tag = `v${version}`;
  const existing = await runGit(['tag', '--list', tag], { root });

  if (existing.stdout.trim() === tag) {
    return false;
  }

  await runGit(['tag', tag], { root });

  return true;
}

export async function runChecked(command, args, { root }) {
  const invocation = resolveCommandInvocation(command, args);

  await execFileAsync(invocation.command, invocation.args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  });
}

export function getBuildOutputPath(root) {
  return path.join(root, 'dist', '.vite-build');
}

function getBackgroundBuildOutputPath(root) {
  return path.join(root, 'dist', '.vite-background-build');
}

function getContentBuildOutputPath(root) {
  return path.join(root, 'dist', '.vite-content-build');
}

export function resolveExecutable(command, platform = process.platform) {
  if (platform === 'win32' && command === 'codex') {
    return 'codex.exe';
  }

  return command;
}

export function resolveCommandInvocation(command, args, platform = process.platform, nodeExecutable = process.execPath) {
  if (platform === 'win32' && command === 'npm') {
    return {
      args: [
        path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        ...args,
      ],
      command: nodeExecutable,
    };
  }

  return {
    args,
    command: resolveExecutable(command, platform),
  };
}

async function runGit(args, { root }) {
  const result = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  });

  return {
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

async function runViteBuild({ outDir, root, target }) {
  const viteBinPath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

  await execFileAsync(process.execPath, [viteBinPath, 'build', '--outDir', outDir], {
    cwd: root,
    env: {
      ...process.env,
      ATLAS_EXTENSION_BUILD_TARGET: target,
    },
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  });
}

function* walkFiles(directory) {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);

      continue;
    }

    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function parseJsonObject(text) {
  const jsonMatch = /\{[\s\S]*\}/.exec(text);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function isSemanticVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}
