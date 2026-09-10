import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { createTerminal } from '../scripts/smart-rebuild/terminal.mjs';

test('live progress refreshes one row, handles resize and ends with one success line', () => {
  let output = '';
  let time = 0;
  const stream = { isTTY: true, columns: 110, write: (text) => { output += text; } };
  const display = createTerminal({ stream, env: {}, now: () => time });
  display.start('Extension: install dependencies', 1, 16);
  const initialLines = output.split('\n').length;
  time = 61000;
  display.tick();
  display.status('resolving dependencies');
  assert.equal(output.split('\n').length, initialLines);
  assert.match(output, /1m 1s/);
  assert.match(output, /1\/16 done, 15 left/);
  stream.columns = 40;
  output = '';
  display.tick();
  assert.ok(stripVTControlCharacters(output).trim().length < 40);
  display.done();
  assert.ok(output.includes('\x1b[32m'));
  assert.equal((output.match(/OK/g) || []).length, 1);
});

test('redirected output has no control codes or heartbeat noise and reports failure', () => {
  let output = '';
  const stream = { isTTY: false, write: (text) => { output += text; } };
  const display = createTerminal({ stream, env: {} });
  display.start('Desktop: run Rust tests', 4, 16);
  const before = output;
  display.tick();
  display.status('running');
  assert.equal(output, before);
  display.fail();
  assert.equal(output, stripVTControlCharacters(output));
  assert.match(output, /\[5\/16\] Desktop: run Rust tests/);
  assert.match(output, /FAILED/);
});

test('NO_COLOR retains live progress without color escapes', () => {
  let output = '';
  const display = createTerminal({ stream: { isTTY: true, columns: 100,
    write: (text) => { output += text; } }, env: { NO_COLOR: '' } });
  display.start('Extension: build', 0, 1);
  display.done();
  assert.ok(output.includes('\r\x1b[2K'));
  assert.equal(output.replaceAll('\x1b[2K', ''), stripVTControlCharacters(output));
});
