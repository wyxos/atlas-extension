import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildReverbWebSocketUrl,
  connectAndSaveConnectionConfig,
  connectionStatuses,
  defaultApiKey,
  defaultDomain,
  getReverbStatusVariant,
  getStatusVariant,
  isConnectableConfig,
  loadConnectionConfig,
  normalizeDomain,
  reverbStatuses,
  saveConnectionConfig,
  storageKey,
  verifyConnection,
  verifyReverbConnection,
} from '../src/options/connection.js';
import {
  buildCodexPrompt,
  copyContentBuild,
  copyDirectory,
  copyStaticAssets,
  getCommitRange,
  incrementVersion,
  localOutputEnvKey,
  parseDotEnvText,
  parseBumpRecommendation,
  resolveBuildDestination,
  resolveCommandInvocation,
  resolveExecutable,
  resolveTargetVersion,
  runChecked,
  shouldAskCodexForRelease,
  updateJsonVersion,
} from '../src/release-core.mjs';

test('increments semantic versions for supported bump types', () => {
  assert.equal(incrementVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(incrementVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(incrementVersion('0.1.9', 'major'), '1.0.0');
});

test('parses Codex recommendations from JSON, plain bump text, and version text', () => {
  assert.deepEqual(parseBumpRecommendation('{"bump":"minor"}'), { bump: 'minor' });
  assert.deepEqual(parseBumpRecommendation('patch'), { bump: 'patch' });
  assert.deepEqual(parseBumpRecommendation('next version: 0.3.0'), { version: '0.3.0' });
});

test('keeps the current version for the first release when no prior release tag exists', () => {
  assert.deepEqual(
    resolveTargetVersion({
      codexRecommendation: { bump: 'patch' },
      commits: 'e13c073 Initial extension shell',
      currentVersion: '0.1.0',
      lastReleaseTag: null,
    }),
    {
      bump: 'initial',
      source: 'initial-release',
      version: '0.1.0',
    },
  );
});

test('uses a Codex bump recommendation after an existing release tag', () => {
  assert.deepEqual(
    resolveTargetVersion({
      codexRecommendation: { bump: 'minor' },
      commits: 'abc1234 feat: add toolbar capture',
      currentVersion: '0.1.0',
      lastReleaseTag: 'v0.1.0',
    }),
    {
      bump: 'minor',
      source: 'codex-bump',
      version: '0.2.0',
    },
  );
});

test('builds the commit range from the last release tag', () => {
  assert.equal(getCommitRange(null), 'HEAD');
  assert.equal(getCommitRange('v0.1.0'), 'v0.1.0..HEAD');
});

test('builds a constrained Codex prompt from release context', () => {
  const prompt = buildCodexPrompt({
    commits: 'abc1234 feat: add toolbar capture',
    currentVersion: '0.1.0',
    lastReleaseTag: 'v0.1.0',
  });

  assert.match(prompt, /Respond with JSON only/);
  assert.match(prompt, /"major", "minor", "patch"/);
  assert.match(prompt, /abc1234 feat: add toolbar capture/);
});

test('updates only the version field in JSON text', () => {
  assert.equal(
    updateJsonVersion('{"name":"atlas-extension","version":"0.1.0"}\n', '0.2.0'),
    '{\n  "name": "atlas-extension",\n  "version": "0.2.0"\n}\n',
  );
});

test('copies built extension files recursively into a pack directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-extension-release-'));
  const source = path.join(tempRoot, 'source');
  const destination = path.join(tempRoot, 'pack');

  fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(source, 'manifest.json'), 'manifest');
  fs.writeFileSync(path.join(source, 'options.html'), 'html');
  fs.writeFileSync(path.join(source, 'assets', 'options.js'), 'js');

  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'stale.txt'), 'stale');

  const copied = copyDirectory({ destination, source });

  assert.deepEqual(copied.sort(), ['assets/options.js', 'manifest.json', 'options.html']);
  assert.deepEqual(fs.readdirSync(destination).sort(), ['assets', 'manifest.json', 'options.html']);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'assets')), ['options.js']);
});

