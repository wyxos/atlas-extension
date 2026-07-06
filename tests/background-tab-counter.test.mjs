import assert from 'node:assert/strict';
import test from 'node:test';

import {
  broadcastTabCounterSnapshots,
  handleTabCounterSnapshotRequest,
} from '../src/background/tab-counter.js';
import { createOpenTabRegistry } from '../src/background/tab-state.js';
import {
  tabCounterChangedMessageType,
  tabCounterSnapshotRequestType,
} from '../src/shared/tab-counter-messages.js';

test('tab counter snapshot requests update the sender tab before counting', () => {
  const registry = createOpenTabRegistry();

  registry.replaceTabs([
    { id: 1, url: 'https://old.example.test/page', windowId: 7 },
    { id: 2, url: 'https://example.test/other', windowId: 7 },
    { id: 3, url: 'chrome://extensions/', windowId: 7 },
  ]);

  const payload = handleTabCounterSnapshotRequest({
    message: {
      currentUrl: 'https://www.example.test/current',
      type: tabCounterSnapshotRequestType,
    },
    openTabs: registry,
    sender: {
      tab: {
        id: 1,
        windowId: 7,
      },
    },
  });

  assert.deepEqual(payload, {
    domain: 'example.test',
    sameDomainTabs: 2,
    totalTabsInWindow: 3,
  });
});

test('tab counter broadcasts per-tab snapshots to promptable tabs in affected windows', () => {
  const registry = createOpenTabRegistry();
  const sent = [];

  registry.replaceTabs([
    { id: 1, url: 'https://www.example.test/page', windowId: 7 },
    { id: 2, url: 'https://example.test/other', windowId: 7 },
    { id: 3, url: 'https://other.test/page', windowId: 7 },
    { id: 4, url: 'brave://extensions/', windowId: 7 },
    { id: 5, url: 'https://example.test/window-two', windowId: 8 },
  ]);

  broadcastTabCounterSnapshots({
    openTabs: registry,
    tabsApi: {
      sendMessage(tabId, message, callback) {
        sent.push([tabId, message]);
        callback();
      },
    },
    windowIds: [7],
  });

  assert.deepEqual(sent, [
    [1, {
      payload: {
        domain: 'example.test',
        sameDomainTabs: 2,
        totalTabsInWindow: 4,
      },
      type: tabCounterChangedMessageType,
    }],
    [2, {
      payload: {
        domain: 'example.test',
        sameDomainTabs: 2,
        totalTabsInWindow: 4,
      },
      type: tabCounterChangedMessageType,
    }],
    [3, {
      payload: {
        domain: 'other.test',
        sameDomainTabs: 1,
        totalTabsInWindow: 4,
      },
      type: tabCounterChangedMessageType,
    }],
  ]);
});
