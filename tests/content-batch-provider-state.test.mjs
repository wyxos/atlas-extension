import assert from 'node:assert/strict';
import test from 'node:test';

import { createBatchProviderState } from '../src/content/batch-provider-state.js';

test('tracks batch mode per provider and updates matching badges', () => {
  const contexts = new Map([
    ['asset-1', { provider: 'deviantart' }],
    ['asset-2', { provider: 'deviantart' }],
    ['asset-3', { provider: 'youtube' }],
  ]);
  const updates = [];
  const state = createBatchProviderState({
    getContextsById: () => contexts,
    onBadgeState(id, nextState) {
      updates.push([id, nextState]);
    },
  });

  assert.equal(state.isProviderEnabled('deviantart'), false);
  state.setProviderEnabled('deviantart', true);
  state.updateProvider('deviantart');

  assert.equal(state.isProviderEnabled('deviantart'), true);
  assert.deepEqual(updates, [
    ['asset-1', { batch: { available: true, checked: true } }],
    ['asset-2', { batch: { available: true, checked: true } }],
  ]);
});

test('replaces stored batch preferences without leaking across providers', () => {
  const contexts = new Map([
    ['asset-1', { provider: 'deviantart' }],
    ['asset-2', { provider: 'youtube' }],
  ]);
  const updates = [];
  const state = createBatchProviderState({
    getContextsById: () => contexts,
    onBadgeState(id, nextState) {
      updates.push([id, nextState]);
    },
  });

  state.setProviderEnabled('deviantart', true);
  state.replacePreferences({ youtube: true });

  assert.equal(state.isProviderEnabled('deviantart'), false);
  assert.equal(state.isProviderEnabled('youtube'), true);
  assert.deepEqual(updates, [
    ['asset-1', { batch: { available: true, checked: false } }],
    ['asset-2', { batch: { available: true, checked: true } }],
  ]);
});
