import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNOUNCE_WAIT_MS, CharacterTracker, hardcoreSetting, validInstanceId } from '../dist/characters.js';
import { buildManifest } from '../dist/protocol-v1.js';

const GID = 'steam_76561198000735875';
const FIRST = '6BA7D3724ACEC64E101DA3BF5E363FDA';
const SECOND = '51D4A31D4ECBE28DDC1A80A49F1EFA36';

test('only a Hardcore server declares Characters', () => {
  assert.equal(buildManifest().find((c) => c.name === 'players.characters'), undefined);
  assert.deepEqual(buildManifest(true).find((c) => c.name === 'players.characters'), {
    name: 'players.characters', parameters: { held: 'server', ends: ['death'] },
  });
});

test('bHardcore is read from the REST settings', () => {
  assert.equal(hardcoreSetting({ bHardcore: true }), true);
  assert.equal(hardcoreSetting({ bHardcore: false }), false);
  for (const settings of [{}, null, undefined, { bHardcore: 'True' }]) assert.equal(hardcoreSetting(settings), null);
});

test('a character id is a non-zero save InstanceId', () => {
  assert.equal(validInstanceId(FIRST), true);
  for (const id of ['0'.repeat(32), 'Limon', '', undefined, 5]) assert.equal(validInstanceId(id), false);
});

test('two characters with one name stay apart', () => {
  const t = new CharacterTracker();
  t.note(GID, FIRST, 'Limon');
  assert.deepEqual(t.get(GID), { id: FIRST, name: 'Limon' });
  t.end(GID);
  t.note(GID, SECOND, 'Limon');
  assert.deepEqual(t.get(GID), { id: SECOND, name: 'Limon' });
});

test('a dead character is not reported again while its pawn lingers', () => {
  const t = new CharacterTracker();
  t.note(GID, FIRST, 'Limon');
  t.end(GID);
  t.note(GID, FIRST, 'Limon');
  assert.equal(t.get(GID), undefined);
});

test('leaving forgets the character: the next session may be another one', () => {
  const t = new CharacterTracker();
  t.note(GID, FIRST, 'Limon');
  t.forget(GID);
  assert.equal(t.get(GID), undefined);
  t.note(GID, FIRST, 'Limon');
  assert.equal(t.get(GID).id, FIRST);
});

test('player-connected waits for the id, and only for a limited time once loaded', () => {
  const t = new CharacterTracker();
  assert.equal(t.readyToAnnounce(GID, false, 0), false);
  // A long character creation does not use up the wait.
  assert.equal(t.readyToAnnounce(GID, false, 10 * ANNOUNCE_WAIT_MS), false);
  const loadedAt = 20 * ANNOUNCE_WAIT_MS;
  assert.equal(t.readyToAnnounce(GID, true, loadedAt), false);
  assert.equal(t.readyToAnnounce(GID, true, loadedAt + ANNOUNCE_WAIT_MS - 1), false);
  assert.equal(t.readyToAnnounce(GID, true, loadedAt + ANNOUNCE_WAIT_MS), true);
  const known = new CharacterTracker();
  known.note(GID, FIRST, 'Limon');
  assert.equal(known.readyToAnnounce(GID, false, 0), true);
});
