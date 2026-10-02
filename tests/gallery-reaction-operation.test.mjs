import assert from 'node:assert/strict';
import test from 'node:test';
import { createGalleryReactionOperation } from '../src/content/gallery-reaction-operation.js';

const item = index => ({ asset: { source: `https://media.example.test/${index}.jpg`, type: 'image' },
  referrerUrl: `https://gallery.example.test/item?slide=${index}`, source: 'gallery.example.test' });
function fixture(count, { unknown = false, onCapture, submit, acknowledge } = {}) {
  const requests = [];
  const progress = [];
  let validated = 0;
  const operation = createGalleryReactionOperation({ batchContext: {}, event: { type: 'like' }, downloadAction: 'download' }, {
    operationId: 'synthetic-operation',
    acknowledge,
    validate: async () => { validated += 1; },
    collect: async (_context, options) => {
      for (let index = 1; index <= count; index += 1) {
        options.onProgress({ phase: 'collecting', collected: index, total: unknown ? null : count });
        onCapture?.(index, operation);
        await options.onItem(item(index));
      }
      options.onProgress({ phase: 'restoring', collected: count, total: count });
      return [];
    },
    submit: async request => {
      requests.push(globalThis.structuredClone(request));
      return submit ? submit(request, requests.length, operation) : response(request);
    },
  });
  return { operation, requests, progress, validated: () => validated,
    run: () => operation.run({ onProgress: state => progress.push(state) }) };
}
function response(request) {
  return { items: request.items.map(value => ({ asset_url: value.asset.source,
    file: { id: 1, url: value.asset.source, title: 'excluded from retained results' },
    download: { requested: true, status: 'queued' }, reaction: { type: request.reactionType } })) };
}

for (const count of [51, 200, 213, 1001]) {
  test(`queues all ${count} gallery items in sequential segments of at most 50`, async () => {
    const f = fixture(count);
    const result = await f.run();
    assert.equal(result.items.length, count);
    assert.ok(f.requests.every(request => request.items.length <= 50));
    assert.deepEqual(f.requests.map(request => request.items.length),
      Array.from({ length: Math.ceil(count / 50) }, (_, index) => Math.min(50, count - index * 50)));
    assert.deepEqual(f.requests.flatMap(request => request.items.map(value => value.asset.source)),
      Array.from({ length: count }, (_, index) => item(index + 1).asset.source));
    assert.equal(new Set(f.requests.map(request => request.idempotencyKey)).size, f.requests.length);
    assert.equal(f.operation.state.phase, 'completed');
    assert.equal(f.operation.state.queued, count);
    assert.equal(f.operation.state.total, count);
    assert.ok(result.items.every(value => !Object.hasOwn(value.file, 'title')));
    assert.equal(f.validated(), f.requests.length + 1);
  });
}

test('a lost acknowledgement retries the identical segment and skips older accepted items', async () => {
  const acceptedOnServer = new Set();
  let failed = false;
  const f = fixture(200, { submit(request) {
    request.items.forEach(value => acceptedOnServer.add(value.referrerUrl));
    if (!failed && request.idempotencyKey.endsWith(':1')) {
      failed = true;
      throw Object.assign(new Error('Synthetic timeout'), { code: 'DESKTOP_TIMEOUT' });
    }
    return response(request);
  } });
  await assert.rejects(f.run(), { code: 'DESKTOP_TIMEOUT' });
  assert.equal(f.operation.state.phase, 'paused');
  assert.equal(f.operation.state.queued, 50);
  assert.equal(f.operation.state.collected, 100);
  assert.equal(f.operation.state.canRetry, true);
  const result = await f.run();
  assert.deepEqual(f.requests[2], f.requests[1]);
  assert.deepEqual(f.requests.map(request => request.idempotencyKey),
    ['synthetic-operation:0', 'synthetic-operation:1', 'synthetic-operation:1', 'synthetic-operation:2', 'synthetic-operation:3']);
  assert.equal(acceptedOnServer.size, 200);
  assert.equal(result.items.length, 200);
});

test('cancel stops collection after the accepted segment and Retry queues the remainder', async () => {
  let cancelled = false;
  const f = fixture(200, { onCapture(index, operation) {
    if (index === 74 && !cancelled) { cancelled = true; operation.cancel(); }
  } });
  await assert.rejects(f.run(), { code: 'BATCH_CANCELLED' });
  assert.equal(f.operation.state.phase, 'cancelled');
  assert.equal(f.operation.state.queued, 50);
  assert.equal(f.requests.length, 1);
  const result = await f.run();
  assert.equal(result.items.length, 200);
  assert.equal(f.requests.length, 4);
});

