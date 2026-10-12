import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTakaroWsUrl, DEFAULT_TAKARO_WS_URL } from '../dist/takaro-url.js';

test('defaults to production Takaro', () => {
  assert.equal(resolveTakaroWsUrl(undefined), DEFAULT_TAKARO_WS_URL);
  assert.equal(resolveTakaroWsUrl(''), DEFAULT_TAKARO_WS_URL);
  assert.equal(resolveTakaroWsUrl('   '), DEFAULT_TAKARO_WS_URL);
});

test('accepts a ws or wss override', () => {
  assert.equal(resolveTakaroWsUrl('wss://connect.example.dev/'), 'wss://connect.example.dev/');
  assert.equal(resolveTakaroWsUrl(' ws://127.0.0.1:3004 '), 'ws://127.0.0.1:3004/');
});

test('ignores values that are not WebSocket URLs', () => {
  assert.equal(resolveTakaroWsUrl('https://connect.example.dev/'), DEFAULT_TAKARO_WS_URL);
  assert.equal(resolveTakaroWsUrl('not a url'), DEFAULT_TAKARO_WS_URL);
});
