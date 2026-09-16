import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { syncBrowserProviders, verifyBrowserProviders } from '../src/browser-provider-build.mjs';
import { createBrowserProviderRegistry } from '../src/provider-plugins/contract.js';
import { canonicalProviderPage } from '../src/shared/provider-page.js';
import { resolveAssetBatchContext } from '../src/content/batch-providers/index.js';

test('a separately maintained unknown provider is consumed from its actual source package', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-browser-package-'));
  try {
    const source = path.join(root, 'independent-repo/browser');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(source, 'browser-provider.json'), JSON.stringify({ schemaVersion: 1, id: 'unknown-fixture', entry: 'index.js' }));
    fs.writeFileSync(path.join(source, 'index.js'), "export default { id: 'unknown-fixture', canonicalPage: value => value === 'fixture:page' ? 'fixture:canonical' : null, batch: { resolve: () => ({ provider: 'unknown-fixture' }), collect: async () => [{ asset: { source: 'https://fixture.test/media?signed=exact' } }] } };\n");
    assert.deepEqual(syncBrowserProviders({ root, sources: [source] }), ['unknown-fixture']);
    fs.copyFileSync(new URL('../src/provider-plugins/contract.js', import.meta.url), path.join(root, 'src/provider-plugins/contract.js'));
    assert.deepEqual(verifyBrowserProviders(root), ['unknown-fixture']);
    const { browserProviders } = await import(pathToFileURL(path.join(root, 'src/provider-plugins/registry.js')).href);
    assert.equal(browserProviders[0].canonicalPage('fixture:page'), 'fixture:canonical');
    assert.equal((await browserProviders[0].batch.collect())[0].asset.source, 'https://fixture.test/media?signed=exact');
    fs.appendFileSync(path.join(root, 'src/provider-plugins/packages/unknown-fixture/index.js'), '// drift');
    assert.throws(() => verifyBrowserProviders(root), /differs from its lock/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('provider registry rejects duplicate IDs and invalid capability contracts', () => {
  assert.throws(() => createBrowserProviderRegistry([{ id: 'example' }, { id: 'example' }]), /duplicate/);
  assert.throws(() => createBrowserProviderRegistry([{ id: 'example', captureIdentity: 'remote.js' }]), /capability/);
  assert.throws(() => createBrowserProviderRegistry([{ id: 'example', batch: {} }]), /batch/);
});

test('extracted rules retain page alias identity and reject spoofed site hosts', () => {
  assert.equal(canonicalProviderPage('https://civitai.red/images/123?source=feed'), 'https://civitai.com/images/123');
  assert.equal(canonicalProviderPage('https://wallhaven.cc/w/abc123?source=feed'), 'https://wallhaven.cc/w/abc123');
  const spoof = 'https://wallhaven.cc.evil.test/w/abc123';
  assert.equal(canonicalProviderPage(spoof), spoof);
  assert.equal(resolveAssetBatchContext({ locationContext: { href: 'https://evil-deviantart.com/user/art/name-123' } }), null);
});
