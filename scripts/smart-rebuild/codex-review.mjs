import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Shared input-only CLI transport; the controller validates and applies decisions.
export function codexReview({ repo, stateDirectory, name, schema, prompt, execute = spawnSync }) {
  fs.mkdirSync(stateDirectory, { recursive: true });
  const schemaFile = path.join(stateDirectory, `${name}-schema.json`);
  const output = path.join(stateDirectory, `${name}-${repo.kind}.json`);
  const logFile = path.join(stateDirectory, `${name}-${repo.kind}.log`);
  fs.writeFileSync(schemaFile, JSON.stringify(schema));
  fs.rmSync(output, { force: true });
  const vendor = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex',
    'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  const executable = process.env.CODEX_EXECUTABLE || (fs.existsSync(vendor) ? vendor : 'codex.exe');
  const descriptor = fs.openSync(logFile, 'w');
  try {
    const result = execute(executable, ['exec', '--ephemeral', '--sandbox', 'read-only', '-C', repo.root,
      '--output-schema', schemaFile, '--output-last-message', output, '--color', 'never', '-'], {
      input: prompt, encoding: 'utf8', windowsHide: true, stdio: ['pipe', descriptor, descriptor], timeout: 15 * 60 * 1000,
    });
    if (result.error || result.status !== 0) throw new Error(`Codex review failed. See ${logFile}`, { cause: result.error });
  } finally { fs.closeSync(descriptor); }
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}
