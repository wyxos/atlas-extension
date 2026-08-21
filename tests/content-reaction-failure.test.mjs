import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const mainSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/main.js'),
  'utf8',
);
const failureSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/reaction-failure-state.js'),
  'utf8',
);

test('a post-success close action cannot replace an accepted reaction with a fake failed download', () => {
  assert.match(mainSource, /reactionFailureFromError/);
  assert.match(failureSource, /The reaction was saved, but the tab close action could not be prepared/);
  assert.doesNotMatch(mainSource, /progress_percent:\s*0,[\s\S]{0,80}status:\s*'failed'/);
});
