import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

import { buildExtension } from '../../../src/release-core.mjs';
import { startDesktopMock } from './desktop-mock.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { startRecordingProxy } from './recording-proxy.mjs';
import { visualCursorScript } from './visual.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

export function e2eSettings(env = process.env) {
  const artifactDir = env.ATLAS_E2E_ARTIFACT_DIR ? path.resolve(env.ATLAS_E2E_ARTIFACT_DIR) : null;
  return {
    artifactDir,
    desktopUrl: env.ATLAS_E2E_DESKTOP_URL || null,
    desktopRuntimeId: env.ATLAS_E2E_DESKTOP_RUNTIME_ID || null,
    headless: env.ATLAS_E2E_HEADED !== '1',
    slowMo: Number(env.ATLAS_E2E_SLOWMO ?? (artifactDir ? 60 : 0)),
    visual: env.ATLAS_E2E_VISUAL === '1' || Boolean(artifactDir),
    // Deliberate pauses between steps so recorded videos are watchable.
    pause: Number(env.ATLAS_E2E_PAUSE ?? (env.ATLAS_E2E_VISUAL === '1' || artifactDir ? 800 : 0)),
  };
}

// Launches Chromium with a freshly built development extension, a Desktop
// target (the local mock by default, or a real Desktop dev instance behind a
// recording proxy) and the fixture server. Everything lives in one disposable
// directory that is removed on close.
export async function launchAtlas({ name = 'atlas-e2e', settings = e2eSettings(), viewport = { width: 1280, height: 800 } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-e2e-'));
  const cleanups = [];
  const close = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  };
  try {
    const desktop = settings.desktopUrl
      ? await startRecordingProxy({ upstream: settings.desktopUrl, runtimeId: requireRuntimeId(settings.desktopRuntimeId) })
      : Object.assign(await startDesktopMock({ downloadsDir: path.join(root, 'desktop-downloads') }), { kind: 'mock' });
    cleanups.push(() => desktop.close());
    const fixtures = await startFixtureServer();
    cleanups.push(() => fixtures.close());

    const extensionPath = path.join(root, 'extension');
    const descriptor = path.join(root, 'runtime.json');
    await fs.writeFile(descriptor, JSON.stringify({ version: 1, kind: 'wdio', id: desktop.runtimeId, root, companionPort: desktop.port }));
    await buildExtension({ channel: 'dev', destination: extensionPath, root: repositoryRoot, testRuntime: descriptor });

    const videoDir = settings.artifactDir ? path.join(settings.artifactDir, 'video', name) : null;
    const browserDownloads = path.join(root, 'browser-downloads');
    const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
      channel: 'chromium',
      headless: settings.headless,
      slowMo: settings.slowMo,
      viewport,
      acceptDownloads: true,
      downloadsPath: browserDownloads,
      ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    cleanups.push(() => context.close());
    if (settings.visual) await context.addInitScript(visualCursorScript);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;

    const atlas = {
      context, desktop, fixtures, worker, extensionId, extensionPath, root, settings, close,
      extensionUrl: (page) => `chrome-extension://${extensionId}/${page}`,
      async openPopup(page) {
        page ??= await context.newPage();
        await page.goto(atlas.extensionUrl('popup.html'));
        return page;
      },
      async openOptions(page) {
        page ??= await context.newPage();
        await page.goto(atlas.extensionUrl('options.html'));
        return page;
      },
      // Pairs exactly like the options page button. A real Desktop shows an
      // approval prompt; approve it in the Desktop window within five minutes.
      async pair() {
        const page = await atlas.openOptions();
        const connected = desktop.connected();
        const result = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'atlas-extension.desktop.pair' }));
        if (result?.ok !== true) throw new Error(`Pairing failed: ${JSON.stringify(result?.error ?? result)}`);
        await connected;
        await page.close();
        return result.payload;
      },
      // Runs code in the extension service worker (chrome.* APIs available).
      evaluateInWorker: (fn, arg) => worker.evaluate(fn, arg),
      async screenshot(page, file) {
        if (!settings.artifactDir) return null;
        const target = path.join(settings.artifactDir, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await page.screenshot({ path: target });
        return target;
      },
    };
    return atlas;
  } catch (error) {
    await close();
    throw error;
  }
}

function requireRuntimeId(value) {
  if (!/^[a-f0-9]{24}$/.test(value ?? '')) {
    throw new Error('ATLAS_E2E_DESKTOP_RUNTIME_ID must be the 24-hex runtime_id that the isolated Desktop dev instance reports from /v1/hello.');
  }
  return value;
}

export function randomRuntimeId() {
  return randomBytes(12).toString('hex');
}
