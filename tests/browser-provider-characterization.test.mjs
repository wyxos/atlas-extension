import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserResolutionCache } from '../src/shared/browser-resolution-cache.js';
import { createBrowserPageContext } from '../src/content/browser-page-context.js';

// Fixed expectations shared by the replacement bridge tests. No provider source
// is used to calculate an expected result.
export const pageCases = [
  ['https://civitai.red/images/42?from=feed#image', 'https://civitai.com/images/42', true],
  ['http://www.civitai.com/images/42/', 'https://civitai.com/images/42', true],
  ['https://civitai.com/images/0', 'https://civitai.com/images/0', false],
  ['https://civitai.com.evil.test/images/42', 'https://civitai.com.evil.test/images/42', false],
  ['https://user@civitai.com/images/42', 'https://user@civitai.com/images/42', false],
  ['https://civitai.com:9443/images/42', 'https://civitai.com:9443/images/42', false],
  ['https://www.deviantart.com/artist/art/Picture-123?file=2', 'deviantart:123', false],
  ['https://deviantart.com/renamed/art/123#image', 'deviantart:123', false],
  ['https://deviantart.com/artist/gallery', 'https://deviantart.com/artist/gallery', false],
  ['https://www.wallhaven.cc/w/abc123?from=search', 'https://wallhaven.cc/w/abc123', false],
  ['https://wallhaven.cc/w/abc12', 'https://wallhaven.cc/w/abc12', false],
  ['https://example.test/images/42?file=2', 'https://example.test/images/42?file=2', false],
];

test('browser provider characterization: Desktop page aliases pass through unchanged', async () => {
  const cache = createBrowserResolutionCache({ resolve: async ({ pages }) => ({ pages: pages.map(({url}) => ({url, canonicalPage: pageCases.find(row => row[0] === url)[1]})) }) });
  await cache.prepare(pageCases.map(row => row[0]));
  for (const [url, canonical] of pageCases) assert.equal(cache.canonical(url), canonical);
});
test('browser provider characterization: refreshed Desktop identity never retains a prior artwork', async () => {
  let identity = {provider:'deviantart',item_id:'b7c73535-ddea-08f9-a423-69bb9c4d44ae'};
  const context = createBrowserPageContext({resolve: async ({pages}) => ({pages: pages.map(page => ({url:page.url,identity}))})});
  const url = 'https://www.deviantart.com/fixture/art/Example-123';
  await context.refresh({url});
  assert.deepEqual(context.get(url).identity, identity);
  identity = null; context.invalidate();
  assert.equal(context.get(url),null);
  await context.refresh({url});
  assert.equal(context.get(url).identity,null);
});
