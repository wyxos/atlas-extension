# Atlas desktop updater

The Windows **Update Atlas (Desktop + Extension)** shortcut runs `rebuild-atlas.ps1`,
which invokes `smart-rebuild.mjs`. See [the workflow contract](../SMART_REBUILD.md).

The active controller runs these steps before building:

1. Recover any journaled version commit.
2. Offer to commit or exclude uncommitted main changes through `main-changes.mjs`.
3. Review committed changes independently through `version-review.mjs`. Codex selects
   none, patch, minor or major from immutable Git evidence since the latest version
   commit. Cursor is used when Codex fails or has no quota. Source commits are already
   finished; the reviewer does not plan or edit them here.
4. Create a separate version-only commit when needed through `version-commit.mjs`.
   Save the plan before publishing, preserve unrelated edits/staging, and recover
   interrupted version writes without another review or bump.
5. Pass the exact reviewed commits to `isolated.mjs` for checks, builds and publication.
   Moving main afterward affects the next run, not the current build.

`codex-review.mjs` supplies the shared stdin/structured-output CLI transport. Codex
runs first. If that CLI fails, including a usage-limit error, the same review is
retried through the signed-in Cursor Agent CLI in ask mode. On Windows that CLI is
`%LOCALAPPDATA%\cursor-agent\agent.cmd`, not `Cursor.exe`. A native updater also
looks in the Codex Store app LocalCache when the ordinary AppData copy is missing.
Windows reviews use `--sandbox disabled` and `--model auto` so the CLI does not
require macOS/Linux sandboxing or a saved Opus default. A refused or malformed
decision still stops preparation. There is no heuristic version fallback.
`version-state.json` tracks reviews and publication independently of successful builds
in `isolated-state.json`; neither reuses legacy release state. Dry runs do not invoke
Codex or Cursor, commit, recover publication, create state, or build.

`workflow.mjs`, `review-input.mjs`, and task-context/semantic-commit helpers belong to
the legacy working-tree release workflow and are not invoked by the shortcut. Shared
version transforms and Git tree helpers remain in use. Their legacy tests do not
replace the committed-source and isolated-build regression tests.
