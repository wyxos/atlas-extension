import assert from 'node:assert/strict';
import test from 'node:test';
import { openServiceWorkerDetails } from '../src/popup/open-service-worker.js';

const runtime = { id: 'abcdefghijklmnopabcdefghijklmnop' };

test('opens only this extension details page without querying browser tabs', async () => {
  const created = [];
  const tabs = { async create(options) { created.push(options); } };
  assert.deepEqual(await openServiceWorkerDetails({ runtime, tabs }), { ok: true });
  assert.deepEqual(created, [{ url: `chrome://extensions/?id=${runtime.id}`, active: true }]);
});

test('reports missing APIs or invalid extension IDs without navigating', async () => {
  for (const id of [undefined, '', 'invalid', 'a'.repeat(32) + '&id=another']) {
    const tabs = { create() { assert.fail('must not navigate'); } };
    assert.equal((await openServiceWorkerDetails({ runtime: { id }, tabs })).ok, false);
  }
  assert.equal((await openServiceWorkerDetails({ runtime, tabs: null })).ok, false);
});

test('browser navigation rejection returns a fixed error without raw details', async () => {
  const tabs = { async create() { throw new Error('private browser context'); } };
  assert.deepEqual(await openServiceWorkerDetails({ runtime, tabs }), {
    ok: false,
    error: 'Could not open extension details. Open Extensions from the browser menu.',
  });
});
