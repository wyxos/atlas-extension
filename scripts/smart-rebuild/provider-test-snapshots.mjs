import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from './repository.mjs';

// Integration fixtures are captured separately; they never become app resources.
export async function prepareProviderTestSnapshots({ desktop, workspace, run, env = process.env }) {
  const resolver = path.join(desktop.snapshot, 'scripts', 'provider-test-sources.mjs');
  if (!fs.existsSync(resolver)) return null; // Older Desktop revisions have no external fixtures.
  const { providerTestSources } = await import(pathToFileURL(resolver).href);
  // Resolve beside the original checkout, not the temporary Desktop snapshot.
  // Do not inherit ATLAS_CHECKOUT_INFO from a nested runtime scope.
  const sources = providerTestSources(desktop.root, {
    ATLAS_TEST_PROVIDER_SOURCES: env.ATLAS_TEST_PROVIDER_SOURCES,
  }).filter(({ id }) => id !== 'exampleunknown'); // This fixture belongs to captured Desktop.
  const plans = sources.map(({ id, source }) => {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Invalid provider test fixture identity.');
    let head;
    try { head = git(source, ['rev-parse', '--verify', 'refs/heads/main^{commit}']); }
    catch { throw new Error(`Provider tests need a committed main branch for ${id}.`); }
    return { id, source, head, snapshot: path.join(workspace, 'provider-tests', id) };
  });
  // Capture all refs before the first asynchronous command. Later source edits
  // and commits cannot change the fixtures for this update.
  const overrides = {};
  for (const plan of plans) {
    await run('git', ['init', plan.snapshot], workspace);
    await run('git', ['-C', plan.snapshot, 'fetch', '--no-tags', '--depth=1', plan.source, plan.head], workspace);
    await run('git', ['-C', plan.snapshot, 'checkout', '--detach', 'FETCH_HEAD'], workspace);
    if (git(plan.snapshot, ['rev-parse', 'HEAD']) !== plan.head) throw new Error('Provider test snapshot revision mismatch.');
    const manifest = JSON.parse(fs.readFileSync(path.join(plan.snapshot, 'manifest.json'), 'utf8'));
    if (manifest.id !== plan.id || !fs.existsSync(path.join(plan.snapshot, 'Cargo.toml'))) {
      throw new Error(`Committed provider test source does not match ${plan.id}.`);
    }
    overrides[plan.id] = plan.snapshot;
  }
  return overrides;
}
