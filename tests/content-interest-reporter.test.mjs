import assert from 'node:assert/strict';
import test from 'node:test';

import { createContentInterestReporter } from '../src/content/content-interest-reporter.js';

test('content reports exact rendered source and referrer interests only when they change', async () => {
  const messages = [];
  let interests = {
    referrerUrls: ['https://example.test/post/1', 'https://example.test/post/1'],
    sourceUrls: ['https://cdn.example.test/one.jpg'],
  };
  const reporter = createContentInterestReporter({
    documentContext: { location: { href: 'https://example.test/feed' } },
    getInterests: () => interests,
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({ ok: true, payload: { resyncRequired: false } });
      },
    },
    windowContext: { location: { href: 'https://example.test/feed' } },
  });

  reporter.report();
  reporter.report();
  interests = { ...interests, sourceUrls: [...interests.sourceUrls, 'https://cdn.example.test/two.jpg'] };
  reporter.report();

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0].referrerUrls, ['https://example.test/post/1']);
  assert.deepEqual(messages[1].sourceUrls, [
    'https://cdn.example.test/one.jpg',
    'https://cdn.example.test/two.jpg',
  ]);
  assert.equal(messages[0].documentId, messages[1].documentId);
  assert.deepEqual(messages.map((message) => message.sequence), [1, 2]);
});

test('restored content performs the requested targeted resync', () => {
  let resyncs = 0;
  const reporter = createContentInterestReporter({
    getInterests: () => ({ referrerUrls: [], sourceUrls: [] }),
    onResyncRequired: () => { resyncs += 1; },
    runtime: {
      sendMessage(_message, callback) {
        callback({ ok: true, payload: { resyncRequired: true } });
      },
    },
  });

  reporter.report();
  assert.equal(resyncs, 1);
});

test('departing frames retire their document and restored frames force a fresh report', async () => {
  const listeners = {};
  const messages = [];
  const reporter = createContentInterestReporter({
    getInterests: () => ({ sourceUrls: ['https://example.test/video.mp4'] }),
    windowContext: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    runtime: { sendMessage: (message, callback) => { messages.push(message); callback({ ok: true }); } },
  });
  reporter.report();
  listeners.pagehide();
  listeners.pageshow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(messages.map((message) => message.type), [
    'atlas-extension.content-interests', 'atlas-extension.content-interests-remove',
    'atlas-extension.content-interests',
  ]);
  assert.equal(messages[1].documentId, messages[0].documentId);
  assert.deepEqual(messages[2].sourceUrls, messages[0].sourceUrls);
});
