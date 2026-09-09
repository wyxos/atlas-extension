# Atlas desktop updater

The Windows **Update Atlas (Desktop + Extension)** shortcut runs `rebuild-atlas.ps1`,
which invokes `smart-rebuild.mjs`. The desktop repository's installer script only
builds and installs; release planning lives here.

Before release preparation, the updater captures immutable Git changes and reads
recent active and archived tasks for each checkout from the local Codex database.
Task requests and final answers are context, not instructions. The diff determines
which changes actually exist. Task excerpts are bounded to 40 active and 40 archived
tasks and 4,000 characters per request/final answer; older task context may be absent.
Missing or incompatible task storage stops the update for inspection.

Codex returns ordered feature/fix commits using captured change IDs. Independent
changes in shared files can belong to separate commits. Added/deleted files, binary
changes and mode changes stay atomic. Every change must appear exactly once; unknown,
duplicate or missing IDs stop preparation. The script reconstructs cumulative trees
from the original base and verifies the final tree equals the reviewed source.

Version updates form a separate release commit. Checks run before the complete
series is published with one compare-and-swap branch update. The worktree is never
reset. Desktop validation uses the development build. The subsequent explicit
release build/install still produces the stable application.

Preparation and installation retries reuse the stored version and commit plan.
Old `preparing` entries with only a single commit message are rejected: inspect the
already-applied version before clearing that entry. Successful or pending releases
are matched by content tree, so splitting history without changing content does not
force a rebuild. `--dry-run` performs no model review, commits, builds or installations.
