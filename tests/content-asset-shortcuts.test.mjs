import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleAssetShortcutEvent,
  reactionFromAssetShortcutEvent,
  reactionFromBadgeShortcutEvent,
} from '../src/content/asset-shortcuts.js';

function createNode({ closest = () => null } = {}) {
  return { closest };
}

function createEvent({
  altKey = true,
  button = 0,
  path = [],
  target = path[0] ?? createNode(),
  type = 'click',
} = {}) {
  let defaultPrevented = false;
  let propagationStopped = false;

  return {
    altKey,
    button,
    composedPath: () => path,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault: () => {
      defaultPrevented = true;
    },
    get propagationStopped() {
      return propagationStopped;
    },
    stopPropagation: () => {
      propagationStopped = true;
    },
    target,
    type,
  };
}

test('maps Atlas asset shortcut mouse events to reactions', () => {
  assert.equal(reactionFromAssetShortcutEvent(createEvent({ button: 0, type: 'click' })), 'love');
  assert.equal(reactionFromAssetShortcutEvent(createEvent({ button: 1, type: 'mousedown' })), 'like');
  assert.equal(reactionFromAssetShortcutEvent(createEvent({ button: 2, type: 'contextmenu' })), 'blacklist');
  assert.equal(reactionFromAssetShortcutEvent(createEvent({ altKey: false, button: 0, type: 'click' })), null);
  assert.equal(reactionFromAssetShortcutEvent(createEvent({ button: 1, type: 'auxclick' })), null);
});

test('dispatches shortcuts only for registered detected assets', () => {
  const asset = createNode();
  const reactions = [];
  const event = createEvent({ path: [asset], type: 'click' });

  assert.equal(handleAssetShortcutEvent(event, {
    getAssetIdForElement: (element) => (element === asset ? 'asset-1' : null),
    onReact: (reaction) => reactions.push(reaction),
  }), true);

  assert.deepEqual(reactions, [{ id: 'asset-1', type: 'love' }]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);

  const gapEvent = createEvent({ path: [createNode()], type: 'click' });
  assert.equal(handleAssetShortcutEvent(gapEvent, {
    getAssetIdForElement: () => null,
    onReact: (reaction) => reactions.push(reaction),
  }), false);
  assert.equal(gapEvent.defaultPrevented, false);
});

test('ignores shortcuts from interactive or badge targets', () => {
  const asset = createNode();
  const suppressedTarget = createNode({
    closest: (selector) => (selector.includes('button') ? createNode() : null),
  });
  const badgeTarget = createNode({
    closest: (selector) => (selector.includes('data-atlas-asset-badge') ? createNode() : null),
  });
  const reactions = [];

  for (const target of [suppressedTarget, badgeTarget]) {
    const event = createEvent({ path: [target, asset], target, type: 'click' });

    assert.equal(handleAssetShortcutEvent(event, {
      getAssetIdForElement: (element) => (element === asset ? 'asset-1' : null),
      onReact: (reaction) => reactions.push(reaction),
    }), false);
    assert.equal(event.defaultPrevented, false);
  }

  assert.deepEqual(reactions, []);
});

test('maps badge-local shortcut events without treating the badge as suppressed', () => {
  const badgeTarget = createNode();

  assert.equal(reactionFromBadgeShortcutEvent(createEvent({
    path: [badgeTarget],
    target: badgeTarget,
    type: 'click',
  })), 'love');
  assert.equal(reactionFromBadgeShortcutEvent(createEvent({
    button: 1,
    path: [badgeTarget],
    target: badgeTarget,
    type: 'mousedown',
  })), 'like');
  assert.equal(reactionFromBadgeShortcutEvent(createEvent({
    button: 2,
    path: [badgeTarget],
    target: badgeTarget,
    type: 'contextmenu',
  })), 'blacklist');
});

test('suppresses badge-local shortcuts from widget controls', () => {
  const buttonTarget = createNode({
    closest: (selector) => (selector.includes('button') ? createNode() : null),
  });
  const linkTarget = createNode({
    closest: (selector) => (selector.includes('a') ? createNode() : null),
  });
  const inputTarget = createNode({
    closest: (selector) => (selector.includes('input') ? createNode() : null),
  });

  for (const target of [buttonTarget, linkTarget, inputTarget]) {
    assert.equal(reactionFromBadgeShortcutEvent(createEvent({
      path: [target],
      target,
      type: 'click',
    })), null);
  }
});
