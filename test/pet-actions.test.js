const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, TOUCH_GROUP, chooseAction } = require('../pet-actions');

test('动作表包含十二个热区动作和三个陪伴动作', () => {
  assert.equal(ACTIONS.length, 15);
  assert.equal(new Set(ACTIONS.map((action) => action.id)).size, 15);
  assert.deepEqual([...new Set(ACTIONS.map((action) => action.group))], [
    'head', 'face', 'body', 'feet', 'idle', 'playful', 'magic'
  ]);
  for (const group of ['head', 'face', 'body', 'feet']) {
    assert.equal(ACTIONS.filter((action) => action.group === group).length, 3);
  }
  for (const group of ['idle', 'playful', 'magic']) {
    assert.equal(ACTIONS.filter((action) => action.group === group).length, 1);
  }
  for (const action of ACTIONS) assert.ok(action.duration > 0 && action.animation);
});

test('点击分区映射到对应动作组，重复抽取会避开上一个动作', () => {
  assert.deepEqual(TOUCH_GROUP, { head: 'head', face: 'face', body: 'body', feet: 'feet' });
  const first = chooseAction('head', '', () => 0);
  const next = chooseAction('head', first.id, () => 0);
  assert.notEqual(first.id, next.id);
  assert.equal(chooseAction('missing'), null);
});

test('待机全动作池可以抽到非陪伴动作且仍避开上一次', () => {
  const first = chooseAction('all', '', () => 0);
  const next = chooseAction('all', first.id, () => 0);
  assert.equal(first.id, 'hat-check');
  assert.notEqual(next.id, first.id);
  assert.equal(ACTIONS.some((action) => action.group === 'feet'), true);
});
