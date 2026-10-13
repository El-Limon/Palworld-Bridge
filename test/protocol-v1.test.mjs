import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManifest, dimensionForPosition, EventStream, identifyError, negotiatedVersion,
  resolveProtocolSetting, v1ErrorFor, MAIN_DIMENSION_ID, TREE_DIMENSION_ID,
} from '../dist/protocol-v1.js';

const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9-]*)*$/;

test('the manifest declares real actions, emitted events and the map, with valid names', () => {
  const manifest = buildManifest();
  const names = manifest.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, NAME);
  for (const want of ['players.location', 'players.inventory', 'chat.send', 'events.chat-message', 'map']) assert.ok(names.includes(want), want);
  // Empty placeholders are never declared.
  assert.ok(!names.includes('entities.list'));
  assert.ok(!names.includes('locations.list'));
});

test('the map declares Palpagos first and the World Tree, from DT_WorldMapUIData', () => {
  const map = buildManifest().find((c) => c.name === 'map');
  const [main, tree] = map.parameters.dimensions;
  assert.equal(main.id, MAIN_DIMENSION_ID);
  assert.equal(tree.id, TREE_DIMENSION_ID);
  for (const d of [main, tree]) {
    assert.match(d.id, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
    assert.deepEqual(d.axes, { horizontal: { field: 'y', direction: 'right' }, vertical: { field: 'x', direction: 'up' } });
    assert.deepEqual(d.source, { type: 'none' });
    assert.ok(d.bounds.horizontal.min < d.bounds.horizontal.max && d.bounds.vertical.min < d.bounds.vertical.max);
  }
  assert.deepEqual(main.bounds, { horizontal: { min: -724400, max: 724400 }, vertical: { min: -1099400, max: 349400 } });
  assert.deepEqual(tree.bounds, { horizontal: { min: -818197, max: -476400 }, vertical: { min: 347351.5, max: 689148.5 } });
});

test('positions pick the map they are on', () => {
  // Start plateau, inland lake and the respawn coast from the staging run.
  assert.equal(dimensionForPosition(-350089, 261113), MAIN_DIMENSION_ID);
  assert.equal(dimensionForPosition(-451213, 112830), MAIN_DIMENSION_ID);
  // Inside the World Tree rectangle, north of the main map.
  assert.equal(dimensionForPosition(500000, -600000), TREE_DIMENSION_ID);
  // The 20 m overlap strip still counts as the main map.
  assert.equal(dimensionForPosition(348000, -600000), MAIN_DIMENSION_ID);
  // North of the main map but east of the Tree rectangle: main (nothing else declared).
  assert.equal(dimensionForPosition(500000, 0), MAIN_DIMENSION_ID);
});

test('protocol setting, negotiation and identify errors', () => {
  assert.equal(resolveProtocolSetting(undefined), 1);
  assert.equal(resolveProtocolSetting(' 0 '), 0);
  assert.equal(resolveProtocolSetting('1'), 1);
  assert.equal(negotiatedVersion({ payload: { gameServerId: 'gs', protocolVersion: 1 } }), 1);
  assert.equal(negotiatedVersion({ payload: { gameServerId: 'gs' } }), 0, 'old Takaro sends no version');
  assert.equal(identifyError({ payload: { gameServerId: 'gs', protocolVersion: 1 } }), null);
  assert.deepEqual(identifyError({ payload: null, error: { code: 'invalid_args', message: 'x' } }), { code: 'invalid_args', message: 'x' });
  assert.deepEqual(identifyError({ payload: { error: { message: 'v0' } } }), { message: 'v0' });
});

test('v1 errors: failures get a code, successes and command output stay payloads', () => {
  assert.deepEqual(v1ErrorFor('nope', { error: 'Unknown action: nope' }, false), { code: 'unsupported', message: 'Unknown action: nope' });
  assert.deepEqual(v1ErrorFor('giveItem', { success: false, error: 'Player not found' }, true), { code: 'game_error', message: 'Player not found' });
  assert.deepEqual(v1ErrorFor('sendMessage', { success: false, rawResult: 'Error: down' }, true), { code: 'game_error', message: 'Error: down' });
  assert.equal(v1ErrorFor('executeConsoleCommand', { success: false, rawResult: 'Usage: kick <player_name>' }, true), null);
  assert.equal(v1ErrorFor('kickPlayer', { success: true }, true), null);
  assert.equal(v1ErrorFor('getPlayerLocation', null, true), null);
  assert.equal(v1ErrorFor('getPlayers', [], true), null);
  assert.equal(v1ErrorFor('testReachability', { connectable: false, reason: 'Palworld server not running' }, true), null);
});

test('event stream: seq from 1, cumulative ack, resend set, drop oldest on overflow', () => {
  const stream = new EventStream(3, 'stream-1');
  const frames = ['a', 'b', 'c'].map((msg) => stream.frame(stream.push('chat-message', { msg })));
  assert.deepEqual(frames.map((f) => f.payload.seq), [1, 2, 3]);
  assert.ok(frames.every((f) => f.payload.streamId === 'stream-1' && f.type === 'gameEvent'));
  assert.equal(stream.ack('other-stream', 3), 0);
  assert.equal(stream.ack('stream-1', 2), 2);
  assert.deepEqual(stream.pending().map((e) => e.seq), [3]);
  for (const msg of ['d', 'e', 'f']) stream.push('chat-message', { msg });
  assert.deepEqual(stream.pending().map((e) => e.seq), [4, 5, 6], 'oldest dropped at capacity');
  assert.match(new EventStream().streamId, /^[A-Za-z0-9_-]{1,128}$/);
});
