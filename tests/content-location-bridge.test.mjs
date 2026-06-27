import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/location-bridge.js'),
  'utf8',
);

test('location bridge dispatches page-world SPA navigation events', () => {
  assert.match(source, /atlas-extension-location-change/);
  assert.match(source, /pushState/);
  assert.match(source, /replaceState/);
  assert.match(source, /dispatchEvent/);
});

test('location bridge does not reserve global page-world lexical names', () => {
  const context = {
    window: {
      addEventListener() {},
      dispatchEvent() {},
      Event: class Event {},
      history: {
        pushState() {},
        replaceState() {},
      },
    },
  };
  context.window.window = context.window;
  vm.createContext(context);

  vm.runInContext(source, context);

  assert.doesNotThrow(() => {
    vm.runInContext(`
      let eventName;
      let installKey;
      let dispatchLocationChange;
      let bindHistoryMethod;
    `, context);
  });
});
