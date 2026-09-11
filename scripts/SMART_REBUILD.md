# Update Atlas Desktop and Extension

## Dev and production extensions

Use the **Rebuild Atlas Extension** shortcut on the Windows desktop to compile the current
extension source for both channels. It runs `scripts/rebuild-dev-extension.ps1` with
explicit channel selection and verifies each build's channel marker:

- Dev (`--channel dev`): `D:\code\wyxos\js\atlas-extension\dist\atlas-extension-v0.1.0`.
- Production (`--channel stable`): `D:\code\wyxos\js\atlas-extension\dist\atlas-extension-stable-validation`.

Reload each Atlas extension in the browser extensions page after building. This
compile-only launcher does not bump versions, commit source changes, or rebuild Desktop.

## Desktop launcher completion

The **Atlas Desktop Dev**, **Rebuild Atlas Extension**, and **Update Atlas (Desktop + Extension)**
desktop shortcuts run their scripts through `scripts/run-desktop-script.ps1`. When the
script finishes or fails, the window shows **Press Enter to exit** and closes after Enter.
The wrapper preserves the script's exit code. Shortcuts must omit `-NoExit`, which would
leave an interactive shell open afterward. Calling the underlying scripts directly remains
suitable for unattended workflows.

## Isolated update workflow

Use **Update Atlas (Desktop + Extension)**. It launches `scripts/rebuild-atlas.ps1`.
The repositories must remain siblings named `atlas-extension` and `atlas-desktop`.
PowerShell 7, Git, Node/npm and Desktop build tools are required. The optional
commit step also requires the signed-in standalone Codex CLI.

1. Capture each local `refs/heads/main` commit before starting any build. No fetch
   from a remote, version bump, stash, branch switch or merge is performed.
   Before capture, dirty main checkouts offer Commit via Codex, Skip (default), or
   Cancel. Skip excludes staged, unstaged and untracked edits. Commit asks Codex
   for a message based on an immutable diff, verifies no edits/staging changed,
   and commits exactly that snapshot. Version files are not automatically changed.
   The main checkout is found even when the launcher runs from another branch.
2. Skip repositories whose committed source tree and published output fingerprint
   match the last successful isolated build. Missing or altered output is rebuilt.
3. Fetch each captured commit into a temporary independent Git repository under
   `%LOCALAPPDATA%\AtlasBuild\workspaces`. Each build uses its own dependencies
   installed with `npm ci` when a committed lockfile exists, otherwise `npm install`
   inside the temporary checkout. The Extension currently ignores its lockfile;
   transitive dependencies may resolve differently between builds. Ignored local `.env`
   files and local dependency links are not copied.
4. Run repository checks there. Desktop uses development frontend validation in
   place of the production frontend check. Build Extension stable output; build
   Desktop with the existing NSIS installer, graceful shutdown and silent install.
   Desktop's `EXTENSION_SOURCE` always points to the captured Extension snapshot.
5. Publish Extension to the existing `dist\atlas-extension-stable-validation`
   directory only after a successful build and verified copy. Sibling staging and
   backup directories recover an interrupted replacement. Reload the browser
   extension afterward. An Extension-only change allocates no Desktop Rust target.
6. Record each successful repository independently. Remove temporary checkouts and
   dependencies on success or failure. Desktop's build-storage manager leases the
   updater target and shared compiler cache, and applies the repository family's
   60 GiB retention policy. Active scopes protect snapshots and cache resources.
   Normal package download caches and updater state remain available for future runs.

Commit desired source and version updates to local main before rebuilding. A change
already committed to main is included even if the larger feature remains unfinished.
Moving main after snapshot capture affects only the next run. The two captured
commits are fixed for the run, but cross-repository compatibility remains the
responsibility of the committed changes.

## Progress and logs

