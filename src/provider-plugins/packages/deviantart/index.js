import { deviantArtIdentity } from './identity.js';
import { deviantArtPage } from './page.js';
import { collectDeviantArtBatchItems, resolveDeviantArtBatchContext } from './batch.js';
export default Object.freeze({ id: 'deviantart', canonicalPage: deviantArtPage, captureIdentity: deviantArtIdentity, batch: { collect: collectDeviantArtBatchItems, resolve: resolveDeviantArtBatchContext } });