test('cancel during submission retains accepted response before stopping further work', async () => {
  let cancelled = false;
  const f = fixture(200, { submit(request, _index, operation) {
    if (!cancelled) { cancelled = true; operation.cancel(); }
    return response(request);
  } });
  await assert.rejects(f.run(), { code: 'BATCH_CANCELLED' });
  assert.equal(f.operation.state.queued, 50);
  assert.equal(f.requests.length, 1);
  await f.run();
  assert.equal(f.requests.length, 4);
});

test('unknown gallery size reports counts and resolves the final total', async () => {
  const f = fixture(213, { unknown: true });
  await f.run();
  assert.ok(f.progress.some(state => state.total === null && state.collected > 50));
  assert.equal(f.progress.at(-1).total, 213);
  assert.equal(f.progress.at(-1).queued, 213);
});

test('concurrent Retry calls share the operation and never submit parallel segments', async () => {
  let release;
  const firstSubmitted = new Promise(resolve => { release = resolve; });
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const f = fixture(51, { async submit(request, index) {
    if (index === 1) { announce(); await firstSubmitted; }
    return response(request);
  } });
  const first = f.operation.run();
  await started;
  assert.strictEqual(f.operation.run(), first);
  assert.equal(f.requests.length, 1);
  release();
  await first;
  assert.equal(f.requests.length, 2);
});

test('preview retains each segmented request without an accepted-download result', async () => {
  const operation = createGalleryReactionOperation({ batchContext: {}, event: { type: 'like' }, previewOnly: true }, {
    operationId: 'preview', validate: async () => {},
    collect: async (_context, options) => { for (let index = 1; index <= 200; index += 1) await options.onItem(item(index)); },
    submit: async request => ({ method: 'POST', path: '/v1/reactions/batch', body: { items: request.items } }),
  });
  const result = await operation.run();
  assert.equal(result.requests.length, 4);
  assert.ok(result.requests.every(request => request.body.items.length === 50));
});

test('an incomplete Desktop acknowledgement stays pending and retries the same segment', async () => {
  const f = fixture(51, { submit: (request, attempt) => attempt === 1 ? { items: [] } : response(request) });
  await assert.rejects(f.run(), { code: 'INVALID_RESPONSE' });
  assert.equal(f.operation.state.queued, 0);
  await f.run();
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.operation.state.queued, 51);
});

test('explicit Close releases an uncertain segment before a new operation can start', async () => {
  const released = [];
  const f = fixture(200, {
    submit: () => { throw Object.assign(new Error('Synthetic timeout'), { code: 'DESKTOP_TIMEOUT' }); },
    acknowledge: async ({ idempotencyKey }) => released.push(idempotencyKey),
  });
  await assert.rejects(f.run(), { code: 'DESKTOP_TIMEOUT' });
  await f.operation.dismiss();
  assert.deepEqual(released, ['synthetic-operation:0']);
  assert.equal(f.operation.state.queued, 0);
});

for (const malformed of ['missing', 'duplicate', 'unrelated']) {
  test(`a same-length ${malformed} acknowledgement cannot advance queued progress`, async () => {
    const f = fixture(51, { submit(request, attempt) {
      const payload = response(request);
      if (attempt === 1) payload.items[1] = malformed === 'missing' ? {}
        : { ...payload.items[1], asset_url: malformed === 'duplicate' ? payload.items[0].asset_url : 'https://unrelated.test/image' };
      return payload;
    } });
    await assert.rejects(f.run(), { code: 'INVALID_RESPONSE' });
    assert.equal(f.operation.state.queued, 0);
    await f.run();
    assert.deepEqual(f.requests[1], f.requests[0]);
    assert.equal(f.operation.state.queued, 51);
  });
}

test('compact results retain blacklist updates and explicit cleared reactions', async () => {
  const timestamp = '2026-01-01T00:00:00Z';
  const f = fixture(51, { submit(request) {
    return { items: response(request).items.map(value => ({ ...value, reaction: null, blacklisted_at: timestamp })) };
  } });
  const result = await f.run();
  assert.ok(result.items.every(value => value.reaction === null && value.blacklisted_at === timestamp));
});
