import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalProviderPage, shouldPreserveProviderReferrer } from '../src/shared/provider-page.js';
import { captureProviderIdentity } from '../src/content/provider-identities.js';

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

test('browser provider characterization: exact page aliases, boundaries and original-referrer policy', () => {
  for (const [input, canonical, preserve] of pageCases) {
    assert.equal(canonicalProviderPage(input), canonical, input);
    assert.equal(shouldPreserveProviderReferrer(input), preserve, input);
  }
});

test('browser provider characterization: identity follows live page metadata without retaining a prior artwork', () => {
  const pageUrl = 'https://www.deviantart.com/fixture/art/Example-123';
  let content = 'DeviantArt://deviation/B7C73535-DDEA-08F9-A423-69BB9C4D44AE';
  const documentContext = { querySelector: () => content === null ? null : ({ getAttribute: () => content }) };
  assert.deepEqual(captureProviderIdentity({ documentContext, pageUrl }), {
    provider: 'deviantart', item_id: 'b7c73535-ddea-08f9-a423-69bb9c4d44ae',
  });
  content = null;
  assert.equal(captureProviderIdentity({ documentContext, pageUrl }), null);
  content = 'DeviantArt://deviation/not-an-id';
  assert.equal(captureProviderIdentity({ documentContext, pageUrl }), null);
});
