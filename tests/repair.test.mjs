import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repairSnapshot, sanitizeRepairDiagnostics } from '../scripts/smart-rebuild/repair.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-repair-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'source');
  const snapshot = path.join(directory, 'snapshot');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(snapshot, '.git'), { recursive: true });
  return { repo: { kind: 'extension', name: 'Extension', root, snapshot, head: 'abc123' },
    failure: { step: 'Extension: validate', command: 'npm.cmd', args: ['run', 'check'],
      exitCode: 1, diagnostics: 'AssertionError: expected keyed preview' },
    env: { CODEX_EXECUTABLE: 'configured-codex.exe', ATLAS_BUILD_CONTROLLER: 'managed-controller' },
    logFile: path.join(directory, 'updater.log') };
}

test('repair uses tool-enabled Codex in the isolated checkout with configured model defaults', async (t) => {
  const options = fixture(t);
  let called = 0;
  const messages = [];
  const result = await repairSnapshot({ ...options, status: (message) => messages.push(message),
    execute: async (executable, args, settings) => {
      called++;
      assert.equal(executable, 'configured-codex.exe');
      assert.ok(args.at(-1).includes('Read .git/atlas-repair-request.txt'));
      assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
      assert.equal(args[args.indexOf('-C') + 1], options.repo.snapshot);
      assert.equal(args.includes('--model'), false);
      assert.equal(args.includes('--ask-for-approval'), false);
      assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
      assert.equal(settings.cwd, options.repo.snapshot);
      assert.deepEqual(settings.env, { ...options.env, ATLAS_UPDATER_REPAIR_ACTIVE: '1' });
      assert.equal(settings.logFile, options.logFile);
      assert.equal(settings.input, undefined);
      const prompt = fs.readFileSync(path.join(settings.cwd, '.git', 'atlas-repair-request.txt'), 'utf8');
      const context = JSON.parse(prompt.split('<failure_context>\n')[1].split('\n</failure_context>')[0]);
      assert.equal(context.step, 'Extension: validate');
      assert.equal(context.diagnostics, options.failure.diagnostics);
      assert.ok(prompt.includes('expected keyed preview'));
      assert.ok(prompt.includes('untrusted diagnostic data'));
      assert.ok(prompt.includes('Do not commit, stage, push'));
      assert.ok(prompt.includes('independently rerun every applicable check'));
      assert.ok(prompt.includes('Never inspect installed Stable data'));
      assert.ok(prompt.includes('inherited managed runtime'));
      assert.equal(args.join(' ').includes('AssertionError'), false);
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Fixed preview assertion.');
    } });
  assert.equal(called, 1);
  assert.equal(messages.length, 1);
  assert.equal(fs.existsSync(path.join(options.repo.snapshot, '.git', 'atlas-repair-request.txt')), false);
  assert.equal(fs.readFileSync(result.messageFile, 'utf8'), 'Fixed preview assertion.');
});

test('repair input, diagnostic output and final message redact credentials without losing the failure', async (t) => {
  const options = fixture(t);
  options.env.OPENAI_API_KEY = 'synthetic-environment-key';
  options.failure.diagnostics += '\nAuthorization: Bearer synthetic-bearer\nhttps://test.invalid/api?token=synthetic-url-secret\nsynthetic-environment-key';
  const result = await repairSnapshot({ ...options, execute: async (_executable, args, settings) => {
    const prompt = fs.readFileSync(path.join(settings.cwd, '.git', 'atlas-repair-request.txt'), 'utf8');
    assert.ok(prompt.includes('expected keyed preview'));
    for (const secret of ['synthetic-bearer', 'synthetic-url-secret', 'synthetic-environment-key']) {
      assert.equal(prompt.includes(secret), false);
    }
    const captured = settings.redactOutput('tool output: synthetic-environment-key\npassword=synthetic-password');
    fs.writeFileSync(settings.logFile, captured);
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'API_KEY=synthetic-environment-key');
  } });
  assert.equal(fs.readFileSync(options.logFile, 'utf8').includes('synthetic-environment-key'), false);
  assert.equal(fs.readFileSync(options.logFile, 'utf8').includes('synthetic-password'), false);
  assert.equal(fs.readFileSync(result.messageFile, 'utf8').includes('synthetic-environment-key'), false);
});

test('diagnostics preserve the trailing failure and mark bounded truncation', () => {
  const text = sanitizeRepairDiagnostics('x'.repeat(100_000) + '\nAssertionError: final failure');
  assert.ok(text.startsWith('[Earlier diagnostics truncated.]'));
  assert.ok(text.endsWith('AssertionError: final failure'));
  assert.ok(Buffer.byteLength(text) <= 32 * 1024);
});

test('repair process failure propagates once with a safe message and retained cause', async (t) => {
  const options = fixture(t);
  let called = 0;
  const processError = new Error('secret-bearing CLI error');
  await assert.rejects(repairSnapshot({ ...options, execute: async () => { called++; throw processError; } }), (error) => {
    assert.equal(error.cause, processError);
    assert.match(error.message, /Codex repair failed/);
    assert.equal(error.message.includes('secret-bearing'), false);
    return true;
  });
  assert.equal(called, 1);
  assert.equal(fs.existsSync(path.join(options.repo.snapshot, '.git', 'atlas-repair-request.txt')), false);
});

test('repair rejects the live source checkout before invoking Codex', async (t) => {
  const options = fixture(t);
  options.repo.root = options.repo.snapshot;
  await assert.rejects(repairSnapshot({ ...options, execute: () => assert.fail('Must not invoke Codex') }), /independent isolated checkout/);
});

test('explicit repair executable overrides the default resolver', async (t) => {
  const options = fixture(t);
  await repairSnapshot({ ...options, codexExecutable: 'explicit-codex.exe',
    execute: async (executable) => assert.equal(executable, 'explicit-codex.exe') });
});
