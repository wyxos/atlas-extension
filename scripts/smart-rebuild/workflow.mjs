import fs from 'node:fs';
import path from 'node:path';
import { changeUnits, plannedCommits, publishCommits, versionTree } from './commit-plan.mjs';
import {
  artifactFingerprint, assertReady, assertSnapshot, bumpVersion, compareVersions,
  readVersion, releaseBase, saveState, snapshot, updateVersions,
} from './repository.mjs';

export async function runUpdate({ repos, statePath, analyze, check, build, dryRun = false, log = console.log }) {
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { schema: 1, repos: {} };
  if (state.schema !== 1 || !state.repos) throw new Error('Unknown Atlas update state format.');
  const results = [];
  // Validate both checkouts before preparing either release.
  for (const repo of repos) assertReady(repo.root);
  const expected = new Map(repos.map((repo) => [repo.root, snapshot(repo.root)]));
  function assertOtherRepos(active) {
    for (const repo of repos) if (repo.root !== active.root) assertSnapshot(repo.root, expected.get(repo.root));
  }
  for (const repo of repos) {
    const key = path.resolve(repo.root).toLowerCase();
    const previous = state.repos[key] ?? {};
    const initial = snapshot(repo.root);
    if (JSON.stringify(initial) !== JSON.stringify(expected.get(repo.root))) {
      throw new Error(`${repo.name}: source changed while the other repository was updating.`);
    }
    const artifact = artifactFingerprint(repo.artifact);
    if (!initial.status && previous.success?.tree === initial.tree && artifact
      && previous.success.artifact === artifact) {
      log(`${repo.name}: unchanged; skipped.`);
      results.push({ name: repo.name, action: 'skip' });
      continue;
    }
    const pending = previous.pending?.tree === initial.tree && !initial.status ? previous.pending : null;
    const preparing = previous.preparing?.tree === initial.tree ? previous.preparing : null;
    if (preparing && !preparing.commits) {
      throw new Error('Legacy single-commit preparation found; review its version and clear preparing state before retrying.');
    }
    const repair = previous.success?.tree === initial.tree && !initial.status ? previous.success : null;
    const action = pending || preparing ? 'retry' : repair ? 'restore' : 'release';
    log(`${repo.name}: ${action}${initial.status ? ' (uncommitted changes)' : ''}.`);
    if (dryRun) {
      results.push({ name: repo.name, action, version: readVersion(repo) });
      continue;
    }
    let prepared = pending ?? repair;
    if (!prepared) {
      let plan = preparing;
      if (!plan) {
        const currentVersion = readVersion(repo);
        const base = previous.success?.head ?? releaseBase(repo, currentVersion);
        const decision = await analyze({ repo, base, currentVersion, initial });
        if (decision.proceed !== true || !Array.isArray(decision.commits)
          || !['major', 'minor', 'patch'].includes(decision.bump) || !decision.reason?.trim()) {
          throw new Error(`${repo.name}: Codex did not approve release preparation. ${decision.reason ?? ''}`);
        }
        const files = changeUnits(repo.root, initial.head, initial.tree);
        const commits = plannedCommits(repo.root, initial.head, files, decision.commits);
        if (commits.length && commits.at(-1).tree !== initial.tree) throw new Error('Commit plan changed source content.');
        assertSnapshot(repo.root, initial);
        assertOtherRepos(repo);
        const floor = previous.pending?.version ?? previous.success?.version ?? currentVersion;
        // Keep a manually advanced version; otherwise apply Codex's decision.
        const version = compareVersions(currentVersion, floor) > 0 ? currentVersion
          : bumpVersion(compareVersions(currentVersion, floor) < 0 ? floor : currentVersion, decision.bump);
        log(`${repo.name}: ${currentVersion} -> ${version} (${decision.bump}): ${decision.reason}`);
        const updates = updateVersions(repo, version);
        const tree = versionTree(repo.root, initial.tree, updates);
        if (snapshot(repo.root).tree !== tree) throw new Error('Source changed during version preparation.');
        commits.push({ tree, message: `chore(release): prepare ${repo.name} ${version}`,
          reason: `Atlas local release: ${repo.kind} v${version}\n\n${decision.reason}` });
        plan = { tree, base: initial.head, version, reason: decision.reason, commits };
        log(`${repo.name}: planned commits:\n${commits.map((commit) => `  ${commit.message}`).join('\n')}`);
        // Save before validation/commit so failures reuse this version on the next run.
        state.repos[key] = { ...previous, preparing: plan };
        saveState(statePath, state);
      }
      const versioned = snapshot(repo.root);
      await check(repo);
      assertSnapshot(repo.root, versioned);
      assertOtherRepos(repo);
      if (versioned.status) {
        if (versioned.head !== plan.base) throw new Error('Release base changed; refusing to publish the commit plan.');
        publishCommits(repo.root, plan.base, plan.commits);
      }
      const committed = snapshot(repo.root);
      if (committed.status || committed.tree !== versioned.tree) {
        throw new Error(`${repo.name}: files changed while committing; release stopped.`);
      }
      prepared = { head: committed.head, tree: committed.tree, version: plan.version, reason: plan.reason };
    }
    // Recover a commit made immediately before an interrupted state write.
    state.repos[key] = { success: previous.success, pending: prepared };
    saveState(statePath, state);
    const beforeBuild = snapshot(repo.root);
    if (beforeBuild.status || beforeBuild.tree !== prepared.tree) throw new Error(`${repo.name}: source changed before build.`);
    expected.set(repo.root, beforeBuild);
    assertOtherRepos(repo);
    // A failed build keeps pending, so the next run retries without another bump.
    await build(repo);
    assertSnapshot(repo.root, beforeBuild);
    assertOtherRepos(repo);
    const output = artifactFingerprint(repo.artifact);
    if (!output) throw new Error(`${repo.name}: build did not produce the expected artifact.`);
    state.repos[key] = { success: { ...prepared, artifact: output } };
    saveState(statePath, state);
    log(`${repo.name}: v${prepared.version} completed.`);
    results.push({ name: repo.name, action, version: prepared.version });
  }
  return results;
}
