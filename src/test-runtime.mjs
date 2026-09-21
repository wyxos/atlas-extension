import fs from 'node:fs';
import path from 'node:path';

// Explicit test builds only. Ordinary Dev/Stable packages retain their fixed ports.
export function testConnection(description, channel, destination) {
  if (!description) return null;
  const runtime = JSON.parse(fs.readFileSync(description, 'utf8'));
  const relative = path.relative(path.resolve(runtime.root), path.resolve(destination));
  if (channel !== 'dev' || runtime.kind !== 'wdio' || runtime.version !== 1
    || !/^[a-f0-9]{24}$/.test(runtime.id)
    || path.resolve(description) !== path.join(path.resolve(runtime.root), 'runtime.json')
    || !relative || relative.startsWith('..') || path.isAbsolute(relative)
    || !Number.isInteger(runtime.companionPort) || runtime.companionPort < 1024
    || runtime.companionPort > 65535 || [17420, 37420].includes(runtime.companionPort)) {
    throw new Error('Test extension requires a disposable WDIO runtime and an output inside it.');
  }
  return { baseUrl: `http://127.0.0.1:${runtime.companionPort}`, runtimeId: runtime.id };
}
