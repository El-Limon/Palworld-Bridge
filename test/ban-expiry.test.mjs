import test from 'node:test';
import assert from 'node:assert/strict';
import { expiredBans } from '../dist/ban-expiry.js';

const NOW = Date.parse('2026-11-06T18:00:00.000Z');

test('only a ban past its expiry is lifted', () => {
  const past = { gameId: 'a', expiresAt: '2026-11-06T17:59:59.000Z' };
  const exact = { gameId: 'b', expiresAt: '2026-11-06T18:00:00.000Z' };
  const future = { gameId: 'c', expiresAt: '2026-11-06T18:00:01.000Z' };
  assert.deepEqual(expiredBans([past, exact, future], NOW), [past, exact]);
});

test('a permanent or unreadable ban stays', () => {
  assert.deepEqual(expiredBans([{ expiresAt: null }, { expiresAt: 'soon' }], NOW), []);
});
