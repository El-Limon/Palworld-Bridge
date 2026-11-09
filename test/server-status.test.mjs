import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_FAILURES_FOR_DOWN, ServerProbeFilter } from '../dist/server-status.js';

test('a server never seen up stays down', () => {
  const f = new ServerProbeFilter();
  assert.equal(f.note(false), false);
});

test('one or two slow probes do not take a running server down', () => {
  const f = new ServerProbeFilter();
  assert.equal(f.note(true), true);
  assert.equal(f.note(false), true);
  assert.equal(f.note(false), true);
  assert.equal(f.note(true), true);
  assert.equal(f.note(false), true);
});

test('failures in a row mean down, and one good probe means up', () => {
  const f = new ServerProbeFilter();
  f.note(true);
  for (let i = 1; i < PROBE_FAILURES_FOR_DOWN; i++) assert.equal(f.note(false), true);
  assert.equal(f.note(false), false);
  assert.equal(f.note(true), true);
});
