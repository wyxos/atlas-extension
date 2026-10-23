import fs from 'node:fs';
import path from 'node:path';
import { git, saveState, snapshot } from './repository.mjs';
import { buildPlan } from './build-plan.mjs';
import { versionTree } from './commit-plan.mjs';
import { committedText, publishVersionCommit } from './version-commit.mjs';
import { command, openBuildScope, isolatedBuildEnvironment, removeWorkspace } from './isolated.mjs';
import { runCapturedSnapshots } from './captured-snapshots.mjs';
import { terminal } from './terminal.mjs';

const manifest = 'src-tauri/resources/media-tools/manifest.json';
const checker = 'scripts/ytdlp-release.mjs';
const keyFor = root => path.resolve(root).toLowerCase();
const journalPath = directory => path.join(directory, 'ytdlp-pin-state.json');

function readState(file) {
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schema: 1, repos: {} };
  if (state.schema !== 1 || !state.repos) throw new Error('Unknown yt-dlp pin preparation state format.');
  return state;
}

export function recoverYtdlpPin({ repos, stateDirectory, dryRun = false, publish = publishVersionCommit, log = terminal.line }) {
  const file = journalPath(stateDirectory);
  if (!fs.existsSync(file)) return;
  const state = readState(file);
  for (const repo of repos.filter(repo => repo.kind === 'desktop')) {
    const key = keyFor(repo.root), plan = state.repos[key];
    if (!plan) continue;
    if (dryRun) { log('Desktop: interrupted yt-dlp pin commit needs recovery.'); continue; }
    if (JSON.stringify(plan.files) !== JSON.stringify([manifest])) throw new Error('Unexpected yt-dlp pin publication files.');
    publish(repo, plan);
    delete state.repos[key];
    saveState(file, state);
    log('Desktop: recovered verified yt-dlp pin commit.');
  }
}

function assertPinOnly(changed, before, after) {
  if (changed !== manifest) throw new Error('yt-dlp preparation changed files outside its pin.');
  const original = JSON.parse(before), updated = JSON.parse(after);
  const pin = { ...updated.ytDlp, version: original.ytDlp.version, url: original.ytDlp.url, sha256: original.ytDlp.sha256 };
  if (JSON.stringify({ ...updated, ytDlp: pin }) !== JSON.stringify(original)) {
    throw new Error('yt-dlp preparation changed unrelated media-tool settings.');
  }
}

export async function prepareYtdlpPin({ repos, stateDirectory, dryRun = false, log = terminal.line,
  execute = command, scopeFactory = openBuildScope, publish = publishVersionCommit }) {
  if (dryRun) return;
  const repo = repos.find(repo => repo.kind === 'desktop');
  if (!repo) return;
  const source = git(repo.root, ['rev-parse', 'refs/heads/main^{commit}']);
  // Old source snapshots have no release checker and keep their own behavior.
  if (!git(repo.root, ['ls-tree', '--name-only', source, '--', checker])) return;
  const completed = readState(path.join(stateDirectory, 'isolated-state.json'));
  if (!buildPlan(repo, source, completed.repos[keyFor(repo.root)]).needed) return;
  const parent = path.join(stateDirectory, 'workspaces');
  fs.mkdirSync(parent, { recursive: true });
  const control = fs.mkdtempSync(path.join(fs.realpathSync(parent), 'run-'));
  let scope;
  try { scope = await scopeFactory(repo.root, control, { rust: false }); }
  catch (error) { removeWorkspace(parent, control); throw error; }
  const workspace = scope.workspace ?? control;
  const environment = isolatedBuildEnvironment(scope.environment, workspace);
  const logFile = environment.ATLAS_BUILD_LOG || path.join(stateDirectory, 'ytdlp-preparation.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const run = (name, args, cwd) => execute(name, args, { cwd, env: environment, logFile });
  try {
    log('Desktop: checking and refreshing the bundled yt-dlp pin…', 'blue');
    const target = path.join(workspace, 'desktop');
    await runCapturedSnapshots([{ id: 'desktop', source: repo.root, snapshot: target, head: source }], workspace, run);
    const before = committedText(repo.root, source, manifest);
    await run(process.execPath, [checker, '--update-if-stale'], target);
    const after = fs.readFileSync(path.join(target, manifest), 'utf8');
    // Compare Git-normalized contents: Windows checkout line endings alone
    // must not turn a current pin into a source update or a verification error.
    const changed = git(target, ['diff', '--name-only', source, snapshot(target).tree]);
    if (!changed) { log('Desktop: bundled yt-dlp pin is current.'); return; }
    assertPinOnly(changed, before, after);
    const tree = versionTree(repo.root, source, [{ file: manifest, text: after }]);
    if (tree === git(repo.root, ['rev-parse', `${source}^{tree}`])) return;
    const head = git(repo.root, ['commit-tree', tree, '-p', source, '-m', 'chore: refresh verified yt-dlp installer pin']);
    const plan = { source, head, tree, files: [manifest] };
    const file = journalPath(stateDirectory), state = readState(file);
    // Save before any live file/ref writes. Recovery uses the same index lock,
    // selective file replacement and compare-and-swap checks as version commits.
    state.repos[keyFor(repo.root)] = plan;
    saveState(file, state);
    publish(repo, plan);
    delete state.repos[keyFor(repo.root)];
    saveState(file, state);
    log(`Desktop: saved verified yt-dlp pin · commit ${head.slice(0, 8)}`, 'green');
  } catch (error) {
    fs.appendFileSync(logFile, `\nyt-dlp pin preparation stopped: ${error.message}\n`);
    throw new Error(`Desktop: yt-dlp pin preparation failed. See ${logFile}`, { cause: error });
  } finally {
    await scope.close();
    // Managed scopes retain snapshots pinned by surviving children; only the
    // manager can reclaim those. Disposable fixture/legacy scopes are local.
    if (!scope.managedWorkspaces && !(scope.environment?.ATLAS_BUILD_CONNECTION && scope.environment?.ATLAS_BUILD_PARENT_SCOPE)) {
      for (const directory of new Set([workspace, control])) {
        if (fs.existsSync(directory)) removeWorkspace(parent, directory);
      }
    }
  }
}
