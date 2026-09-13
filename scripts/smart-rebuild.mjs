import fs from 'node:fs';
import path from 'node:path';
import { loadBuildController, runIsolatedUpdate } from './smart-rebuild/isolated.mjs';
import { prepareMainChanges } from './smart-rebuild/main-changes.mjs';
import { terminal } from './smart-rebuild/terminal.mjs';
const extensionRoot = path.resolve(import.meta.dirname, '..');
const stateDirectory = path.join(process.env.LOCALAPPDATA, 'AtlasBuild');
const args = process.argv.slice(2);
let locked = false;
const lock = path.join(stateDirectory, 'update.lock');
try {
  if (args.some((arg) => !['--dry-run', '--skip-uncommitted'].includes(arg))) throw new Error('Supported options: --dry-run, --skip-uncommitted');
  const desktopRoot = path.resolve(extensionRoot, '..', 'atlas-desktop');
  // Check compatibility before asking to commit either repository or creating state.
  await loadBuildController(desktopRoot);
  if (!args.includes('--dry-run')) {
    fs.mkdirSync(stateDirectory, { recursive: true });
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // The PowerShell launcher uses this distinct result to offer checked recovery.
      process.exitCode = 73;
      throw new Error('An update is running or was interrupted. To recover an interrupted update, run rebuild-atlas.ps1 -RecoverLock; it checks for active build processes before unlocking.', { cause: error });
    }
    locked = true;
  }
  const repos = [
    { kind: 'extension', name: 'Extension', root: extensionRoot,
      artifact: path.join(extensionRoot, 'dist', 'atlas-extension-stable-validation') },
    { kind: 'desktop', name: 'Desktop', root: desktopRoot,
      artifact: path.join(process.env.LOCALAPPDATA, 'Atlas', 'atlas-desktop.exe') },
  ];
  await prepareMainChanges({ repos, stateDirectory, dryRun: args.includes('--dry-run'), skip: args.includes('--skip-uncommitted') });
  await runIsolatedUpdate({ stateDirectory, dryRun: args.includes('--dry-run'), repos });
} catch (error) {
  terminal.line(`Stopped: ${error.message}`, 'red');
  process.exitCode ??= 1;
} finally { if (locked) fs.unlinkSync(lock); }