test('copies only the single-file content build into the extension package', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-extension-content-build-'));
  const buildOutputPath = path.join(tempRoot, 'package');
  const contentOutputPath = path.join(tempRoot, 'content');

  fs.mkdirSync(path.join(contentOutputPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(contentOutputPath, 'assets', 'content.js'), 'content');

  copyContentBuild({ buildOutputPath, contentOutputPath });

  assert.equal(fs.readFileSync(path.join(buildOutputPath, 'assets', 'content.js'), 'utf8'), 'content');
});

test('copies static icon assets into the extension package', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-extension-static-assets-'));
  const buildOutputPath = path.join(tempRoot, 'package');
  const root = path.join(tempRoot, 'root');

  fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(root, 'icons', 'icon-128.png'), 'icon');

  const copied = copyStaticAssets({ buildOutputPath, root });

  assert.deepEqual(copied, ['icons/icon-128.png']);
  assert.equal(fs.readFileSync(path.join(buildOutputPath, 'icons', 'icon-128.png'), 'utf8'), 'icon');
});

test('copies only the single-file background build into the extension package', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-extension-background-build-'));
  const buildOutputPath = path.join(tempRoot, 'package');
  const backgroundOutputPath = path.join(tempRoot, 'background');

  fs.mkdirSync(path.join(backgroundOutputPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(backgroundOutputPath, 'assets', 'background.js'), 'background');

  copyContentBuild({
    buildOutputPath,
    contentOutputPath: backgroundOutputPath,
    entryName: 'background',
  });

  assert.equal(fs.readFileSync(path.join(buildOutputPath, 'assets', 'background.js'), 'utf8'), 'background');
});

test('rejects split content builds because Chrome content scripts are not module entries', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-extension-content-build-'));
  const buildOutputPath = path.join(tempRoot, 'package');
  const contentOutputPath = path.join(tempRoot, 'content');

  fs.mkdirSync(path.join(contentOutputPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(contentOutputPath, 'assets', 'content.js'), 'content');
  fs.writeFileSync(path.join(contentOutputPath, 'assets', 'shared.js'), 'shared');

  assert.throws(
    () => copyContentBuild({ buildOutputPath, contentOutputPath }),
    /content build must emit only assets\/content\.js/,
  );
});

test('uses the atlas-extension Downloads folder itself for local output', async () => {
  const { getLocalOutputPaths } = await import('../src/release-core.mjs');
  const paths = getLocalOutputPaths('0.1.0', 'C:/Users/example');

  assert.equal(paths.root, path.join('C:/Users/example', 'Downloads', 'atlas-extension'));
  assert.equal(paths.current, paths.root);
  assert.equal(paths.release, null);
});

test('uses an env-configured local build output path', async () => {
  const { getLocalOutputPaths } = await import('../src/release-core.mjs');
  const localOutput = 'C:/Users/example/Downloads/custom-atlas-extension';
  const paths = getLocalOutputPaths('0.1.0', 'C:/Users/example', {
    [localOutputEnvKey]: localOutput,
  });

  assert.equal(paths.root, localOutput);
  assert.equal(paths.current, localOutput);
  assert.equal(paths.release, null);
});

test('parses .env values used by local extension builds', () => {
  assert.deepEqual(
    parseDotEnvText([
      '# local extension output',
      'ATLAS_EXTENSION_LOCAL_OUT=C:\\Users\\joeyj\\Downloads\\atlas-extension',
      'QUOTED="C:/Users/example/Downloads/atlas-extension"',
      '',
    ].join('\n')),
    {
      ATLAS_EXTENSION_LOCAL_OUT: 'C:\\Users\\joeyj\\Downloads\\atlas-extension',
      QUOTED: 'C:/Users/example/Downloads/atlas-extension',
    },
  );
});

