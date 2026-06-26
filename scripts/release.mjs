import { runRelease } from '../src/release-core.mjs';

const result = await runRelease({ argv: process.argv.slice(2) });

console.log(`Release target: v${result.target.version} (${result.target.source})`);
console.log(`Built package: ${result.distPath}`);

for (const output of result.localOutputs) {
  console.log(`Local package: ${output}`);
}