The interactive terminal uses blue repository headings and a single active line
that updates in place with elapsed time, a completed-step bar and steps remaining.
Each finished step leaves one green success line; failures are red and outstanding
actions are yellow. Repeated heartbeat lines and commit-message chatter are omitted.
Step counts are not estimates of compilation percentage or remaining build time.
Redirected output uses plain step transitions without animation or ANSI colors;
`NO_COLOR` disables colors in an interactive terminal too. The detail-log path is
shown at completion or failure, and the log contains the full outstanding step list.
Raw compiler, npm, test and installer output goes to
the Desktop scope's managed diagnostics directory, printed by the updater. Detail
logs are capped at 16 MiB and share the seven-day/1 GiB retention policy. The latest
launcher summary is `%LOCALAPPDATA%\AtlasBuild\update-latest.log`. The window still waits for **Press Enter to exit**.

Use `-DryRun` to inspect captured main commits and rebuild decisions without
building, publishing, changing versions or invoking Codex:

```powershell
pwsh -NoProfile -File D:\code\wyxos\js\atlas-extension\scripts\rebuild-atlas.ps1 -DryRun
```

## State and recovery

`AtlasBuild\isolated-state.json` is separate from the legacy `state.json` so old
working-tree release provenance cannot be mistaken for an isolated build. The
first isolated run builds both repositories once at their committed versions.
Successful repositories are skipped on retries; failed ones retry without bumps.

`AtlasBuild\update.lock` prevents overlapping unified updates. After an interrupted update, run the launcher with `-RecoverLock`. Recovery refuses a live lock owner, surviving isolated-build or installer processes, or processes it cannot inspect. It checks the lock again before removing it. This is recovery, not permission to run overlapping installers. The storage manager removes abandoned registered workspaces after their OS leases end; legacy workspaces require its verified migration.
Cleanup failures are reported and retried on a later build. The updater obtains its
storage scope from Desktop's maintained controller before executing commands. Its
processes are supervised even when a captured revision predates the manager. Nested
current commands reuse that validated scope; old hard-coded outputs remain within
the registered disposable snapshot. Retained targets are separate from dev targets
and are pruned automatically when inactive and over the size/age policy. Both
repositories need the managed-storage controller change before this updater runs.
Do not run the low-level rebuild scripts concurrently with the unified updater.

The compile-only **Rebuild Atlas Extension** shortcut and **Atlas Desktop Dev**
continue to use current development sources. This isolated workflow applies to
**Update Atlas (Desktop + Extension)**.

For an unattended build of committed main, pass `-SkipUncommitted` to the PowerShell
launcher or `--skip-uncommitted` to the Node entry point. Without this flag, a
noninteractive run with dirty main stops instead of silently choosing to commit.
Codex review logs use `AtlasBuild\commit-<repository>.log`. A failed/refused review
or a concurrent edit stops before the commit. Git's index lock protects staging
while the captured tree is committed; newer working files are never reset.

Desktop frontend tests run with four workers to keep cold module transforms from
timing out short tests through CPU contention. Codex's input-only review uses
[non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

The installer controller accepts an explicit RepositoryRoot and honors the dedicated
CARGO_TARGET_DIR. The controller runs from the maintained Desktop launcher scripts;
all npm/application inputs come from the captured checkout. Importer preparation
uses the assigned target for current revisions and an owned snapshot output directory
for compatibility with older main revisions.
Temporary build workspaces do not use Cargo cache junctions. Installation closes
only the installed app being replaced, leaving isolated worktree apps running. The
outer launcher reopens the installed app after releasing the build job, with the
disposable build environment removed.

Installed-executable verification compares every byte with the built executable,
allowing only Tauri's single fixed-width bundle marker change from
__TAURI_BUNDLE_TYPE_VAR_UNK to __TAURI_BUNDLE_TYPE_VAR_NSS. Tauri restores the
unbundled marker in the build output after NSIS packaging. Any other byte change,
size difference, missing marker or ambiguous marker is rejected. Native validation
prepares both the bundled extension and pinned media tools before Rust checks/tests.
