import assert from 'node:assert/strict';
import test from 'node:test';
import { startContentRuntime } from '../src/content/content-runtime.js';

test('Desktop resync messages preserve explicit soft refresh and default to hard invalidation', t => {
  const previous = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, MutationObserver: globalThis.MutationObserver };
  t.after(() => Object.assign(globalThis, previous));
  const listeners = [];
  const flags = [];
  globalThis.document = { documentElement: {}, addEventListener() {} };
  globalThis.window = { addEventListener() {}, history: { pushState() {}, replaceState() {} } };
  globalThis.MutationObserver = class { observe() {} };
  globalThis.chrome = { runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } } };
  startContentRuntime({
    handleResyncRequired: flag => flags.push(flag),
    referrerBadges: {}, referrerOpenGuard: {},
    waitForInitialDomMutationWindow: () => new Promise(() => {}),
  });
  for (const providerChanged of [false, true, undefined]) {
    for (const listener of listeners) listener({ type: 'atlas-extension.desktop.resync-required', providerChanged });
  }
  assert.deepEqual(flags, [false, true, true]);
});

