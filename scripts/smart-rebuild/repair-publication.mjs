import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertReady, git, saveState, snapshot } from './repository.mjs';
import { mainCheckout } from './main-changes.mjs';
import { committedVersion } from './version-commit.mjs';

const journalName = 'repair-publication-state.json';
const keyFor = (root) => path.resolve(root).toLowerCase();
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function readState(file) {
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schema: 1, repos: {} };
  if (state.schema !== 1 || !state.repos) throw new Error('Unknown repair publication state format.');
  return state;
}

function identity(root) {
  const result = {};
  for (const role of ['AUTHOR', 'COMMITTER']) {
    const match = /^(.*) <([^>]+)> \d+ [+-]\d+$/.exec(git(root, ['var', `GIT_${role}_IDENT`]));
    if (!match) throw new Error('The source repository has no usable Git identity.');
    result[`GIT_${role}_NAME`] = match[1];
    result[`GIT_${role}_EMAIL`] = match[2];
  }
  return result;
}

function saveReview(stateDirectory, key, plan) {
  const file = path.join(stateDirectory, 'version-state.json');
  const state = readState(file);
  if (state.repos[key]?.publishing) throw new Error('A version publication still needs recovery.');
  state.repos[key] = { reviewed: {
    head: plan.head, tree: plan.tree, version: plan.version,
    reason: 'Verified updater repair is included in the prepared release version.',
  } };
  saveState(file, state);
}

function ownsLock(plan) {
  if (!plan.lock || !fs.existsSync(plan.lock)) return false;
  if (fs.readFileSync(plan.lock, 'utf8') === plan.lockToken) return true;
  return fs.existsSync(plan.temporary) && digest(plan.lock) === digest(plan.temporary);
}

function releaseIndex(plan) {
  if (ownsLock(plan)) fs.rmSync(plan.lock);
  if (plan.temporary && fs.existsSync(plan.temporary)) fs.rmSync(plan.temporary);
}

