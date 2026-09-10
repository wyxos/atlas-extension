import fs from 'node:fs';
import path from 'node:path';
import { runIsolatedUpdate } from './smart-rebuild/isolated.mjs';
import { prepareMainChanges } from './smart-rebuild/main-changes.mjs';
const extensionRoot = path.resolve(import.meta.dirname, '..');
const stateDirectory = path.join(process.env.LOCALAPPDATA, 'AtlasBuild');
const args = process.argv.slice(2);
let locked = false;
const lock = path.join(stateDirectory, 'update.lock');
try {
  if (args.some((arg) => !['--dry-run', '--skip-uncommitted'].includes(arg))) throw new Error('Supported options: --dry-run, --skip-uncommitted');
  if (!args.includes('--dry-run')) {
    fs.mkdirSync(stateDirectory, { recursive: true });
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw new Error('An update is running or was interrupted. For an interrupted update, confirm its child processes have stopped before removing AtlasBuild/update.lock.', { cause: error });
    }
    locked = true;
  }
  const repos = [
    { kind: 'extension', name: 'Extension', root: extensionRoot,
      artifact: path.join(extensionRoot, 'dist', 'atlas-extension-stable-validation') },
    { kind: 'desktop', name: 'Desktop', root: path.resolve(extensionRoot, '..', 'atlas-desktop'),
      artifact: path.join(process.env.LOCALAPPDATA, 'Atlas', 'atlas-desktop.exe') },
  ];
  await prepareMainChanges({ repos, stateDirectory, dryRun: args.includes('--dry-run'), skip: args.includes('--skip-uncommitted') });
  await runIsolatedUpdate({ stateDirectory, dryRun: args.includes('--dry-run'), repos });
} catch (error) {
  console.error(`Stopped: ${error.message}`);
  process.exitCode = 1;
} finally { if (locked) fs.unlinkSync(lock); }
