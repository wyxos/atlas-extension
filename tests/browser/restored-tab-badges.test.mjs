import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { buildExtension } from '../../src/release-core.mjs';
import { nestedLinksFixture } from './fixtures/nested-links.mjs';

let root;
let extension;
let fixture;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-restored-tabs-test-'));
  const runtimeId = randomBytes(12).toString('hex');
  fixture = await nestedLinksFixture(runtimeId);
  extension = path.join(root, 'extension');
  const descriptor = path.join(root, 'runtime.json');
  await fs.writeFile(descriptor, JSON.stringify({ version: 1, kind: 'wdio',
    id: runtimeId, root, companionPort: fixture.port }));
  await buildExtension({ channel: 'dev', destination: extension,
    root: path.resolve(import.meta.dirname, '../..'), testRuntime: descriptor });
});

after(async () => {
  await fixture?.close();
  if (root) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('atlas-restored-tabs-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const width of [1280, 460]) {
  test(`browser restart restores all three open-link badges at ${width}px`,
    { timeout: 90_000 }, async t => {
      const profile = path.join(root, `profile-${width}`);
      const errors = [];
      const launch = async () => {
        const browser = await chromium.launchPersistentContext(profile, {
          channel: 'chromium', headless: true, viewport: { width, height: 1000 },
          args: ['--restore-last-session', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
        });
        const watch = page => {
          page.on('pageerror', error => errors.push(error.message));
          page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        };
        browser.on('page', watch);
        browser.pages().forEach(watch);
        return browser;
      };
      let context = await launch();
      t.after(() => context.close());
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const optionsUrl = `chrome-extension://${new URL(worker.url()).hostname}/options.html`;
      const options = await context.newPage();
      await options.goto(optionsUrl);
      const connected = fixture.connected();
      assert.equal((await options.evaluate(() => globalThis.chrome.runtime.sendMessage({
        type: 'atlas-extension.desktop.pair',
      }))).ok, true);
      await connected;
      const a = await context.newPage();
      await a.goto(`${fixture.origin}/pages/a`);
      for (const number of [2, 3, 4]) {
        const popup = a.waitForEvent('popup');
        await a.locator(`#link-${number}`).click();
        await (await popup).waitForLoadState();
        await waitForBadge(a, number, true);
      }
      for (const page of context.pages()) {
        if (!page.url().startsWith(fixture.origin)) await page.close();
      }
      await a.bringToFront();
      await screenshot(a, `restored-tabs-before-${width}.png`);
      await context.close();

      context = await launch();
      const restoredA = await restoredPage(context, `${fixture.origin}/pages/a`);
      await restoredA.waitForLoadState();
      const probe = await context.newPage();
      await probe.goto(optionsUrl);
      const response = await probe.evaluate(origin => globalThis.chrome.runtime.sendMessage({
        type: 'atlas-extension.open-referrer-counts',
        referrerUrls: [2, 3, 4].map(n => `${origin}/pages/${n}`),
      }), fixture.origin);
      assert.equal(response.ok, true);
      for (const number of [2, 3, 4]) {
        assert.equal(response.payload.counts[`${fixture.origin}/pages/${number}`], 1);
        try {
          await waitForBadge(restoredA, number, true);
        } catch (error) {
          await screenshot(restoredA, `restored-tabs-failure-${width}.png`);
          t.diagnostic(JSON.stringify(await restoredA.evaluate(() => ({
            ready: document.readyState, viewport: [globalThis.innerWidth, globalThis.innerHeight],
            links: [...document.querySelectorAll('main a')].map(anchor => ({
              id: anchor.id, top: anchor.getBoundingClientRect().top,
              labels: [...(anchor.querySelector('[data-atlas-extension-badge-host]')?.shadowRoot
                ?.querySelectorAll('[aria-label]') ?? [])].map(node => node.getAttribute('aria-label')),
            })),
          }))));
          throw error;
        }
      }
      await probe.close();
      await restoredA.bringToFront();
      assert.equal(await restoredA.evaluate(() => document.documentElement.scrollWidth > globalThis.innerWidth), false);
      await screenshot(restoredA, `restored-tabs-after-${width}.png`);
      const restoredB = await restoredPage(context, `${fixture.origin}/pages/2`);
      await restoredB.close();
      await waitForBadge(restoredA, 2, false);
      await waitForBadge(restoredA, 3, true);
      await waitForBadge(restoredA, 4, true);
      assert.deepEqual(fixture.unexpected, []);
      assert.deepEqual(errors, []);
    });
}

function restoredPage(context, url) {
  const existing = context.pages().find(page => page.url() === url);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const watched = new Map();
    // One assertion deadline bounds a missing restore event; no state polling.
    const deadline = setTimeout(() => { cleanup(); reject(new Error('Expected restored fixture page')); }, 15_000);
    const cleanup = () => {
      globalThis.clearTimeout(deadline);
      context.off('page', watch);
      for (const [page, listener] of watched) page.off('framenavigated', listener);
    };
    const watch = page => {
      const check = () => { if (page.url() === url) { cleanup(); resolve(page); } };
      watched.set(page, check);
      page.on('framenavigated', check);
      check();
    };
    context.on('page', watch);
    context.pages().forEach(watch);
  });
}

async function waitForBadge(page, link, present) {
  await page.locator(`#link-${link}`).evaluate((anchor, expected) => new Promise((resolve, reject) => {
    const observers = new Map();
    // Only a failure deadline; mutations drive assertions without retrying scans.
    const deadline = setTimeout(() => { cleanup(); reject(new Error('Restored-tab badge did not update')); }, 15_000);
    const cleanup = () => { globalThis.clearTimeout(deadline); for (const observer of observers.values()) observer.disconnect(); };
    const inspect = () => {
      const shadow = anchor.querySelector('[data-atlas-extension-badge-host]')?.shadowRoot;
      if (shadow && !observers.has(shadow)) observe(shadow);
      const badge = shadow?.querySelector('[aria-label="Open in another tab"]');
      if (Boolean(badge) === expected) { cleanup(); resolve(); }
    };
    const observe = target => {
      const observer = new MutationObserver(inspect);
      observer.observe(target, { attributes: true, childList: true, subtree: true });
      observers.set(target, observer);
    };
    observe(anchor);
    inspect();
  }), present);
}

async function screenshot(page, filename) {
  if (!process.env.ATLAS_BROWSER_ARTIFACT_DIR) return;
  await fs.mkdir(process.env.ATLAS_BROWSER_ARTIFACT_DIR, { recursive: true });
  const { width } = page.viewportSize();
  await page.screenshot({ path: path.join(process.env.ATLAS_BROWSER_ARTIFACT_DIR, filename),
    clip: { x: 0, y: 0, width, height: width < 600 ? 740 : 260 } });
}
