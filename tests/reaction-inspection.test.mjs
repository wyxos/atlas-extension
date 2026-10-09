import assert from 'node:assert/strict';
import test from 'node:test';
import { createGalleryReactionRuntime } from '../src/content/gallery-reaction-runtime.js';
import { createReactionInspector } from '../src/content/reaction-inspection.js';

import { postAssetReaction, postAssetReactionBatch, reactionPreviewTransport } from '../src/background/desktop-api.js';
import { postAssetOrBatchReaction } from '../src/content/batch-reactions.js';
import { createBadgePresentation } from '../src/content/badge-model.js';

test('inspection uses the sent single and batch body, masking cookie and scoped authentication header values', async () => {
  const options = {
    asset: { source: 'https://cdn.test/video.mp4', type: 'video', resolution: '640x480' },
    downloadAction: 'force', reactionType: 'love', referrerUrl: 'https://site.test/page',
    source: 'site.test', useBrowserDownload: true,
    runtimeContext: { cookies: [{ name: 'session', value: 'secret', domain: 'site.test' }], user_agent: 'Test',
      browser_session: { version: 1, captured_at: 100, cookie_scope: { partition_supported: false },
        request_headers: [{ url: 'https://cdn.test/video.mp4', headers: [
          { name: 'authorization', value: 'Bearer synthetic' }, { name: 'x-media-token', value: 'synthetic' },
        ] }] } },
  };
  for (const [submit, operation, path] of [[postAssetReaction, 'reaction', '/v1/reactions'],
    [postAssetReactionBatch, 'reactionBatch', '/v1/reactions/batch']]) {
    const args = { ...options, items: [{ asset: options.asset, referrerUrl: options.referrerUrl, source: options.source }] };
    let sent;
    await submit({ ...args, transport: { [operation]: (_, body) => { sent = body; } } });
    const preview = await submit({ ...args, transport: reactionPreviewTransport });
    assert.deepEqual(preview, { method: 'POST', path, body: { ...sent,
      cookies: [{ name: 'session', value: '[redacted]', domain: 'site.test' }],
      browser_session: { ...sent.browser_session, request_headers: [{ url: 'https://cdn.test/video.mp4', headers: [
        { name: 'authorization', value: '[redacted]' }, { name: 'x-media-token', value: '[redacted]' },
      ] }] },
    } });
    assert.equal(sent.cookies[0].value, 'secret');
    assert.equal(sent.browser_session.request_headers[0].headers[0].value, 'Bearer synthetic');
  }
});

test('content inspection flags the same request without submitting a reaction', async () => {
  const previous = globalThis.chrome;
  const messages = [];
  globalThis.chrome = { runtime: { sendMessage: (message, done) => { messages.push(message); done({ ok: true, payload: {} }); } } };
  try {
    const args = { asset: { source: 'https://cdn.test/v.mp4' }, currentState: {}, event: { type: 'like' },
      locationContext: { href: 'https://site.test/page', hostname: 'site.test' } };
    await postAssetOrBatchReaction({ ...args, previewOnly: true });
    await postAssetOrBatchReaction(args);
    assert.deepEqual(messages[0], { ...messages[1], previewOnly: true, requestId: messages[0].requestId });
    assert.notEqual(messages[0].requestId, messages[1].requestId);
  } finally { globalThis.chrome = previous; }
});

test('download failure detail survives badge normalization', () => {
  const badge = createBadgePresentation({ source: 'https://test/video', type: 'video' }, null, 4,
    { download: { status: 'failed', error_code: 'download_cookies_invalid', error: '  Could not load browser cookies.  ' } });
  assert.equal(badge.failureMessage, 'Could not load browser cookies.');
  assert.equal(badge.download.error, badge.failureMessage);
});

function fixture() {
  const assets = new Map([['one', { source: 'https://fixture.test/media?slide=1' }]]);
  const contexts = new Map([['one', { provider: 'unknown', epoch: 1, profile: { galleryKey: 'synthetic', profileVersion: 1 } }]]);
  const states = new Map([['one', { batch: { checked: true } }]]);
  const runtime = createGalleryReactionRuntime({ getOverlay: () => ({ showError() {} }), updateBadgeState() {}, applyAccepted() {}, closeAfterReaction() {} });
  let release;
  let calls = 0;
  let cancelled = false;
  const inspect = createReactionInspector({ assetsById: assets, batchContextsById: contexts, badgeStatesById: states,
    runtime, documentContext: {}, locationContext: { href: 'https://fixture.test/gallery' },
    submit: options => {
      calls++;
      options.onOperation({ cancel() { cancelled = true; release(); } });
      return new Promise(resolve => { release = resolve; });
    } });
  return { inspect, runtime, assets, contexts, states, release: () => release(),
    calls: () => calls, cancelled: () => cancelled };
}

test('same gallery preview survives slide changes, while changed Batch options cannot share its navigation', async () => {
  const f = fixture();
  const request = { id: 'one', type: 'like' };
  const first = f.inspect(request);
  await Promise.resolve();
  f.assets.set('one', { source: 'https://fixture.test/media?slide=2' });
  assert.strictEqual(f.inspect(request), first);
  f.states.set('one', { batch: { checked: false } });
  await assert.rejects(f.inspect(request), { code: 'BATCH_COLLECTION_BUSY' });
  assert.equal(f.calls(), 1);
  f.release();
  await first;
});

test('provider session changes cannot share an existing gallery preview', async () => {
  const f = fixture();
  const first = f.inspect({ id: 'one', type: 'like' });
  await Promise.resolve();
  f.contexts.set('one', { ...f.contexts.get('one'), epoch: 2 });
  await assert.rejects(f.inspect({ id: 'one', type: 'like' }), { code: 'BATCH_COLLECTION_BUSY' });
  f.release();
  await first;
});

test('closing only the owning inspection cancels pending navigation and releases the page', async () => {
  const f = fixture();
  const first = f.inspect({ id: 'one', type: 'like' });
  await Promise.resolve();
  f.runtime.cancelInspection({ id: 'other' });
  assert.equal(f.cancelled(), false);
  f.runtime.cancelInspection({ id: 'one' });
  await first;
  assert.equal(f.cancelled(), true);
  let acted = false;
  await f.runtime.react(() => { acted = true; });
  assert.equal(acted, true);
});
