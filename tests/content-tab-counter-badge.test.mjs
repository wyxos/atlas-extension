import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTabCounterBadge,
  initializeTabCounterBadge,
} from '../src/content/tab-counter-badge.js';
import {
  tabCounterChangedMessageType,
  tabCounterSnapshotRequestType,
} from '../src/shared/tab-counter-messages.js';

test('tab counter badge renders a fixed top-center domain ratio', () => {
  const documentContext = createFakeDocument();
  const badge = createTabCounterBadge({ documentContext });

  badge.update({
    domain: 'example.test',
    sameDomainTabs: 3,
    totalTabsInWindow: 11,
  });

  const host = documentContext.body.children[0];
  const pill = host.shadowRoot.children[1];

  assert.equal(host.id, 'atlas-extension-tab-counter');
  assert.equal(host.style.position, 'fixed');
  assert.equal(host.style.top, '10px');
  assert.equal(host.style.left, '50%');
  assert.equal(host.style.transform, 'translateX(-50%)');
  assert.equal(host.style.pointerEvents, 'none');
  assert.equal(pill.textContent, '3 / 11');
  assert.equal(pill.ariaLabel, '3 tabs on example.test out of 11 tabs in this window');
});

test('tab counter badge hides when the current tab has no domain snapshot', () => {
  const documentContext = createFakeDocument();
  const badge = createTabCounterBadge({ documentContext });

  badge.update({
    domain: 'example.test',
    sameDomainTabs: 1,
    totalTabsInWindow: 4,
  });
  badge.update(null);

  assert.equal(documentContext.body.children[0].style.display, 'none');
});

test('tab counter initialization requests a snapshot and listens for updates', async () => {
  const documentContext = createFakeDocument();
  const runtimeListeners = [];
  const sent = [];
  const runtime = {
    onMessage: {
      addListener(listener) {
        runtimeListeners.push(listener);
      },
    },
    sendMessage(message, callback) {
      sent.push(message);
      callback({
        ok: true,
        payload: {
          domain: 'example.test',
          sameDomainTabs: 2,
          totalTabsInWindow: 8,
        },
      });
    },
  };

  await initializeTabCounterBadge({
    documentContext,
    runtime,
    windowContext: {
      addEventListener() {},
      location: { href: 'https://example.test/current' },
    },
  });

  assert.deepEqual(sent, [{
    currentUrl: 'https://example.test/current',
    type: tabCounterSnapshotRequestType,
  }]);
  assert.equal(documentContext.body.children[0].shadowRoot.children[1].textContent, '2 / 8');

  runtimeListeners[0]({
    payload: {
      domain: 'example.test',
      sameDomainTabs: 4,
      totalTabsInWindow: 9,
    },
    type: tabCounterChangedMessageType,
  });

  assert.equal(documentContext.body.children[0].shadowRoot.children[1].textContent, '4 / 9');
});

function createFakeDocument() {
  return {
    body: createFakeElement('body'),
    createElement(tagName) {
      return createFakeElement(tagName, this);
    },
    documentElement: createFakeElement('html'),
  };
}

function createFakeElement(tagName, ownerDocument = null) {
  return {
    children: [],
    id: '',
    ownerDocument,
    parentElement: null,
    shadowRoot: null,
    style: {},
    tagName: tagName.toUpperCase(),
    textContent: '',
    append(...nodes) {
      for (const node of nodes) {
        this.children.push(node);
        node.parentElement = this;
      }
    },
    attachShadow() {
      const root = {
        children: [],
        host: this,
        append(...nodes) {
          for (const node of nodes) {
            this.children.push(node);
            node.parentElement = this;
          }
        },
      };

      this.shadowRoot = root;

      return root;
    },
    setAttribute(name, value) {
      this[name.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())] = value;
    },
  };
}
