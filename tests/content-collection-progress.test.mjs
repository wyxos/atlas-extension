import assert from 'node:assert/strict';
import test from 'node:test';

import { createCollectionProgress } from '../src/content/collection-progress.js';

test('collection progress exposes exact counts and determinate progress with cancel', () => {
  const { progress, panel, find, actions } = fixture();
  assert.equal(panel.hidden, true);
  progress.show({ phase: 'collecting', collected: 84, total: 200, queued: 50 });

  assert.equal(panel.hidden, false);
  assert.equal(panel.getAttribute('role'), 'region');
  assert.equal(panel.getAttribute('aria-label'), 'Gallery collection');
  assert.equal(find('atlas-collection-status').getAttribute('role'), 'status');
  assert.equal(find('atlas-collection-status').getAttribute('aria-live'), 'polite');
  assert.equal(find('atlas-collection-heading').textContent, 'Collecting gallery');
  assert.equal(find('atlas-collection-counts').textContent, 'Collected 84 of 200 · Queued 50');
  assert.equal(find('atlas-collection-bar').getAttribute('aria-valuenow'), '84');
  assert.equal(find('atlas-collection-bar').getAttribute('aria-valuemax'), '200');
  assert.equal(find('atlas-collection-bar-fill').style.width, '42%');
  assert.equal(actions.Cancel.hidden, false);
  assert.equal(actions.Retry.hidden, true);
  assert.equal(actions.Close.hidden, true);
});

test('unknown gallery size remains accessible without inventing a percentage', () => {
  const { progress, find } = fixture();
  progress.show({ phase: 'collecting', collected: 84, total: 200, queued: 50 });
  progress.show({ phase: 'collecting', collected: 85, total: null, queued: 50 });

  const bar = find('atlas-collection-bar');
  assert.equal(find('atlas-collection-counts').textContent, 'Collected 85 · Queued 50');
  assert.equal(bar.getAttribute('aria-valuenow'), null);
  assert.equal(bar.getAttribute('aria-valuemax'), null);
  assert.equal(bar.getAttribute('data-indeterminate'), 'true');
  assert.equal(bar.getAttribute('aria-valuetext'), 'Collected 85 · Queued 50; gallery size unknown');
});

test('queueing indicates Desktop submission progress and returns to determinate mode', () => {
  const { progress, find } = fixture();
  progress.show({ phase: 'collecting', collected: 84, total: null, queued: 50 });
  progress.show({ phase: 'queueing', collected: 200, total: 200, queued: 150 });

  assert.equal(find('atlas-collection-heading').textContent, 'Queueing gallery');
  assert.equal(find('atlas-collection-bar').getAttribute('aria-valuenow'), '150');
  assert.equal(find('atlas-collection-bar').getAttribute('data-indeterminate'), null);
  assert.equal(find('atlas-collection-bar-fill').style.width, '75%');
});

test('partial failure preserves counts and offers retry without claiming downloads completed', () => {
  const { progress, find, actions, calls } = fixture();
  progress.show({ phase: 'paused', collected: 200, total: 200, queued: 50, canRetry: true });

  assert.equal(find('atlas-collection-heading').textContent, 'Collection paused');
  assert.equal(find('atlas-collection-counts').textContent, 'Collected 200 of 200 · Queued 50');
  assert.equal(find('atlas-collection-note').textContent, 'Queued items stay in Desktop. Retry to continue.');
  assert.equal(actions.Cancel.hidden, true);
  assert.equal(actions.Retry.hidden, false);
  assert.equal(actions.Close.hidden, false);
  actions.Retry.click();
  assert.deepEqual(calls, ['retry']);
});

test('active cancel invokes its callback and cancellation can be retried or closed', () => {
  const { progress, panel, actions, calls } = fixture();
  progress.show({ phase: 'collecting', collected: 51, total: 200, queued: 50 });
  actions.Cancel.click();
  assert.deepEqual(calls, ['cancel']);

  progress.show({ phase: 'cancelled', collected: 51, total: 200, queued: 50, canRetry: true });
  assert.equal(actions.Retry.hidden, false);
  actions.Close.click();
  assert.equal(panel.hidden, true);
  assert.deepEqual(calls, ['cancel', 'dismiss']);
  progress.show({ phase: 'collecting', collected: 51, total: 200, queued: 50 });
  assert.equal(panel.hidden, false);
});

test('restoration and completion show distinct final states', () => {
  const { progress, panel, find, actions } = fixture();
  progress.show({ phase: 'restoring', collected: 200, total: 200, queued: 200 });
  assert.equal(find('atlas-collection-heading').textContent, 'Returning to starting image');
  assert.equal(actions.Cancel.hidden, true);
  assert.equal(actions.Retry.hidden, true);
  assert.equal(actions.Close.hidden, true);

  progress.show({ phase: 'completed', collected: 200, total: 200, queued: 200, canRetry: true });
  assert.equal(find('atlas-collection-heading').textContent, 'Gallery queued');
  assert.equal(find('atlas-collection-bar-fill').style.width, '100%');
  assert.equal(actions.Retry.hidden, true);
  assert.equal(actions.Close.hidden, false);
  progress.clear();
  assert.equal(panel.hidden, true);
});

test('malformed progress and private provider details are never rendered as status text', () => {
  const { progress, panel, find } = fixture();
  const privateDetails = 'private-provider-title https://private.example.test/secret';
  progress.show({ phase: privateDetails, collected: NaN, total: Infinity, queued: -1,
    error: privateDetails, title: privateDetails, url: privateDetails });
  assert.equal(find('atlas-collection-heading').textContent, 'Collecting gallery');
  assert.equal(find('atlas-collection-counts').textContent, 'Collected 0 · Queued 0');
  assert.doesNotMatch(JSON.stringify(panel), /private-provider-title|private\.example/);
});

function fixture() {
  const documentContext = { createElement: (name) => new FakeElement(name) };
  const parent = new FakeElement('div');
  const calls = [];
  const progress = createCollectionProgress(parent, {
    documentContext, onCancel: () => calls.push('cancel'), onDismiss: () => calls.push('dismiss'), onRetry: () => calls.push('retry'),
  });
  const panel = parent.children[0];
  const all = flatten(panel);
  return { progress, panel, calls,
    find: (className) => all.find((node) => node.className.split(' ').includes(className)),
    actions: Object.fromEntries(all.filter((node) => node.tagName === 'button').map((node) => [node.textContent, node])),
  };
}

function flatten(node) { return [node, ...node.children.flatMap(flatten)]; }

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.listeners.click?.(); }
}
