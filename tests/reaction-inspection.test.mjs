import assert from 'node:assert/strict';
import test from 'node:test';
import { postAssetReaction, postAssetReactionBatch, reactionPreviewTransport } from '../src/background/desktop-api.js';
import { postAssetOrBatchReaction } from '../src/content/batch-reactions.js';
import { createBadgePresentation } from '../src/content/badge-model.js';

test('inspection uses the sent single and batch body, masking only cookie values', async () => {
  const options = {
    asset: { source: 'https://cdn.test/video.mp4', type: 'video', resolution: '640x480' },
    downloadAction: 'force', reactionType: 'love', referrerUrl: 'https://site.test/page',
    source: 'site.test', useBrowserDownload: true,
    runtimeContext: { cookies: [{ name: 'session', value: 'secret', domain: 'site.test' }], user_agent: 'Test' },
  };
  for (const [submit, operation, path] of [[postAssetReaction, 'reaction', '/v1/reactions'],
    [postAssetReactionBatch, 'reactionBatch', '/v1/reactions/batch']]) {
    const args = { ...options, items: [{ asset: options.asset, referrerUrl: options.referrerUrl, source: options.source }] };
    let sent;
    await submit({ ...args, transport: { [operation]: (_, body) => { sent = body; } } });
    const preview = await submit({ ...args, transport: reactionPreviewTransport });
    assert.deepEqual(preview, { method: 'POST', path, body: { ...sent,
      cookies: [{ name: 'session', value: '[redacted]', domain: 'site.test' }] } });
    assert.equal(sent.cookies[0].value, 'secret');
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
    assert.deepEqual(messages[0], { ...messages[1], previewOnly: true });
  } finally { globalThis.chrome = previous; }
});

test('download failure detail survives badge normalization', () => {
  const badge = createBadgePresentation({ source: 'https://test/video', type: 'video' }, null, 4,
    { download: { status: 'failed', error_code: 'download_cookies_invalid', error: '  Could not load browser cookies.  ' } });
  assert.equal(badge.failureMessage, 'Could not load browser cookies.');
  assert.equal(badge.download.error, badge.failureMessage);
});
