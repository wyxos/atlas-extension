import path from 'node:path';
import { syncBrowserProviders } from '../src/browser-provider-build.mjs';

const sources = process.argv.slice(2);
const ids = syncBrowserProviders({ root: path.resolve(import.meta.dirname, '..'), sources });
console.log(`Prepared browser providers: ${ids.join(', ')}`);
