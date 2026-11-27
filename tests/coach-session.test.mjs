import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import test from 'node:test';
import { openCoachSession } from '../coach-session.ts';

function fixture() {
  const peers = [], messages = [], status = [], closes = [];
  const live = { connect: async (options) => {
    const peer = { ...options, input: [], closed: false, sendRealtimeInput(m) { this.input.push(m); }, close() { this.closed = true; } };
    peers.push(peer);
    return peer;
  } };
  const call = openCoachSession(live, {
    model: 'test', config: {}, onmessage: m => messages.push(m),
    onstatus: p => status.push(p), onclose: (code, reason) => closes.push([code, reason]),
  });
  return { peers, messages, status, closes, call };
}

test('a planned rotation keeps the checkpoint and does not greet twice', async () => {
  const { peers, messages, status, closes, call } = fixture();
  await tick();
  const first = peers[0];
  first.callbacks.onmessage({ setupComplete: {} });
  first.callbacks.onmessage({ goAway: {} });
  first.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'checkpoint' } });
  await tick();
  assert.equal(first.closed, true);
  const second = peers[1];
  assert.equal(second.config.sessionResumption.handle, 'checkpoint');
  first.callbacks.onclose({ code: 1006, reason: '' });
  call.sendRealtimeInput({ text: 'during reconnect' });
  assert.deepEqual(second.input, []);
  second.callbacks.onmessage({ setupComplete: {} });
  call.sendRealtimeInput({ text: 'next turn' });
  assert.equal(second.input.length, 1);
  assert.equal(messages.filter(m => m.setupComplete).length, 1);
  assert.deepEqual(status, ['reconnecting', 'resumed']);
  assert.deepEqual(closes, []);
  call.close();
  second.callbacks.onclose({ code: 1000, reason: '' });
  assert.equal(peers.length, 2);
});

test('unexpected loss resumes once and a rejected checkpoint ends the call', async () => {
  const { peers, closes } = fixture();
  await tick();
  peers[0].callbacks.onmessage({ setupComplete: {} });
  peers[0].callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'abc' } });
  peers[0].callbacks.onclose({ code: 1011, reason: '' });
  await tick();
  peers[1].callbacks.onclose({ code: 1008, reason: 'invalid handle' });
  assert.equal(peers.length, 2);
  assert.deepEqual(closes, [[1008, 'invalid handle']]);
});

test('invalidated checkpoints and completed exercises never reconnect', async () => {
  for (const message of [{ sessionResumptionUpdate: { resumable: false } }, { toolCall: { functionCalls: [{ name: 'end_call' }] } }]) {
    const { peers, closes } = fixture();
    await tick();
    const cb = peers[0].callbacks;
    cb.onmessage({ setupComplete: {} });
    cb.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'stale' } });
    cb.onmessage(message);
    cb.onclose({ code: 1000, reason: '' });
    assert.equal(peers.length, 1);
    assert.equal(closes.length, 1);
  }
});

test('a late setup or connect after the caller hangs up is closed', async () => {
  let resolve, callbacks, closed = 0, ready = 0;
  const live = { connect: opts => { callbacks = opts.callbacks; return new Promise(r => { resolve = r; }); } };
  const call = openCoachSession(live, { model: 'test', config: {}, onmessage: () => ready++, onstatus() {}, onclose() {} });
  await tick();
  callbacks.onmessage({ setupComplete: {} });
  assert.equal(ready, 0);
  call.close();
  resolve({ close() { closed++; } });
  await tick();
  assert.equal(closed, 1);
  assert.equal(ready, 0);
});
