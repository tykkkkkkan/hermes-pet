const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateBehavior } = require('../renderer/behavior');

const base = { affection: 50, energy: 1, idleMs: 0, mouseNear: false, queue: {}, irritability: 0 };

test('行为状态按优先级区分睡眠、受阻、专注和亲近', () => {
  assert.equal(evaluateBehavior({ ...base, energy: 0.1, idleMs: 130000 }), 'sleeping');
  assert.equal(evaluateBehavior({ ...base, irritability: 3, queue: { blocked: 1 } }), 'sulky');
  assert.equal(evaluateBehavior({ ...base, queue: { blocked: 1 } }), 'worried');
  assert.equal(evaluateBehavior({ ...base, queue: { running: 1 } }), 'focused');
  assert.equal(evaluateBehavior({ ...base, mouseNear: true, affection: 80 }), 'clingy');
  assert.equal(evaluateBehavior({ ...base, mouseNear: true, affection: 20 }), 'curious');
});

test('受阻优先于低精力，空闲回落 idle', () => {
  assert.equal(evaluateBehavior({ ...base, energy: 0.2, queue: { blocked: 1 } }), 'worried');
  assert.equal(evaluateBehavior(base), 'idle');
});