function completeIndex(plan) {
  if (!plan.checkout) return;
  if (mainCheckout(plan.root) !== plan.checkout
    || git(plan.checkout, ['symbolic-ref', 'HEAD']) !== 'refs/heads/main') {
    throw new Error('The repaired main checkout changed before index recovery.');
  }
  if (fs.existsSync(plan.temporary)) {
    const env = { GIT_INDEX_FILE: plan.temporary };
    if (git(plan.checkout, ['write-tree'], env) !== plan.tree
      || git(plan.checkout, ['status', '--porcelain=v1', '--untracked-files=all'], env)) {
      throw new Error('The repaired checkout has edits; its saved index cannot be recovered safely.');
    }
    if (digest(plan.index) !== plan.originalIndex) {
      // A successful rename can precede a failed journal write. Accept only the
      // exact repaired index; unrelated staging must never be overwritten.
      if (git(plan.checkout, ['write-tree']) !== plan.tree) throw new Error('Staging changed before repair index recovery.');
      releaseIndex(plan);
      return;
    }
    if (fs.existsSync(plan.lock) && !ownsLock(plan)) throw new Error('Another Git operation holds the repair checkout index.');
    if (!fs.existsSync(plan.lock)) fs.writeFileSync(plan.lock, plan.lockToken, { flag: 'wx' });
    fs.copyFileSync(plan.temporary, plan.lock);
    fs.renameSync(plan.lock, plan.index);
    fs.rmSync(plan.temporary);
    return;
  }
  if (git(plan.checkout, ['write-tree']) !== plan.tree
    || git(plan.checkout, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('The repaired checkout needs manual index recovery from its saved bundle.');
  }
  if (ownsLock(plan)) fs.rmSync(plan.lock);
}

// Called before version review. The journal is durable before any source writes,
// so an interrupted ref/index/review publication cannot cause another version bump.
export function recoverRepairs({ repos, stateDirectory, log = () => {} }) {
  const file = path.join(stateDirectory, journalName);
  if (!fs.existsSync(file)) return;
  const state = readState(file);
  for (const repo of repos) {
    const key = keyFor(repo.root);
    const plan = state.repos[key];
    if (!plan) continue;
    const head = git(repo.root, ['rev-parse', 'refs/heads/main']);
    if (head === plan.head) {
      completeIndex(plan);
      saveReview(stateDirectory, key, plan);
      log(`${repo.name}: recovered verified repair publication.`);
    } else if (head === plan.source) {
      // A stopped fast-forward can leave changed files. Preserve those files;
      // the next cleanliness check refuses them and the bundle retains the fix.
      releaseIndex(plan);
    } else {
      throw new Error(`${repo.name}: main changed after repair publication; recovery bundle: ${plan.bundle}`);
    }
    delete state.repos[key];
    saveState(file, state);
  }
}

export const recoverRepairPublications = recoverRepairs;

// Validation belongs to the controller. expectedTree binds this commit to the
// exact tree it checked, including additions, removals and executable modes.
export function publishRepair({ repo, stateDirectory, logFile, expectedTree,
  message = 'fix: repair updater validation failure', checkpoint = () => {} }) {
  recoverRepairs({ repos: [repo], stateDirectory });
  const captured = snapshot(repo.snapshot);
  if (captured.head !== repo.head) throw new Error('Repair snapshot revision changed.');
  if (expectedTree && captured.tree !== expectedTree) throw new Error('Repair snapshot changed after validation.');
  if (captured.tree === git(repo.snapshot, ['rev-parse', `${repo.head}^{tree}`])) {
    throw new Error('Repair did not change the captured source.');
  }
  const id = randomUUID();
  const head = git(repo.snapshot, ['commit-tree', captured.tree, '-p', repo.head, '-m', message], identity(repo.root));
  const ref = `refs/atlas/repairs/${id}`;
  git(repo.snapshot, ['update-ref', ref, head]);
  const directory = path.dirname(logFile);
  fs.mkdirSync(directory, { recursive: true });
  const bundle = path.join(directory, `repair-${repo.kind}-${id}.bundle`);
  // Declare the captured source as a prerequisite. Shallow snapshots do not own
  // its older ancestors, so bundling their apparent full history is incomplete.
  git(repo.snapshot, ['bundle', 'create', bundle, ref, `^${repo.head}`]);
  const plan = { root: repo.root, source: repo.head, head, tree: captured.tree,
    version: committedVersion({ ...repo, root: repo.snapshot }, head), bundle };
  const recovery = path.join(directory, `repair-${repo.kind}-${id}.json`);
  saveState(recovery, plan);
  const journal = path.join(stateDirectory, journalName);
  const state = readState(journal);
  const key = keyFor(repo.root);
  state.repos[key] = plan;
  saveState(journal, state);
  checkpoint('saved', plan);
  try {
    if (git(repo.root, ['rev-parse', 'refs/heads/main']) !== repo.head) throw new Error('Main changed during repair; retry against its new revision.');
    // A bundle survives temporary-workspace cleanup and imports no remote refs.
    git(repo.root, ['fetch', '--no-tags', '--no-write-fetch-head', bundle, ref]);
    const checkout = mainCheckout(repo.root);
    if (!checkout) {
      git(repo.root, ['update-ref', '-m', 'Atlas verified updater repair', 'refs/heads/main', head, repo.head]);
    } else {
      plan.checkout = checkout;
      plan.index = path.resolve(checkout, git(checkout, ['rev-parse', '--git-path', 'index']));
      plan.lock = `${plan.index}.lock`;
      plan.temporary = `${plan.index}.atlas-repair-${id}`;
      plan.lockToken = `Atlas repair index lock ${id}\n`;
      plan.originalIndex = digest(plan.index);
      // Save lock ownership before obtaining it; a foreign lock is never removed.
      saveState(journal, state);
      fs.writeFileSync(plan.lock, plan.lockToken, { flag: 'wx' });
      assertReady(checkout);
      if (git(checkout, ['symbolic-ref', 'HEAD']) !== 'refs/heads/main'
        || git(checkout, ['rev-parse', 'HEAD']) !== repo.head) throw new Error('Main checkout changed during repair.');
      if (git(checkout, ['status', '--porcelain=v1', '--untracked-files=all'])) {
        throw new Error('Main checkout has uncommitted changes; the verified repair was saved without overwriting them.');
      }
      fs.copyFileSync(plan.index, plan.temporary);
      const env = { GIT_INDEX_FILE: plan.temporary };
      if (git(checkout, ['write-tree'], env) !== git(checkout, ['rev-parse', `${repo.head}^{tree}`])) {
        throw new Error('Main staging changed during repair.');
      }
      checkpoint('locked', plan);
      if (git(checkout, ['rev-parse', 'refs/heads/main']) !== repo.head) throw new Error('Main changed during repair.');
      // The real index stays locked while Git checks and fast-forwards using its
      // private copy. Git preserves file modes and refuses conflicting edits.
      git(checkout, ['merge', '--ff-only', '--no-autostash', head], env);
      checkpoint('promoted', plan);
      completeIndex(plan);
    }
    if (git(repo.root, ['rev-parse', 'refs/heads/main']) !== head) throw new Error('Main changed after repair promotion.');
    checkpoint('review', plan);
    saveReview(stateDirectory, key, plan);
    git(repo.snapshot, ['update-ref', '-m', 'Atlas verified updater repair', 'HEAD', head, repo.head]);
    git(repo.snapshot, ['read-tree', head]);
    delete state.repos[key];
    saveState(journal, state);
    return { head, tree: plan.tree, recoveryBundle: bundle };
  } catch (error) {
    // Once main advanced, retain the owned lock/private index and journal for
    // recovery. Before promotion, release only our lock and preserve all edits.
    if (git(repo.root, ['rev-parse', 'refs/heads/main']) !== head) {
      releaseIndex(plan);
      delete state.repos[key];
      saveState(journal, state);
    }
    throw new Error(`${error.message} Recovery bundle: ${bundle}`, { cause: error });
  }
}
