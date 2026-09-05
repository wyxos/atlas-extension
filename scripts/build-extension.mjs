import path from 'node:path';
import process from 'node:process';

import {
  buildExtension,
  loadBuildEnv,
  resolveBuildDestination,
} from '../src/release-core.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const channelIndex = argv.indexOf('--channel');
const channel = channelIndex === -1 ? undefined : argv[channelIndex + 1];
if (channelIndex !== -1 && !['dev', 'stable'].includes(channel)) {
  throw new Error('--channel requires dev or stable.');
}
const destination = resolveBuildDestination({
  argv,
  env: loadBuildEnv(root),
  root,
});

const result = await buildExtension({ channel, destination, root });

console.log(`Built extension package at ${result.destination}`);
console.log(`Copied files: ${result.copied.join(', ')}`);
