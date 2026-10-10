import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { buildExtension } from '../../src/release-core.mjs';
import { providerActionsFixture } from './fixtures/provider-actions.mjs';

let root; let extension; let fixture;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-provider-actions-'));
  const runtimeId = randomBytes(12).toString('hex'); fixture = await providerActionsFixture(runtimeId);
  extension = path.join(root, 'extension'); const descriptor = path.join(root, 'runtime.json');
  await fs.writeFile(descriptor, JSON.stringify({ version: 1, kind: 'wdio', id: runtimeId, root, companionPort: fixture.port }));
  await buildExtension({ channel: 'dev', destination: extension, root: path.resolve(import.meta.dirname, '../..'), testRuntime: descriptor });
});
after(async () => {
  await fixture?.close();
  if (root) { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('atlas-provider-actions-'));
    await fs.rm(root, { recursive: true, force: true }); }
});

for (const width of [1280, 460]) {
  test(`generic package actions open model and scoped creator, SPA and lifecycle at ${width}px`, { timeout: 90_000 }, async t => {
    fixture.changeProvider(true, '1@fixture'); fixture.setFailure(false);
    const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
      viewport: { width, height: 850 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    t.after(() => context.close());
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const options = await context.newPage(); await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const connected = fixture.connected();
    assert.equal((await options.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'atlas-extension.desktop.pair' }))).ok, true);
    await connected;
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    const pageUrl = `${fixture.origin}/models/2726029/synthetic?modelVersionId=3091481`;
    await page.goto(pageUrl);
    const model = page.locator('[data-atlas-browser-action="model"]');
    const creator = page.locator('[data-atlas-browser-action="creator"]');
    await model.getByRole('button').waitFor({ state: 'visible' }); await creator.getByRole('button').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-atlas-browser-action]').count(), 2);
    assert.equal(await page.locator('#nav-user [data-atlas-browser-action]').count(), 0);
    assert.equal(await creator.evaluate(host => host.closest('a')), null);
    assert.equal(await creator.evaluate(host => host.previousElementSibling.className), 'CreatorCard-module___fixture__profileDetailsContainer');
    const releaseModel = fixture.holdAction(); const modelRequest = fixture.nextAction(); await model.getByRole('button').click();
    assert.deepEqual((await modelRequest)[0], { page_url: pageUrl, target_url: pageUrl, provider: 'unrecognized-gallery', profile_version: '1@fixture', action_id: 'model' });
    const countWhileBusy = fixture.requests.length;
    assert.equal(await model.getByRole('button', { name: 'Opening…' }).isDisabled(), true);
    await model.getByRole('button').evaluate(button => button.click());
    assert.equal(fixture.requests.length, countWhileBusy, 'busy action cannot create duplicate requests');
    releaseModel();
    await model.getByRole('button', { name: 'Opened in Atlas' }).waitFor();
    const creatorRequest = fixture.nextAction(); await creator.getByRole('button').focus(); await page.keyboard.press('Enter');
    assert.equal((await creatorRequest)[0].target_url, `${fixture.origin}/user/Adel_AI`);
    await creator.getByRole('button', { name: 'Opened in Atlas' }).waitFor();
    assert.equal(page.url(), pageUrl, 'clicking the action does not follow its author anchor');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (process.env.ATLAS_BROWSER_ARTIFACT_DIR) {
      await fs.mkdir(process.env.ATLAS_BROWSER_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.ATLAS_BROWSER_ARTIFACT_DIR, `provider-actions-${width}.png`), fullPage: true });
    }
    // Replace author DOM after initial render: old host leaves with its package
    // target, and one new action uses the current URL, without a page reload.
    await page.evaluate(() => { const author = document.querySelector('#creator');
      author.outerHTML = '<a id="creator" href="/user/Changed_AI"><p>Changed_AI</p></a>'; });
    const changedRequest = fixture.nextAction(); await creator.getByRole('button', { name: 'Open user in Atlas' }).click();
    assert.equal((await changedRequest)[0].target_url, `${fixture.origin}/user/Changed_AI`);
    assert.equal(await page.locator('[data-atlas-browser-action]').count(), 2);
    fixture.setFailure(true); await creator.getByRole('button').click();
    await creator.getByRole('status').filter({ hasText: 'Could not open Atlas' }).waitFor();
    assert.equal(await creator.getByRole('button').isEnabled(), true);
    fixture.setFailure(false);
    const releaseStale = fixture.holdAction(); const staleRequest = fixture.nextAction();
    await model.getByRole('button').click(); await staleRequest;
    fixture.changeProvider(false); await model.waitFor({ state: 'detached' }); await creator.waitFor({ state: 'detached' });
    releaseStale();
    fixture.changeProvider(true, '2@fixture'); await creator.getByRole('button').waitFor();
    const updatedRequest = fixture.nextAction(); await creator.getByRole('button').click();
    assert.equal((await updatedRequest)[0].profile_version, '2@fixture');
    await page.evaluate(() => window.history.pushState({}, '', '/user/Adel_AI'));
    const profile = page.locator('[data-atlas-browser-action="user-profile"]');
    await profile.getByRole('button').waitFor(); assert.equal(await page.locator('[data-atlas-browser-action]').count(), 1);
    const profileRequest = fixture.nextAction(); await profile.getByRole('button').click();
    assert.equal((await profileRequest)[0].target_url, `${fixture.origin}/user/Adel_AI`);
    // Current DA package rule targets the deviation page heading and lets
    // Desktop derive the author from its URL; live heading placement is unverified.
    const deviationUrl = `${fixture.origin}/tolstijmoo/art/PixA-1385845293`;
    await page.goto(deviationUrl); await page.emulateMedia({ reducedMotion: 'reduce' });
    const deviation = page.locator('[data-atlas-browser-action="deviation-user"]');
    await deviation.getByRole('button').waitFor();
    assert.equal(await deviation.evaluate(host => host.previousElementSibling.tagName), 'H1');
    const deviationRequest = fixture.nextAction(); await deviation.getByRole('button').click();
    assert.deepEqual((await deviationRequest)[0], { page_url: deviationUrl, target_url: deviationUrl,
      provider: 'unrecognized-gallery', profile_version: '2@fixture', action_id: 'deviation-user' });
    await deviation.getByRole('button', { name: 'Opened in Atlas' }).waitFor();
    assert.equal(await deviation.getByRole('button').evaluate(button => globalThis.getComputedStyle(button).transitionDuration), '0s');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (process.env.ATLAS_BROWSER_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.ATLAS_BROWSER_ARTIFACT_DIR,
      `provider-actions-deviantart-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(fixture.unexpected, []);
  });
}

test('versionless model URL observes selected AIR at click and prefers AIR placement over heading fallback', { timeout: 90_000 }, async t => {
  fixture.changeProvider(true, '3@fixture'); fixture.setFailure(false);
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    viewport: { width: 1280, height: 850 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  t.after(() => context.close());
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const options = await context.newPage(); await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
  const connected = fixture.connected();
  assert.equal((await options.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'atlas-extension.desktop.pair' }))).ok, true);
  await connected;
  const page = await context.newPage(); const pageUrl = `${fixture.origin}/models/2726029/synthetic`;
  await page.goto(pageUrl); const model = page.locator('[data-atlas-browser-action="model"]');
  await model.getByRole('button').waitFor();
  assert.equal(await model.evaluate(host => host.previousElementSibling.id), 'model-target', 'AIR wins even though heading occurs first');
  const observed = fixture.nextAction(); await model.getByRole('button').click();
  assert.deepEqual((await observed)[0], { page_url: pageUrl, target_url: pageUrl, provider: 'unrecognized-gallery',
    profile_version: '3@fixture', action_id: 'model', observations: [{ parameter: 'modelVersionId', value: 'civitai:2726029@3064584+2943406' }] });
  await model.getByRole('button', { name: 'Opened in Atlas' }).waitFor();
  await page.locator('#model-target code').evaluate(code => { code.textContent = 'civitai:2726029@9876543'; });
  const changed = fixture.nextAction(); await model.getByRole('button').click();
  assert.equal((await changed)[0].observations[0].value, 'civitai:2726029@9876543');
  await model.getByRole('button', { name: 'Opened in Atlas' }).waitFor();
  await page.locator('#model-target code').evaluate(code => { code.textContent = 'civitai:' + '1'.repeat(129); });
  const oversize = fixture.nextAction(); await model.getByRole('button').click();
  assert.equal((await oversize)[0].observations, undefined);
  await model.getByRole('button', { name: 'Opened in Atlas' }).waitFor();
  await page.locator('#model-target').evaluate(element => element.remove());
  await model.getByRole('button', { name: 'Open model in Atlas' }).waitFor();
  assert.equal(await model.evaluate(host => host.previousElementSibling.tagName), 'H1');
  const noAir = fixture.nextAction(); await model.getByRole('button').click(); assert.equal((await noAir)[0].observations, undefined);
  await page.evaluate(() => { const row = document.createElement('section'); row.id = 'model-target';
    row.className = 'ModelVersionDetails-module___fixture__detailRowTop';
    row.innerHTML = '<code class="ModelURN-module___fixture__code">civitai:2726029@123</code>';
    document.querySelector('main').append(row); });
  await model.getByRole('button', { name: 'Open model in Atlas' }).waitFor();
  assert.equal(await model.evaluate(host => host.previousElementSibling.id), 'model-target');
  assert.equal(await page.locator('[data-atlas-browser-action="model"]').count(), 1);
  assert.deepEqual(fixture.unexpected, []);
});
