import process from 'node:process';

import { startDesktopMock } from '../tests/e2e/harness/desktop-mock.mjs';

// Standalone Desktop mock for manual runs, or as the upstream when checking
// the recording-proxy path (ATLAS_E2E_DESKTOP_URL) without native Desktop.
const mock = await startDesktopMock({ runtimeId: process.env.ATLAS_E2E_DESKTOP_RUNTIME_ID || undefined });
console.log(JSON.stringify({ url: mock.origin, runtimeId: mock.runtimeId, log: `${mock.origin}/__mock`, downloadsDir: mock.downloadsDir }));
const stop = async () => { await mock.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
