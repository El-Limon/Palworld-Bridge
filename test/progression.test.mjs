import test from 'node:test';
import assert from 'node:assert/strict';
import { progressionAnswer, restLevel } from '../dist/progression.js';
import { buildManifest } from '../dist/protocol-v1.js';

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9-]*)*$/;

test('the manifest declares progression as server-owned', () => {
  const cap = buildManifest().find((c) => c.name === 'players.progression');
  assert.deepEqual(cap, { name: 'players.progression', parameters: { source: 'server' } });
});

test('an unknown player is null, never an error', () => {
  assert.equal(progressionAnswer(undefined), null);
});

test('a known player without a trustworthy level has no tracks', () => {
  assert.deepEqual(progressionAnswer({}), []);
});

test('the character track carries the level and, when known, the experience', () => {
  assert.deepEqual(progressionAnswer({ level: 12 }), [{ key: 'character', name: 'Level', level: 12 }]);
  assert.deepEqual(progressionAnswer({ level: 12, experience: 4310 }), [{ key: 'character', name: 'Level', level: 12, experience: 4310 }]);
  assert.match(progressionAnswer({ level: 1 })[0].key, KEY);
});

test('only a whole positive REST level counts', () => {
  assert.equal(restLevel({ level: 2 }), 2);
  for (const level of [0, -1, 1.5, '2', null, undefined, NaN]) assert.equal(restLevel({ level }), undefined, String(level));
});
