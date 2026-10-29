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

test('normalizeBoard treats null, empty object and empty columns as empty boards', () => {
  for (const board of [null, {}, { columns: [] }]) {
    const result = normalizeBoard(board);
    assert.equal(result.tasks.length, 0);
    assert.equal(result.running.length, 0);
    assert.equal(Object.values(result.counts).every((count) => count === 0), true);
  }
});

test('normalizeBoard falls back to task id when title and name are missing or blank', () => {
  const result = normalizeBoard({ columns: [{ name: 'todo', tasks: [
    { id: 7 }, { id: 8, title: '' }, { id: 9, name: '   ' }, { id: 10, name: '有名字' }
  ] }] });
  assert.deepEqual(result.tasks.map((task) => task.title), ['任务 #7', '任务 #8', '任务 #9', '有名字']);
});

test('normalizeBoard deduplicates a task id that appears in multiple columns', () => {
  const result = normalizeBoard({ columns: [
    { name: 'running', tasks: [{ id: 'same', title: '先出现' }] },
    { name: 'review', tasks: [{ id: 'same', title: '重复出现' }, { id: 'r2', title: '另一条' }] }
  ] });
  assert.equal(result.tasks.length, 2);
  assert.equal(result.counts.running, 1);
  assert.equal(result.counts.review, 1);
  assert.equal(result.tasks[0].title, '先出现');
});

test('normalizeBoard keeps an assignee idle when it has no running task', () => {
  const result = normalizeBoard({ columns: [{ name: 'review', tasks: [{ id: 'r1', title: '等验收', assignee: 'A' }] }], assignees: ['A'] });
  assert.deepEqual(result.agents, [{ name: 'A', status: 'idle', taskId: null, title: '' }]);
});

test('normalizeBoard returns an empty agent list when assignees is undefined', () => {
  assert.deepEqual(normalizeBoard({ columns: [] }).agents, []);
});
