const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBoard } = require('../hermes-bridge');

test('normalizeBoard normalizes task status, counts and current task', () => {
  const result = normalizeBoard({
    latest_event_id: '17',
    columns: [
      { name: 'running', tasks: [{ id: 'r1', title: '正在做', assignee: 'A' }] },
      { name: 'todo', tasks: [{ id: 't1', title: '排队中', state: 'ready', assignee: 'B' }] },
      { name: 'blocked', tasks: [{ id: 'b1', title: '卡住了' }] }
    ],
    assignees: ['A', 'B', 'C']
  });

  assert.equal(result.latestEventId, 17);
  assert.deepEqual(result.counts, {
    triage: 0, todo: 1, scheduled: 0, ready: 0, running: 1, blocked: 1, review: 0, done: 0
  });
  assert.equal(result.tasks.length, 3);
  assert.equal(result.tasks[0].status, 'running');
  assert.equal(result.tasks[1].status, 'ready');
  assert.equal(result.tasks[2].status, 'blocked');
  assert.equal(result.currentTask.id, 'r1');
  assert.deepEqual(result.agents, [
    { name: 'A', status: 'working', taskId: 'r1', title: '正在做' },
    { name: 'B', status: 'idle', taskId: null, title: '' },
    { name: 'C', status: 'idle', taskId: null, title: '' }
  ]);
});

test('normalizeBoard tolerates missing board collections', () => {
  assert.deepEqual(normalizeBoard(null), {
    tasks: [],
    counts: { triage: 0, todo: 0, scheduled: 0, ready: 0, running: 0, blocked: 0, review: 0, done: 0 },
    running: [],
    blocked: [],
    review: [],
    currentTask: null,
    agents: [],
    latestEventId: 0
  });
});
