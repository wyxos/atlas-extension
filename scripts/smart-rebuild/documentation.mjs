import { git } from './repository.mjs';

// Only prose outside runtime assets is exempt. Markdown under src/public/resources,
// executable docs, symlinks and unknown files still use the full update pipeline.
export function isDocumentationPath(file) {
  return file === 'README.md' || file === 'scripts/SMART_REBUILD.md'
    || file === 'scripts/smart-rebuild/README.md'
    || /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(file);
}

export function documentationOnlyChanges(root, base, head) {
  if (!base || !head) return false;
  let raw;
  try {
    // Disable rename detection so both the old and new path must be safe. NUL
    // separators preserve spaces, newlines and non-ASCII names without quoting.
    raw = git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames',
      '--ignore-submodules=none', '--raw', '-z', base, head, '--']);
  } catch { return false; } // Missing/pruned baselines must rebuild conservatively.
  if (!raw) return false;
  const entries = raw.split('\0');
  if (entries.pop() !== '' || entries.length % 2 !== 0) return false;
  for (let index = 0; index < entries.length; index += 2) {
    const header = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([AMD])$/.exec(entries[index]);
    if (!header || ![header[1], header[2]].every(mode => ['000000', '100644'].includes(mode))
      || !isDocumentationPath(entries[index + 1])) return false;
  }
  return true;
}
