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

## Stable update workflow

On this Windows machine, use the **Update Atlas (Desktop + Extension)** desktop shortcut.
It launches `scripts/rebuild-atlas.ps1` in this repository. Both checkouts must be siblings:
`atlas-extension` and `atlas-desktop`. PowerShell 7, Node/npm, Git, the existing Desktop
build dependencies, and a signed-in Codex CLI are required. Codex is discovered from
the desktop app installation or PATH; `CODEX_EXECUTABLE` can override discovery.

For inspection without releasing:

```powershell
pwsh -NoProfile -File D:\code\wyxos\js\atlas-extension\scripts\rebuild-atlas.ps1 -DryRun
```

## Behavior

1. Validate both Git checkouts, then process Extension followed by Desktop.
2. Compare each working tree against its own last successful local release.
   Include tracked, staged, unstaged, deleted and non-ignored untracked files.
   Git-ignored files (including `.env`, build output and dependencies) are not source changes.
   Empty commits alone do not cause a rebuild.
3. Skip unchanged source when its output fingerprint also matches. Missing or altered
   output is restored at the same version.
4. Capture immutable Git evidence and pass it to Codex on stdin in read-only mode.
   Codex classifies the supplied evidence without invoking shell/file tools, avoiding
   dependency on Windows sandbox helper ACL setup. Input includes all commit messages,
   file statistics and the full current working-tree text diff (including new files).
   Historical patches are included up to 200,000 characters; larger histories use all
   commit messages and statistics, explicitly identified as a summary. Oversized total
   input stops rather than silently dropping current changes. Ask Codex to
   return a major/minor/patch recommendation, meaningful commit message and reason.
   Codex chooses major for breaking changes, minor for visible features, and patch
   for fixes, documentation, tooling and internal changes. A failed or refused Codex
   review stops the run; there is no silent heuristic fallback.
5. Update version files, run that repo's `npm run check`, and make a local commit
   with Codex's message. All current non-ignored working changes are included.
   AD and AE have independent versions. No push, remote release or Git tag is created.
6. Run the existing per-repo script. AE uses `rebuild-unpacked-extension.ps1`, preserving
   `CHANNEL=stable` and the exact output directory:
   `D:\code\wyxos\js\atlas-extension\dist\atlas-extension-stable-validation`.
   AD uses `rebuild-and-run-installer.ps1`, preserving its cached production/NSIS build,
   graceful shutdown, silent `/S /R /NCRC` installation and reopen behavior.
7. Record success only after the build/install succeeds and expected output exists.

An AE-only change does **not** trigger an AD build. The next AD build refreshes its
bundled AE using the existing Desktop preparation logic. Browser profiles continue
using the same unpacked directory; reload the extension through its existing reload
control or browser extensions page to activate rebuilt code.

## State, retries and troubleshooting

State and logs live in `%LOCALAPPDATA%\AtlasBuild`, outside the repositories and the
Atlas installation directory. `state.json` records each checkout's prepared/successful
commit, Git tree, version and output hash. `update-*.log` contains launcher output;
`codex-extension.log` and `codex-desktop.log` contain the most recent Codex runs.

The old launchers did not record source provenance. The first real run therefore
prepares and builds each repo once, using the current version tag (or the last commit
that changed its version declaration) as Codex's review baseline. Later runs use the
last successful local release. Do not delete state to retry a failed release.

Preparation is journaled before validation/commit. Validation, commit, build or installer
failures can be retried with the same prepared version while source is unchanged.
Already completed repos are skipped. Edits after a failure are reviewed again. Source
or staging changes detected during review/check/build stop the run. Finish concurrent
editing before launching an update. A process lock prevents overlapping smart updates;
stale locks whose process has exited are recovered on the next run.

AD version updates cover `package.json`, its root lockfile entry, Tauri configuration,
the root Cargo package and its Cargo lock entry. AE updates `package.json`,
`manifest.json`, and the local root lockfile entry if present. Dependency versions are
preserved. An already manually advanced version after a successful release is retained.

Use the unified launcher for routine updates. The old scripts remain available as
low-level build tools; invoking them directly does not update smart-release state.
The previous desktop shortcuts are backed up under `AtlasBuild\previous-shortcuts`.

Codex integration follows the official
[non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode).
