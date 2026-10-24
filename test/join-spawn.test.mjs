import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnloadedPlayerId, JOIN_SETTLE_MS, JoinLoadTracker } from '../dist/join-spawn.js';

const GID = 'steam_76561198000735875';
const LOADED = '5D94A52B000000000000000000000000';
// REST rows from a live rejoin: parked at the start while the save loads, then the World Tree.
const PARKED = { name: 'Limon', playerId: 'None', userId: GID, location_x: -362179.4375, location_y: 270846.46875, level: 1 };
const LOADED_AT_PARKING = { ...PARKED, playerId: LOADED };
const LOADED_ROW = { ...PARKED, playerId: LOADED, location_x: 528200.5, location_y: -634436.5, level: 2 };

test('REST playerId tells whether a joining player has loaded', () => {
  assert.equal(isUnloadedPlayerId('None'), true);
  assert.equal(isUnloadedPlayerId('none'), true);
  assert.equal(isUnloadedPlayerId(''), true);
  assert.equal(isUnloadedPlayerId(undefined), true);
  assert.equal(isUnloadedPlayerId(null), true);
  assert.equal(isUnloadedPlayerId('00000000000000000000000000000000'), true);
  assert.equal(isUnloadedPlayerId(LOADED), false);
});

test('no position while loading in, nor for a settle window after the save loads', () => {
  const t = new JoinLoadTracker();
  const t0 = 1_000_000;
  t.observe(GID, 'None', t0);
  assert.equal(t.hasLoadedPosition(GID, 'None', t0), false);
  // REST already shows the real id while the pawn can still be the temporary one.
  t.observe(GID, LOADED, t0 + 1000);
  assert.equal(t.hasLoadedPosition(GID, LOADED, t0 + 1000), false);
  assert.equal(t.hasLoadedPosition(GID, LOADED, t0 + JOIN_SETTLE_MS - 1), false);
  assert.equal(t.hasLoadedPosition(GID, LOADED, t0 + JOIN_SETTLE_MS), true);
  // A rejoin starts the wait again.
  t.observe(GID, 'None', t0 + 60_000);
  assert.equal(t.hasLoadedPosition(GID, LOADED, t0 + 61_000), false);
});

test('a player never seen loading in has a position; an unknown load state has none', () => {
  const t = new JoinLoadTracker();
  assert.equal(t.hasLoadedPosition(GID, LOADED), true);
  // No REST row: offline, or the REST read failed.
  assert.equal(t.hasLoadedPosition(GID, undefined), false);
  // Another player's join does not hold this one back.
  t.observe('steam_1', 'None');
  assert.equal(t.hasLoadedPosition(GID, LOADED), true);
});

test('getPlayers leaves the position out while the player loads in', () => {
  const t = new JoinLoadTracker();
  const t0 = 1_000_000;
  t.observe(GID, PARKED.playerId, t0);
  assert.deepEqual(t.restPosition(PARKED, t0), {});
  assert.deepEqual(t.restPosition(LOADED_AT_PARKING, t0 + 1000), {});
  assert.deepEqual(t.restPosition(LOADED_ROW, t0 + JOIN_SETTLE_MS), { positionX: 528200.5, positionY: -634436.5, positionZ: undefined });
  // The parking point is also a real place (Hill of Beginnings): once settled it is reported.
  assert.deepEqual(t.restPosition(LOADED_AT_PARKING, t0 + JOIN_SETTLE_MS), { positionX: -362179.4375, positionY: 270846.46875, positionZ: undefined });
  assert.deepEqual(t.restPosition({ userId: GID, playerId: LOADED }, t0 + JOIN_SETTLE_MS), {});
});
