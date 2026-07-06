import assert from 'node:assert/strict';
import test from 'node:test';

import { createBadgeHostManager } from '../src/content/badge-hosts.js';

test('anchors asset badges inside the direct visual parent', () => {
  const documentContext = createFakeDocument();
  const wrapper = createFakeElement('div', {
    bottom: 300,
    height: 200,
    left: 10,
    right: 310,
    top: 100,
    width: 300,
  }, documentContext);
  const image = createFakeElement('img', {
    bottom: 290,
    height: 180,
    left: 20,
    right: 300,
    top: 110,
    width: 280,
  }, documentContext);
  wrapper.append(image);

  const manager = createBadgeHostManager({
    documentContext,
    getComputedStyle: () => ({ position: 'static' }),
  });
  const placement = manager.placeBadge('asset-1', image, { type: 'image' }, {
    variant: 'asset',
    viewportPadding: 4,
  });

  assert.equal(placement.portalTarget.parentElement.getRootNode().host.parentElement, wrapper);
  assert.equal(wrapper.style.position, 'relative');
  assert.equal(placement.hostStyle.left, '150px');
  assert.equal(placement.hostStyle.top, '186px');
  assert.equal(placement.hostStyle.transform, 'translate(-50%, -100%)');
  assert.equal(placement.badgeStyle.position, 'static');
  assert.equal(placement.badgeStyle.width, '100%');
});

test('anchors compact referrer badges to the media bottom right', () => {
  const documentContext = createFakeDocument();
  const wrapper = createFakeElement('a', {
    bottom: 240,
    height: 160,
    left: 40,
    right: 280,
    top: 80,
    width: 240,
  }, documentContext);
  const image = createFakeElement('img', {
    bottom: 236,
    height: 152,
    left: 44,
    right: 276,
    top: 84,
    width: 232,
  }, documentContext);
  wrapper.append(image);

  const placement = createBadgeHostManager({
    documentContext,
    getComputedStyle: () => ({ position: 'relative' }),
  }).placeBadge('referrer-1', image, { type: 'image' }, {
    variant: 'referrer',
    viewportPadding: 4,
  });

  assert.equal(placement.hostStyle.left, '232px');
  assert.equal(placement.hostStyle.top, '152px');
  assert.equal(placement.hostStyle.transform, 'translate(-100%, -100%)');
  assert.equal(placement.hostStyle.width, '40px');
  assert.equal(placement.badgeStyle.height, '50px');
});

test('can hide and show every badge host without removing placement state', () => {
  const documentContext = createFakeDocument();
  const wrapper = createFakeElement('div', {
    bottom: 300,
    height: 200,
    left: 10,
    right: 310,
    top: 100,
    width: 300,
  }, documentContext);
  const image = createFakeElement('img', {
    bottom: 290,
    height: 180,
    left: 20,
    right: 300,
    top: 110,
    width: 280,
  }, documentContext);
  wrapper.append(image);

  const manager = createBadgeHostManager({
    documentContext,
    getComputedStyle: () => ({ position: 'static' }),
  });
  const placement = manager.placeBadge('asset-1', image, { type: 'image' }, {
    variant: 'asset',
    viewportPadding: 4,
  });
  const host = placement.portalTarget.getRootNode().host;

  manager.setVisible(false);
  assert.equal(host.style.display, 'none');

  manager.setVisible(true);
  assert.equal(host.style.display, 'block');
});

test('falls back when the only parent is the document body', () => {
  const documentContext = createFakeDocument();
  const image = createFakeElement('img', {
    bottom: 180,
    height: 180,
    left: 0,
    right: 260,
    top: 0,
    width: 260,
  }, documentContext);
  documentContext.body.append(image);

  const placement = createBadgeHostManager({
    documentContext,
    getComputedStyle: () => ({ position: 'static' }),
  }).placeBadge('asset-1', image, { type: 'image' }, {
    variant: 'asset',
    viewportPadding: 4,
  });

  assert.equal(placement, null);
  assert.equal(documentContext.body.style.position, undefined);
});

function createFakeDocument() {
  return {
    body: createFakeElement('body'),
    createElement(tagName) {
      return createFakeElement(tagName, null, this);
    },
    documentElement: createFakeElement('html'),
  };
}

function createFakeElement(tagName, rect = null, ownerDocument = null) {
  return {
    children: [],
    firstChild: null,
    ownerDocument,
    parentElement: null,
    scrollLeft: 0,
    scrollTop: 0,
    shadowRoot: null,
    style: {},
    tagName: tagName.toUpperCase(),
    append(...nodes) {
      for (const node of nodes) {
        this.children.push(node);
        this.firstChild ??= node;
        node.parentElement = this;
      }
    },
    attachShadow() {
      const host = this;
      const root = {
        children: [],
        host,
        append(...nodes) {
          for (const node of nodes) {
            this.children.push(node);
            node.parentElement = this;
          }
        },
      };

      root.getRootNode = () => root;
      this.shadowRoot = root;

      return root;
    },
    getBoundingClientRect() {
      return rect ?? {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      };
    },
    getRootNode() {
      return this.parentElement?.getRootNode?.() ?? this;
    },
    remove() {
      const siblings = this.parentElement?.children ?? [];
      const index = siblings.indexOf(this);

      if (index >= 0) {
        siblings.splice(index, 1);
      }

      this.parentElement = null;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
}
