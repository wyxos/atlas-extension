import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// npm run test:e2e [-- --headed] [-- --proof] [-- --proof-dir=<dir>] [-- <file filter>]
// Headless Chromium by default. --headed uses a real window (wrapped in
// xvfb-run on Linux without a display). --proof records video/screenshots
// at a watchable pace and converts the video to MP4 when ffmpeg exists.
const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const env = { ...process.env };
const headed = argv.includes('--headed');
const proofDirArgument = argv.find(value => value.startsWith('--proof-dir='))?.slice('--proof-dir='.length);
const proofDir = proofDirArgument ? path.resolve(proofDirArgument)
  : argv.includes('--proof') ? path.join(root, 'test-results', 'e2e-proof') : null;
const filters = argv.filter(value => !value.startsWith('--'));
if (headed) env.ATLAS_E2E_HEADED = '1';
if (proofDir) {
  fs.rmSync(proofDir, { recursive: true, force: true });
  fs.mkdirSync(proofDir, { recursive: true });
  env.ATLAS_E2E_ARTIFACT_DIR = proofDir;
  env.ATLAS_E2E_SLOWMO ??= '60';
}
const directory = path.join(root, 'tests', 'e2e');
const files = fs.readdirSync(directory).filter(name => name.endsWith('.e2e.test.mjs'))
  .filter(name => filters.length === 0 || filters.some(filter => name.includes(filter)))
  .map(name => path.join(directory, name));
const command = [process.execPath, '--test', '--test-concurrency=1', ...files];
const useXvfb = headed && process.platform === 'linux' && !env.DISPLAY && hasCommand('xvfb-run');
const result = useXvfb
  ? spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', ...command], { cwd: root, env, stdio: 'inherit' })
  : spawnSync(command[0], command.slice(1), { cwd: root, env, stdio: 'inherit' });
if (proofDir && result.status === 0) convertVideos(proofDir);
process.exit(result.status ?? 1);

function convertVideos(directory) {
  if (!hasCommand('ffmpeg')) {
    console.warn('ffmpeg is not installed; keeping WebM videos only.');
    return;
  }
  for (const name of fs.readdirSync(directory).filter(file => file.endsWith('.webm'))) {
    const source = path.join(directory, name);
    const target = source.replace(/\.webm$/, '.mp4');
    const converted = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', target], { stdio: 'inherit' });
    if (converted.status === 0) console.log(`Converted ${path.relative(root, target)}`);
  }
}

function hasCommand(name) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' }).status === 0;
}
