import assert from 'node:assert/strict';
import test from 'node:test';
import { createGalleryReactionRuntime } from '../src/content/gallery-reaction-runtime.js';

function fixture() {
  const errors = [];
  const cleared = [];
  const closed = [];
  const progress = [];
  let attempts = 0;
  let dismissFailed = false;
  let state = { phase: 'collecting' };
  const overlay = { showError: value => errors.push(value), clearError: value => cleared.push(value),
    showCollectionProgress: value => progress.push(value) };
  const operation = {
    get state() { return state; },
    async run(callbacks) {
      attempts++;
      state = { phase: attempts === 1 ? 'paused' : 'completed' };
      callbacks.onProgress(state);
      if (attempts === 1) throw Object.assign(new Error('Synthetic timeout'), { code: 'DESKTOP_TIMEOUT' });
      callbacks.onAccepted({ items: [{ asset_url: 'https://fixture.test/image' }] });
      return { items: [{ file: { id: 1 } }] };
    },
    async dismiss() { if (dismissFailed) throw new Error('Synthetic acknowledgement loss'); },
    cancel() {},
  };
  const runtime = createGalleryReactionRuntime({ getOverlay: () => overlay, updateBadgeState() {}, applyAccepted() {},
    closeAfterReaction: payload => closed.push(payload) }, { createOperation: () => operation });
  return { runtime, errors, cleared, closed, progress,
    failDismiss(value) { dismissFailed = value; },
    start: () => runtime.react(() => runtime.start({ id: 'synthetic', event: { type: 'like' } })) };
}

test('paused collections block new actions and previews, and Close releases the session', async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.closed.length, 0);
  let actions = 0;
  await f.runtime.react(() => { actions++; });
  await assert.rejects(f.runtime.inspect('preview', () => {}), { code: 'BATCH_COLLECTION_BUSY' });
  assert.equal(actions, 0);
  await f.runtime.dismiss();
  await f.runtime.react(() => { actions++; });
  assert.equal(actions, 1);
});

test('Retry clears the owned failure notice and closes only after the whole collection succeeds', async () => {
  const f = fixture();
  await f.start();
  const notice = f.errors[0];
  f.runtime.retry();
  await f.runtime.inspect('blocked', () => {}).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(f.cleared.includes(notice));
  assert.equal(f.closed.length, 1);
  assert.equal(f.progress.at(-1).phase, 'completed');
});

test('a failed Close keeps the pending operation visible and prevents replacement', async () => {
  const f = fixture();
  await f.start();
  f.failDismiss(true);
  await f.runtime.dismiss();
  assert.match(f.errors.at(-1), /Could not close/);
  assert.equal(f.progress.at(-1).phase, 'paused');
  let replaced = false;
  await f.runtime.react(() => { replaced = true; });
  assert.equal(replaced, false);
});

test('preview navigation cannot overlap a real action or a differing preview', async () => {
  const f = fixture();
  let finish;
  const preview = f.runtime.inspect('same', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  assert.strictEqual(f.runtime.inspect('same', () => {}), preview);
  await assert.rejects(f.runtime.inspect('different', () => {}), { code: 'BATCH_COLLECTION_BUSY' });
  let acted = false;
  await f.runtime.react(() => { acted = true; });
  assert.equal(acted, false);
  finish();
  await preview;
  await f.runtime.react(() => { acted = true; });
  assert.equal(acted, true);
});