test('resolves build destinations from args and env', () => {
  const root = path.resolve('D:/code/wyxos/js/atlas-extension');
  const localOutput = 'C:/Users/example/Downloads/atlas-extension';

  assert.equal(
    resolveBuildDestination({
      argv: ['--local'],
      env: { [localOutputEnvKey]: localOutput },
      root,
    }),
    path.resolve(localOutput),
  );
  assert.equal(
    resolveBuildDestination({
      argv: ['--out', localOutput],
      root,
    }),
    path.resolve(localOutput),
  );
});

test('resolves Windows command shims for npm and codex', () => {
  const npm = resolveCommandInvocation('npm', ['--version'], 'win32', 'C:/Program Files/nodejs/node.exe');

  assert.equal(npm.command, 'C:/Program Files/nodejs/node.exe');
  assert.match(npm.args[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
  assert.equal(npm.args[1], '--version');
  assert.equal(resolveExecutable('codex', 'win32'), 'codex.exe');
  assert.equal(resolveExecutable('git', 'win32'), 'git');
  assert.equal(resolveExecutable('npm', 'linux'), 'npm');
});

test('runs checked npm commands without invalid stdio options', async () => {
  await assert.doesNotReject(runChecked('npm', ['--version'], { root: process.cwd() }));
});

test('asks Codex only when a previous release tag exists', () => {
  assert.equal(shouldAskCodexForRelease(null), false);
  assert.equal(shouldAskCodexForRelease('v0.1.0'), true);
});

test('normalizes Atlas connection domains', () => {
  assert.equal(defaultDomain, 'https://atlas.test');
  assert.equal(defaultApiKey, 'atlas_local_development_key');
  assert.equal(normalizeDomain('https://atlas.test/'), 'https://atlas.test');
  assert.equal(normalizeDomain('atlas.test'), 'https://atlas.test');
  assert.equal(normalizeDomain('http://localhost:8000/path'), 'http://localhost:8000');
  assert.equal(normalizeDomain('ftp://atlas.test'), null);
  assert.equal(normalizeDomain(''), null);
});

test('requires a domain and API key before connecting', () => {
  assert.equal(isConnectableConfig({ apiKey: 'abc', domain: 'atlas.test' }), true);
  assert.equal(isConnectableConfig({ apiKey: '', domain: 'atlas.test' }), false);
  assert.equal(isConnectableConfig({ apiKey: 'abc', domain: 'ftp://atlas.test' }), false);
});

test('uses explicit success and danger variants for connection statuses', () => {
  assert.equal(getStatusVariant(connectionStatuses.connected), 'success');
  assert.equal(getStatusVariant(connectionStatuses.failed), 'danger');
  assert.equal(getStatusVariant(connectionStatuses.idle), 'outline');
  assert.equal(getReverbStatusVariant(reverbStatuses.connected), 'success');
  assert.equal(getReverbStatusVariant(reverbStatuses.failed), 'danger');
  assert.equal(getReverbStatusVariant(reverbStatuses.disabled), 'outline');
});

test('saves and loads extension connection settings', async () => {
  const values = {};
  const storage = {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(nextValues) {
      Object.assign(values, nextValues);
    },
  };

  const savedConfig = await saveConnectionConfig({
    apiKey: ' secret-key ',
    domain: 'atlas.test/',
  }, storage);

  assert.equal(savedConfig.domain, 'https://atlas.test');
  assert.equal(savedConfig.apiKey, 'secret-key');
  assert.match(savedConfig.connectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(values[storageKey], savedConfig);
  assert.deepEqual(await loadConnectionConfig(storage), savedConfig);
});

test('verifies a connection with one explicit ping request', async () => {
  const requests = [];
  const result = await verifyConnection({
    apiKey: ' secret-key ',
    domain: 'atlas.test/',
  }, async (url, options) => {
    requests.push({ options, url });

    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  });

  assert.equal(result.status, 'connected');
  assert.equal(result.domain, 'https://atlas.test');
  assert.equal(result.apiKey, 'secret-key');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/ping');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers['X-Atlas-Api-Key'], 'secret-key');
});

test('builds Reverb WebSocket URLs from the Atlas ping payload', () => {
  assert.equal(
    buildReverbWebSocketUrl({
      host: 'reverb-8080.herd.test',
      key: 'laravel-herd',
      port: 443,
      scheme: 'https',
    }),
    'wss://reverb-8080.herd.test/app/laravel-herd?protocol=7&client=atlas-extension&version=0.1.0&flash=false',
  );
  assert.equal(buildReverbWebSocketUrl({ enabled: true, host: '', key: '' }), null);
});

test('confirms Reverb with one transient WebSocket handshake', async () => {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.listeners = {};
      this.url = url;
      this.closed = false;
      sockets.push(this);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ event: 'pusher:connection_established' }),
      }));
    }

    addEventListener(eventName, handler) {
      this.listeners[eventName] = [...(this.listeners[eventName] ?? []), handler];
    }

    close() {
      this.closed = true;
    }

    emit(eventName, event) {
      for (const handler of this.listeners[eventName] ?? []) {
        handler(event);
      }
    }
  }

  const result = await verifyReverbConnection({
    enabled: true,
    host: 'reverb-8080.herd.test',
    key: 'laravel-herd',
    port: 443,
    scheme: 'https',
  }, {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 50,
  });

  assert.equal(result.status, reverbStatuses.connected);
  assert.match(sockets[0].url, /^wss:\/\/reverb-8080\.herd\.test\/app\/laravel-herd\?/);
  assert.equal(sockets[0].closed, true);
});

