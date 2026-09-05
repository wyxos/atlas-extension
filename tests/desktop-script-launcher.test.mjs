import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('desktop launcher waits for Enter after success, failure, and explicit exit', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'atlas-launcher-'));
  try {
    for (const [script, expectedExitCode] of [
      ["Write-Host 'Finished successfully'", 0],
      ["throw 'Synthetic failure'", 1],
      ['exit 7', 7],
    ]) {
      const scriptPath = path.join(directory, 'fixture.ps1');
      await writeFile(scriptPath, script);
      const child = spawn('pwsh.exe', ['-NoProfile', '-File',
        path.resolve(import.meta.dirname, '../scripts/run-desktop-script.ps1'), '-ScriptPath', scriptPath,
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      try {
        let output = '';
        const closed = new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        child.stderr.resume();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`No exit prompt: ${output}`)), 8000);
          child.stdout.on('data', (chunk) => {
            output += chunk;
            if (output.includes('Press Enter to exit')) { globalThis.clearTimeout(timeout); resolve(); }
          });
        });
        assert.equal(child.exitCode, null, 'launcher must remain open at the prompt');
        child.stdin.end('\n');
        assert.equal(await closed, expectedExitCode);
      } finally { if (child.exitCode === null) child.kill(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
