import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { buildExtension } from '../../src/release-core.mjs';
import { nestedLinksFixture } from './fixtures/nested-links.mjs';

test('cookie permission failure reaches the rendered widget with a recovery action and no private browser details',
  { timeout: 120_000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-session-permission-test-'));
    const runtimeId = randomBytes(12).toString('hex');
    const fixture = await nestedLinksFixture(runtimeId);
    t.after(async () => {
      await fixture.close();
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('atlas-session-permission-test-'));
      await fs.rm(root, { recursive: true, force: true });
    });
    const extension = path.join(root, 'extension');
    const descriptor = path.join(root, 'runtime.json');
    await fs.writeFile(descriptor, JSON.stringify({ version: 1, kind: 'wdio', id: runtimeId, root, companionPort: fixture.port }));
    await buildExtension({ channel: 'dev', destination: extension,
      root: path.resolve(import.meta.dirname, '../..'), testRuntime: descriptor });
    const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    t.after(() => context.close());
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const connected = fixture.connected();
    assert.equal((await options.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'atlas-extension.desktop.pair' }))).ok, true);
    await connected;
    // Controlled fault in a disposable synthetic profile, never the user's browser.
    await worker.evaluate(() => {
      globalThis.chrome.cookies.getPartitionKey = async () => {
        throw new Error('No host permissions for cookies at url: "https://private.example/?token=hidden".');
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${fixture.origin}/pages/auth`);
    const reported = fixture.nextFailure();
    await page.locator('[data-atlas-asset-badge="true"]').getByRole('button', { name: 'Like', exact: true }).click();
    const notice = page.getByText(/Reaction request failed ·/).first();
    await notice.waitFor();
    const text = await notice.innerText();
    const screenshots = process.env.ATLAS_BROWSER_ARTIFACT_DIR;
    for (const [name, width, height] of [['desktop', 1280, 900], ['narrow', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await notice.scrollIntoViewIfNeeded();
      if (screenshots) {
        await fs.mkdir(screenshots, { recursive: true });
        await page.screenshot({ path: path.join(screenshots, `session-permission-${name}.png`) });
      }
      assert.equal(await notice.isVisible(), true);
      const bounds = await notice.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Permission recovery text must fit the viewport');
    }
    assert.match(text, /site access/i);
    assert.match(text, /cookie/i);
    assert.match(text, /Reference: [0-9a-f-]{36}/);
    assert.doesNotMatch(text, /private|https:|hidden/i);
    const [report] = await reported;
    assert.equal(report.code, 'BROWSER_SESSION_UNAVAILABLE');
    assert.deepEqual(Object.keys(report).sort(), ['code', 'observedAt', 'operation', 'phase', 'requestId']);
    assert.equal(fixture.reactions.length, 0, 'Permission denial must not send an anonymous reaction');
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.unexpected, []);
  });