test('requires Reverb confirmation before marking the connection connected', async () => {
  class FailingWebSocket {
    constructor() {
      queueMicrotask(() => this.emit('error', {}));
      this.listeners = {};
    }

    addEventListener(eventName, handler) {
      this.listeners[eventName] = [...(this.listeners[eventName] ?? []), handler];
    }

    close() {}

    emit(eventName, event) {
      for (const handler of this.listeners[eventName] ?? []) {
        handler(event);
      }
    }
  }

  const result = await verifyConnection({
    apiKey: ' secret-key ',
    domain: 'atlas.test/',
  }, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ok: true,
          reverb: {
            enabled: true,
            host: 'reverb-8080.herd.test',
            key: 'laravel-herd',
            port: 443,
            scheme: 'https',
          },
        };
      },
    }),
    reverbTimeoutMs: 50,
    WebSocketImpl: FailingWebSocket,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reverb.status, reverbStatuses.failed);
});

test('connect saves failed and connected verification state without background checks', async () => {
  const values = {};
  const storage = {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(nextValues) {
      Object.assign(values, nextValues);
    },
  };
  const responses = [false, true];
  const requestedUrls = [];

  const failedConfig = await connectAndSaveConnectionConfig({
    apiKey: 'local-key',
    domain: 'atlas.test',
  }, {
    storage,
    fetchImpl: async (url) => {
      requestedUrls.push(url);

      return {
        ok: responses.shift(),
        async json() {
          return { ok: this.ok };
        },
      };
    },
  });

  assert.equal(failedConfig.status, 'failed');
  assert.deepEqual(values[storageKey], failedConfig);

  const connectedConfig = await connectAndSaveConnectionConfig(failedConfig, {
    storage,
    fetchImpl: async (url) => {
      requestedUrls.push(url);

      return {
        ok: responses.shift(),
        async json() {
          return { ok: this.ok };
        },
      };
    },
  });

  assert.equal(connectedConfig.status, 'connected');
  assert.deepEqual(values[storageKey], connectedConfig);
  assert.deepEqual(requestedUrls, [
    'https://atlas.test/api/extension/ping',
    'https://atlas.test/api/extension/ping',
  ]);
});
