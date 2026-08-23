import assert from 'node:assert/strict';
import test from 'node:test';

import { describeDesktopStatus } from '../src/popup/desktop-status.js';

test('describes connected and paired Desktop state independently', () => {
  assert.deepEqual(describeDesktopStatus({ health: 'connected', paired: true }), {
    connected: true,
    connectionLabel: 'Connected',
    pairingLabel: 'Paired',
  });

  assert.deepEqual(describeDesktopStatus({ health: 'offline', paired: true }), {
    connected: false,
    connectionLabel: 'Disconnected',
    pairingLabel: 'Paired',
  });
});

test('describes unavailable, unpaired, and pending Desktop state', () => {
  assert.deepEqual(describeDesktopStatus(null), {
    connected: false,
    connectionLabel: 'Disconnected',
    pairingLabel: 'Not paired',
  });

  assert.deepEqual(describeDesktopStatus({ pairingPending: true }), {
    connected: false,
    connectionLabel: 'Disconnected',
    pairingLabel: 'Pairing…',
  });
});
