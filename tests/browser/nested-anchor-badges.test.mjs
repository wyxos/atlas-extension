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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-nested-anchor-test-'));
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
    assert.ok(path.basename(root).startsWith('atlas-nested-anchor-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});

const cases = [
  { reaction: 'love', button: 'Love', label: 'Loved', width: 1280 },
  { reaction: 'like', button: 'Like', label: 'Liked', width: 1280 },
  { reaction: 'funny', button: 'Funny', label: 'Funny', width: 1280 },
  { reaction: 'like', button: 'Like', label: 'Liked', width: 460 },
];

for (const scenario of cases) {
  // Bounded test deadline only: a missing browser event must fail the test.
  // State synchronization uses browser/DOM/WebSocket events, never polling.
  test(`A -> B -> C updates A link 3: ${scenario.reaction}, ${scenario.width}px`,
    { timeout: 90_000 }, async t => {
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium', headless: true,
        viewport: { width: scenario.width, height: 1000 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      t.after(() => context.close());
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const options = await context.newPage();
      await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
      const connection = fixture.connected();
      const paired = await options.evaluate(() => globalThis.chrome.runtime.sendMessage({
        type: 'atlas-extension.desktop.pair',
      }));
      assert.equal(paired.ok, true);
      await connection;
      const a = await context.newPage();
      // Retain an actual DOM reference: any reload invalidates this sentinel.
      const ready = fixture.nextStatus(body => JSON.stringify(body).includes('/pages/4'));
      await a.goto(`${fixture.origin}/pages/a`);
      await ready;
      await a.evaluate(() => {
        globalThis.originalLink3 = document.querySelector('#link-3');
        // Playwright emulates focus on every page. Count real activation events
        // rather than treating document.hasFocus() as Chrome tab-strip state.
        globalThis.activationEvents = 0;
        for (const event of ['focus', 'pageshow']) {
          window.addEventListener(event, () => { globalThis.activationEvents += 1; });
        }
      });
      const bOpened = a.waitForEvent('popup');
      const bReady = fixture.nextStatus(body => {
        const urls = (body.match_items ?? []).map(item => item.match_url);
        return urls.includes(`${fixture.origin}/pages/3`) && !urls.includes(`${fixture.origin}/pages/4`);
      });
      await a.locator('#link-2').click();
      const b = await bOpened;
      await b.waitForLoadState();
      await bReady;
      await assertBadge(a, 2, 'Open in another tab', 0);
      assert.equal(await badgeSnapshot(a, 3), null);
      const cOpened = b.waitForEvent('popup');
      await b.locator('#link-3').click();
      const c = await cOpened;
      await c.waitForLoadState();
      assert.equal(await a.evaluate(() => globalThis.activationEvents), 0);
      await assertBadge(a, 3, 'Open in another tab', 0);
      await assertBadge(b, 3, 'Open in another tab', 0);
      // These are the actual popups emitted by clicks on A and B, not three
      // tabs independently manufactured by the test harness.
      assert.equal(await b.opener(), a);
      assert.equal(await c.opener(), b);
      assert.equal(b.url(), `${fixture.origin}/pages/2`);
      assert.equal(c.url(), `${fixture.origin}/pages/3`);
      const reactionRequest = fixture.nextReaction();
      const reactionBadge = c.locator('[data-atlas-asset-badge="true"]');
      await reactionBadge.getByRole('button', { name: scenario.button, exact: true }).click();
      const [request] = await reactionRequest;
      assert.equal(request.type, scenario.reaction);
      assert.equal(request.referrer_url, `${fixture.origin}/pages/3`);
      assert.equal(request.asset_url, `${fixture.origin}/media/full-3.svg`);
      assert.equal(request.referrer_match_identity.match_url, `${fixture.origin}/pages/3`);
      fixture.push('queued', 0, { reaction: true });
      await assertBadge(a, 3, scenario.label, 0);
      await assertBadge(b, 3, scenario.label, 0);
      // Real native progress omits the reaction snapshot. The selected
      // reaction must survive these incremental updates on both referring tabs.
      fixture.push('downloading', 42);
      await assertBadge(a, 3, scenario.label, 42);
      await assertBadge(b, 3, scenario.label, 42);
      if (process.env.ATLAS_BROWSER_ARTIFACT_DIR) {
        await fs.mkdir(process.env.ATLAS_BROWSER_ARTIFACT_DIR, { recursive: true });
        await a.screenshot({ path: path.join(process.env.ATLAS_BROWSER_ARTIFACT_DIR,
          `nested-anchor-${scenario.reaction}-${scenario.width}.png`) });
      }
      fixture.push('downloading', 73);
      await assertBadge(a, 3, scenario.label, 73);
      fixture.push('completed', 100, { reaction: true });
      await assertBadge(a, 3, scenario.label, 100);
      await assertBadge(b, 3, scenario.label, 100);
      assert.equal(await badgeSnapshot(a, 1), null);
      assert.equal(await badgeSnapshot(a, 4), null);
      await assertBadge(a, 2, 'Open in another tab', 0);
      assert.equal(await a.evaluate(() => globalThis.originalLink3 === document.querySelector('#link-3')), true);
      assert.equal(await a.evaluate(() => globalThis.activationEvents), 0);
      assert.deepEqual(fixture.unexpected, []);
    });
}

test('browser session failure shows its real code and relays the same safe reference to Desktop',
  { timeout: 90_000 }, async t => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    t.after(() => context.close());
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const connected = fixture.connected();
    assert.equal((await options.evaluate(() => globalThis.chrome.runtime.sendMessage({
      type: 'atlas-extension.desktop.pair',
    }))).ok, true);
    await connected;
    const page = await context.newPage();
    await page.goto(`${fixture.origin}/pages/3`);
    await worker.evaluate(() => {
      // Synthetic unavailable cookie store exercises the real preparation path.
      globalThis.chrome.cookies.getAllCookieStores = callback => callback([]);
    });
    const previousReactions = fixture.reactions.length;
    const received = fixture.nextFailure();
    await page.locator('[data-atlas-asset-badge="true"]').getByRole('button', { name: 'Like', exact: true }).click();
    const [report] = await received;
    assert.equal(report.code, 'BROWSER_SESSION_UNAVAILABLE');
    assert.equal(report.phase, 'preparing-session');
    assert.match(report.requestId, /^[0-9a-f-]{36}$/);
    const alert = page.getByRole('alert').filter({ hasText: 'BROWSER_SESSION_UNAVAILABLE' }).first();
    await alert.waitFor({ state: 'visible' });
    assert.ok((await alert.textContent()).includes(report.requestId));
    assert.equal(fixture.reactions.length, previousReactions);
    const history = await options.evaluate(() => globalThis.chrome.runtime.sendMessage({
      type: 'atlas-extension.desktop.diagnostics',
    }));
    assert.equal(history.payload.reactionFailures[0].requestId, report.requestId);
    const historyRows = options.getByRole('region', { name: 'Reaction failures' });
    await historyRows.getByText(report.code, { exact: true }).waitFor({ state: 'visible' });
    assert.ok((await historyRows.textContent()).includes(report.requestId));
    for (const width of [1280, 460]) {
      await options.setViewportSize({ width, height: 1000 });
      assert.equal(await options.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      if (process.env.ATLAS_BROWSER_ARTIFACT_DIR) {
        await fs.mkdir(process.env.ATLAS_BROWSER_ARTIFACT_DIR, { recursive: true });
        await options.screenshot({ path: path.join(process.env.ATLAS_BROWSER_ARTIFACT_DIR,
          `reaction-history-${width}.png`), fullPage: true });
      }
    }
    assert.doesNotMatch(JSON.stringify(report), /127\.0\.0\.1|fixture-token|cookie.*value|stack|asset_url/);
    assert.deepEqual(fixture.unexpected, []);
  });

function badgeSnapshot(page, link) {
  return page.locator(`#link-${link}`).evaluate(anchor => {
    const badge = anchor.querySelector('[data-atlas-extension-badge-host]')?.shadowRoot
      ?.querySelector('[data-atlas-referrer-badge="true"]');
    if (!badge) return null;
    return { label: badge.querySelector('.atlas-referrer-reaction').getAttribute('aria-label'),
      percent: Number.parseFloat(badge.querySelector('.atlas-static-progress-fill').style.width) };
  });
}

async function assertBadge(page, link, label, percent) {
  // Observe the real open shadow-root DOM while A stays in the background.
  // A focus-driven status refresh must not substitute for event delivery.
  const actual = await page.locator(`#link-${link}`).evaluate((anchor, expected) => new Promise((resolve, reject) => {
    const observers = new Map();
    let last = null;
    // A one-shot assertion deadline turns missing DOM delivery into a useful
    // failure. It never requests state or retries a status lookup.
    const deadline = setTimeout(() => {
      for (const observer of observers.values()) observer.disconnect();
      reject(new Error(`Expected ${JSON.stringify(expected)}, observed ${JSON.stringify(last)}`));
    }, 15_000);
    const inspect = () => {
      const host = anchor.querySelector('[data-atlas-extension-badge-host]');
      if (host?.shadowRoot && !observers.has(host.shadowRoot)) {
        const observer = new MutationObserver(inspect);
        observer.observe(host.shadowRoot, { attributes: true, childList: true, subtree: true });
        observers.set(host.shadowRoot, observer);
      }
      const badge = host?.shadowRoot?.querySelector('[data-atlas-referrer-badge="true"]');
      if (!badge) return;
      const actual = { label: badge.querySelector('.atlas-referrer-reaction').getAttribute('aria-label'),
        percent: Number.parseFloat(badge.querySelector('.atlas-static-progress-fill').style.width) };
      last = actual;
      if (actual.label === expected.label && actual.percent === expected.percent) {
        globalThis.clearTimeout(deadline);
        for (const observer of observers.values()) observer.disconnect();
        resolve(actual);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(anchor, { attributes: true, childList: true, subtree: true });
    observers.set(anchor, observer);
    inspect();
  }), { label, percent });
  assert.deepEqual(actual, { label, percent });
}
