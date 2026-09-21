import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { testConnection } from '../src/test-runtime.mjs';
import { createDesktopTransport } from '../src/background/desktop-transport.js';

test('test builds require disposable state and cannot target everyday channel ports or outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-connection-'));
  const description = path.join(root, 'runtime.json');
  const runtime = { version: 1, kind: 'wdio', id: 'a'.repeat(24), root, companionPort: 45678 };
  const write = patch => fs.writeFileSync(description, JSON.stringify({ ...runtime, ...patch }));
  try {
    write({});
    assert.deepEqual(testConnection(description, 'dev', path.join(root, 'extension')), {
      baseUrl: 'http://127.0.0.1:45678', runtimeId: runtime.id,
    });
    assert.throws(() => testConnection(description, 'stable', path.join(root, 'extension')));
    assert.throws(() => testConnection(description, 'dev', path.join(root, '..', 'extension')));
    for (const patch of [{ kind: 'dev' }, { companionPort: 17420 }, { companionPort: 37420 }, { id: 'invalid' }]) {
      write(patch);
      assert.throws(() => testConnection(description, 'dev', path.join(root, 'extension')));
    }
    assert.equal(testConnection(undefined, 'stable', 'unused'), null);
  } finally {
    fs.unlinkSync(description);
    fs.rmdirSync(root);
  }
});

test('a test extension refuses ordinary Dev and another test runtime before pairing', async () => {
  globalThis.__ATLAS_TEST_CONNECTION__ = { baseUrl: 'http://127.0.0.1:45678', runtimeId: 'a'.repeat(24) };
  try {
    let calls = 0;
    let identity;
    const transport = createDesktopTransport({ fetchImpl: async url => {
      calls += 1;
      assert.equal(url, 'http://127.0.0.1:45678/v1/hello');
      return { ok: true, json: async () => ({ ok: true, data: {
        protocol_version: 1, app: { channel: 'dev', runtime_id: identity },
      } }) };
    } });
    for (identity of [undefined, 'b'.repeat(24)]) {
      await assert.rejects(transport.pair(), error => error.code === 'TEST_RUNTIME_MISMATCH');
    }
    assert.equal(calls, 2);
    identity = 'a'.repeat(24);
    await transport.hello();
  } finally {
    delete globalThis.__ATLAS_TEST_CONNECTION__;
  }
});
