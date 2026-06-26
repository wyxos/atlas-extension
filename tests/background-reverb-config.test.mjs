import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReverbConnectionConfig } from '../src/background/reverb-config.js';

test('keeps an existing usable Reverb config without another ping', async () => {
  const config = {
    apiKey: 'local-key',
    domain: 'https://atlas.test',
    reverb: {
      channel: 'private-extension-downloads.hash',
      enabled: true,
      host: 'reverb-8080.herd.test',
      key: 'laravel-herd',
      port: 443,
      scheme: 'https',
    },
  };
  const resolved = await resolveReverbConnectionConfig(config, {
    fetchImpl() {
      throw new Error('Should not fetch when Reverb is already configured.');
    },
  });

  assert.equal(resolved, config);
});

test('hydrates Reverb config with one ping when only domain and API key are present', async () => {
  const requests = [];
  const resolved = await resolveReverbConnectionConfig({
    apiKey: 'local-key',
    domain: 'atlas.test',
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            ok: true,
            reverb: {
              channel: 'private-extension-downloads.hash',
              enabled: true,
              host: 'reverb-8080.herd.test',
              key: 'laravel-herd',
              port: 443,
              scheme: 'https',
            },
          };
        },
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/ping');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers['X-Atlas-Api-Key'], 'local-key');
  assert.deepEqual(resolved, {
    apiKey: 'local-key',
    domain: 'https://atlas.test',
    reverb: {
      channel: 'private-extension-downloads.hash',
      enabled: true,
      host: 'reverb-8080.herd.test',
      key: 'laravel-herd',
      port: 443,
      scheme: 'https',
    },
  });
});
