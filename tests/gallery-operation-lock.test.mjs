import assert from 'node:assert/strict';
import test from 'node:test';
import { createGalleryOperationLock } from '../src/content/gallery-operation-lock.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

const isBusyError = (error) => error.code === 'BATCH_COLLECTION_BUSY' && error.retryable === true;

test('identical concurrent preview requests share exactly one collection promise', async () => {
  const lock = createGalleryOperationLock();
  const pending = deferred();
  let collections = 0;
  const first = lock.runPreview('same-options', () => { collections += 1; return pending.promise; });
  const second = lock.runPreview('same-options', () => { throw new Error('Duplicate collection must not run'); });
  assert.strictEqual(first, second);
  assert.equal(lock.busy, true);
  assert.equal(lock.kind, 'preview');
  await Promise.resolve();
  assert.equal(collections, 1);
  pending.resolve({ items: 200 });
  assert.deepEqual(await first, { items: 200 });
  assert.equal(lock.busy, false);
  assert.equal(lock.kind, null);
  lock.assertAvailable();
});

test('a pending preview rejects changed options and real actions without invoking their callbacks', async () => {
  const lock = createGalleryOperationLock();
  const pending = deferred();
  const preview = lock.runPreview('first-options', () => pending.promise);
  let conflictingCalls = 0;
  await assert.rejects(lock.runPreview('different-options', () => { conflictingCalls += 1; }), isBusyError);
  await assert.rejects(lock.runAction(() => { conflictingCalls += 1; }), isBusyError);
  assert.throws(() => lock.assertAvailable(), isBusyError);
  assert.equal(conflictingCalls, 0);
  pending.resolve('preview-finished');
  await preview;
  assert.equal(await lock.runAction(() => 'action-finished'), 'action-finished');
});

test('a real action holds ownership immediately through confirmation and queued work', async () => {
  const lock = createGalleryOperationLock();
  const confirmation = deferred();
  const submission = deferred();
  const action = lock.runAction(async () => {
    await confirmation.promise;
    return submission.promise;
  });
  assert.equal(lock.kind, 'action');
  assert.throws(() => lock.assertAvailable(), isBusyError);
  await assert.rejects(lock.runPreview('inspection', () => 'unexpected'), isBusyError);
  confirmation.resolve();
  await Promise.resolve();
  await assert.rejects(lock.runAction(() => 'unexpected'), isBusyError);
  submission.resolve('queued');
  assert.equal(await action, 'queued');
  assert.equal(await lock.runPreview('inspection', () => 'available'), 'available');
});

test('a failed preview releases ownership and permits a fresh inspection', async () => {
  const lock = createGalleryOperationLock();
  const pending = deferred();
  const first = lock.runPreview('options', () => pending.promise);
  const second = lock.runPreview('options', () => pending.promise);
  pending.reject(new Error('Fixture capture failed'));
  await assert.rejects(first, /Fixture capture failed/);
  await assert.rejects(second, /Fixture capture failed/);
  assert.equal(lock.busy, false);
  assert.equal(await lock.runPreview('options', () => 'retry'), 'retry');
});

test('a synchronous callback error also releases the real action lock', async () => {
  const lock = createGalleryOperationLock();
  const action = lock.runAction(() => { throw new Error('Fixture confirmation failed'); });
  await assert.rejects(action, /Fixture confirmation failed/);
  lock.assertAvailable();
  assert.equal(await lock.runAction(() => 'retry'), 'retry');
});
