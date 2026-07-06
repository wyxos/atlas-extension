import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadNextTabsDefaultLimit,
  loadNextTabsMaxLimit,
  loadNextTabsMinLimit,
  normalizeLoadNextTabsLimit,
  stepLoadNextTabsLimit,
} from '../src/shared/load-next-tabs-messages.js';

test('normalizes custom next-tab limits without hard-clamping to the default', () => {
  assert.equal(loadNextTabsDefaultLimit, 10);
  assert.equal(loadNextTabsMinLimit, 1);
  assert.equal(loadNextTabsMaxLimit, 99);
  assert.equal(normalizeLoadNextTabsLimit('12'), 12);
  assert.equal(normalizeLoadNextTabsLimit(''), loadNextTabsDefaultLimit);
  assert.equal(normalizeLoadNextTabsLimit('0'), loadNextTabsMinLimit);
  assert.equal(normalizeLoadNextTabsLimit('120'), loadNextTabsMaxLimit);
});

test('steps custom next-tab limits with bounded plus and minus controls', () => {
  assert.equal(stepLoadNextTabsLimit('10', 1), 11);
  assert.equal(stepLoadNextTabsLimit('10', -1), 9);
  assert.equal(stepLoadNextTabsLimit('', 1), loadNextTabsDefaultLimit + 1);
  assert.equal(stepLoadNextTabsLimit('1', -1), loadNextTabsMinLimit);
  assert.equal(stepLoadNextTabsLimit('99', 1), loadNextTabsMaxLimit);
});
