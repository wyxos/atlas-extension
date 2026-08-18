import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopEventClient,
  validateWebSocketUrl,
} from '../src/background/desktop-event-client.js';

test('accepts only the locked Desktop event origin and route', () => {
  assert.equal(
    validateWebSocketUrl(
      'ws://127.0.0.1:17420/v1/events?ticket=abc',
      'http://127.0.0.1:17420',
    ),
    'ws://127.0.0.1:17420/v1/events?ticket=abc',
  );
  assert.throws(
    () => validateWebSocketUrl('ws://127.0.0.1:37420/v1/events?ticket=abc', 'http://127.0.0.1:17420'),
    (error) => error.code === 'INVALID_EVENT_URL',
  );
});

test('resumes from the last sequence and relays normalized download events', async () => {
  const sockets = [];
  const events = [];
  const sequences = [];
  const ticketRequests = [];
  const client = createDesktopEventClient({
    credentials: { channel: 'dev', clientId: 'client', clientToken: 'token' },
    getSequence: async () => 41,
    onEvent: (event) => events.push(event),
    onSequence: (sequence) => sequences.push(sequence),
    transport: {
      baseUrl: 'http://127.0.0.1:17420',
      async eventTicket(_credentials, sequence) {
        ticketRequests.push(sequence);
        return { websocket_url: 'ws://127.0.0.1:17420/v1/events?ticket=abc' };
      },
    },
    WebSocketImpl: class FakeSocket {
      constructor(url) {
        this.url = url;
        this.listeners = new Map();
        sockets.push(this);
      }
      addEventListener(type, callback) { this.listeners.set(type, callback); }
      close() {}
      emit(type, payload = {}) { this.listeners.get(type)?.(payload); }
    },
  });

  await client.start();
  sockets[0].emit('open');
  sockets[0].emit('message', {
    data: JSON.stringify({
      data: { assetUrl: 'https://example.test/image.jpg', download: { status: 'queued' } },
      occurred_at: '2026-08-18T12:00:00Z',
      sequence: 42,
      type: 'download.queued',
    }),
  });

  assert.deepEqual(ticketRequests, [41]);
  assert.deepEqual(sequences, [42]);
  assert.equal(events[0].eventType, 'download.queued');
  assert.equal(events[0].assetUrl, 'https://example.test/image.jpg');
  client.stop();
});

test('requests a full resync when Desktop cannot resume the event sequence', async () => {
  const sockets = [];
  const sequences = [];
  let resyncs = 0;
  const client = createDesktopEventClient({
    credentials: {},
    getSequence: async () => 99,
    onResyncRequired: () => { resyncs += 1; },
    onSequence: (sequence) => sequences.push(sequence),
    transport: {
      baseUrl: 'http://127.0.0.1:17420',
      eventTicket: async () => ({ websocket_url: 'ws://127.0.0.1:17420/v1/events?ticket=abc' }),
    },
    WebSocketImpl: class FakeSocket {
      constructor() { this.listeners = new Map(); sockets.push(this); }
      addEventListener(type, callback) { this.listeners.set(type, callback); }
      close() {}
      emit(type, payload) { this.listeners.get(type)?.(payload); }
    },
  });

  await client.start();
  sockets[0].emit('message', {
    data: JSON.stringify({ sequence: 100, type: 'resync_required' }),
  });

  assert.equal(resyncs, 1);
  assert.deepEqual(sequences, [0]);
  client.stop();
});

test('requests runtime policy refreshes without relaying them as download events', async () => {
  const sockets = [];
  const downloads = [];
  const policies = [];
  const client = createDesktopEventClient({
    credentials: {},
    getSequence: async () => 0,
    onEvent: (event) => downloads.push(event),
    onPolicyChanged: (event) => policies.push(event),
    transport: {
      baseUrl: 'http://127.0.0.1:17420',
      eventTicket: async () => ({ websocket_url: 'ws://127.0.0.1:17420/v1/events?ticket=abc' }),
    },
    WebSocketImpl: class FakeSocket {
      constructor() { this.listeners = new Map(); sockets.push(this); }
      addEventListener(type, callback) { this.listeners.set(type, callback); }
      close() {}
      emit(type, payload) { this.listeners.get(type)?.(payload); }
    },
  });

  await client.start();
  sockets[0].emit('message', {
    data: JSON.stringify({ data: { revision: 3 }, sequence: 7, type: 'runtime.policy.changed' }),
  });

  assert.deepEqual(policies, [{ revision: 3 }]);
  assert.deepEqual(downloads, []);
  client.stop();
});
