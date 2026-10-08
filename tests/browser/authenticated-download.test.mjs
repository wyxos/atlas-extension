import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { buildExtension } from '../../src/release-core.mjs';
import { nestedLinksFixture } from './fixtures/nested-links.mjs';

// Local HTTP and simulated Desktop only; a disposable profile runs the actual
// packed extension, MAIN fetch/XHR bridge, cookie API and authenticated handoff.
test('browser handoff preserves HttpOnly cookies and actual fetch/XHR bearer headers from the originating tab',
  { timeout: 120_000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-authenticated-download-test-'));
    const runtimeId = randomBytes(12).toString('hex');
    const fixture = await nestedLinksFixture(runtimeId);
    t.after(async () => {
      await fixture.close();
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('atlas-authenticated-download-test-'));
      await fs.rm(root, { recursive: true, force: true });
    });
    const extension = path.join(root, 'extension');
    const descriptor = path.join(root, 'runtime.json');
    await fs.writeFile(descriptor, JSON.stringify({ version: 1, kind: 'wdio', id: runtimeId, root, companionPort: fixture.port }));
    await buildExtension({ channel: 'dev', destination: extension,
      root: path.resolve(import.meta.dirname, '../..'), testRuntime: descriptor });
    console.log('auth fixture: development extension built');
    const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    t.after(() => context.close());
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    console.log('auth fixture: browser worker active');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const connected = fixture.connected();
    assert.equal((await options.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'atlas-extension.desktop.pair' }))).ok, true);
    console.log('auth fixture: paired');
    await connected;
    console.log('auth fixture: events connected');
    await context.addCookies([{ name: 'auth_session', value: 'synthetic-cookie', url: fixture.origin, httpOnly: true }]);
    await context.addCookies([{ name: 'fragment_session', value: 'synthetic-fragment-cookie', domain: 'localhost', path: '/media/', httpOnly: true }]);
    const page = await context.newPage();
    await page.goto(`${fixture.origin}/pages/auth`);
    const other = await context.newPage();
    await other.goto(`${fixture.origin}/pages/auth`);
    await other.evaluate(() => fetch('/media/full-3.svg', { headers: { Authorization: 'Bearer other-tab' } }));
    await page.evaluate(async port => {
      await fetch('/media/manifest.m3u8', { headers: { Authorization: 'Bearer manifest-token' } });
      await fetch(`http://localhost:${port}/media/fragment.ts`, { headers: { 'X-Media-Token': 'fragment-token' } });
    }, fixture.port);
    const source = `${fixture.origin}/media/full-3.svg`;
    for (const mode of ['fetch', 'xhr']) {
      await page.evaluate(mode => mode === 'fetch'
        ? fetch('/media/full-3.svg', { headers: { Authorization: 'Bearer fetch-token', 'X-Media-Token': 'synthetic-token' } })
        : new Promise((resolve, reject) => {
          const request = new globalThis.XMLHttpRequest();
          request.open('GET', '/media/full-3.svg');
          request.setRequestHeader('Authorization', 'Bearer xhr-token');
          request.setRequestHeader('X-Media-Token', 'synthetic-token');
          request.onload = () => resolve(); request.onerror = reject; request.send();
        }), mode);
      console.log(`auth fixture: ${mode} request accepted`);
      const received = fixture.nextReaction();
      await page.locator('[data-atlas-asset-badge="true"]').getByRole('button', { name: mode === 'fetch' ? 'Like' : 'Love', exact: true }).click();
      if (mode === 'xhr') await page.getByRole('button', { name: 'React + redownload', exact: true }).click();
      const [body] = await received;
      console.log(`auth fixture: ${mode} download handoff received`);
      assert.equal(body.asset_url, source);
      const cookie = body.cookies.find(cookie => cookie.name === 'auth_session');
      assert.equal(cookie.value, 'synthetic-cookie');
      assert.equal(cookie.http_only, true);
      assert.equal(cookie.host_only, true);
      assert.equal(body.browser_session.version, 1);
      assert.equal(body.browser_session.cookie_scope.partition_supported, true);
      const headers = body.browser_session.request_headers.find(scope => scope.url === source).headers;
      assert.equal(headers.find(header => header.name === 'authorization').value, `Bearer ${mode}-token`);
      assert.equal(headers.find(header => header.name === 'x-media-token').value, 'synthetic-token');
      assert.ok(headers.some(header => header.name === 'referer'));
      assert.ok(headers.every(header => header.name !== 'cookie'));
      const fragment = body.browser_session.request_headers.find(scope => scope.url === `http://localhost:${fixture.port}/media/fragment.ts`);
      assert.equal(fragment.headers.find(header => header.name === 'x-media-token').value, 'fragment-token');
      const fragmentCookie = body.cookies.find(cookie => cookie.name === 'fragment_session');
      assert.equal(fragmentCookie.value, 'synthetic-fragment-cookie');
      assert.equal(fragmentCookie.domain, 'localhost');
      assert.equal(fragmentCookie.path, '/media/');
      assert.equal(fragmentCookie.http_only, true);
      if (mode === 'fetch') await page.locator('[data-atlas-asset-badge="true"] button.atlas-static-icon-like')
        .evaluate(button => new Promise((resolve, reject) => {
          // A bounded assertion deadline only. DOM events establish that the
          // accepted response reached Vue before the next reaction is clicked.
          const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('Reaction response did not render')); }, 15000);
          const inspect = () => {
            if (!button.disabled && button.classList.contains('atlas-static-icon-active')) {
              globalThis.clearTimeout(deadline); observer.disconnect(); resolve();
            }
          };
          const observer = new globalThis.MutationObserver(inspect);
          observer.observe(button, { attributes: true }); inspect();
        }));
    }
    await page.evaluate(origin => {
      for (const name of ['a', 'b']) {
        const frame = document.createElement('iframe'); frame.id = `auth-frame-${name}`;
        frame.src = `${origin}/pages/auth?frame=${name}`; frame.width = '800'; frame.height = '500';
        document.body.append(frame);
      }
    }, fixture.origin);
    const a = page.frameLocator('#auth-frame-a'), b = page.frameLocator('#auth-frame-b');
    await a.locator('[data-atlas-asset-badge="true"]').waitFor();
    await b.locator('[data-atlas-asset-badge="true"]').waitFor();
    await a.locator('body').evaluate(() => fetch('/media/full-3.svg', { headers: { Authorization: 'Bearer frame-a' } }));
    await b.locator('body').evaluate(() => fetch('/media/full-3.svg', { headers: { Authorization: 'Bearer frame-b' } }));
    const frameReaction = fixture.nextReaction();
    await a.getByRole('button', { name: 'Like', exact: true }).click();
    const [frameBody] = await frameReaction;
    const frameHeaders = frameBody.browser_session.request_headers.find(scope => scope.url === source).headers;
    assert.equal(frameHeaders.find(header => header.name === 'authorization').value, 'Bearer frame-a');
    assert.deepEqual(fixture.unexpected, []);
  });
