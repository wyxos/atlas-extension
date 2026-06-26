import path from 'node:path';
import process from 'node:process';

import {
  buildExtension,
  loadBuildEnv,
  resolveBuildDestination,
} from '../src/release-core.mjs';

const root = path.resolve(import.meta.dirname, '..');
const destination = resolveBuildDestination({
  argv: process.argv.slice(2),
  env: loadBuildEnv(root),
  root,
});

const result = await buildExtension({ destination, root });

console.log(`Built extension package at ${result.destination}`);
console.log(`Copied files: ${result.copied.join(', ')}`);
