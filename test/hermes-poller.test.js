const test = require('node:test');
const assert = require('node:assert/strict');
const petEmotion = require('../pet-emotion');
const createPetState = require('../pet-state');
const createHermesPoller = require('../hermes-poller');

function makeState() {
  return createPetState({
    emotion: petEmotion,
    settingsStore: {
      stateFile: () => 'hermes-poller-test-state.json',
      readJson: (_file, fallback) => fallback,
      writeJson: () => true
    }
  });
}

function makePoller(bridge, options = {}) {
  const state = makeState();
  return createHermesPoller({
    bridge,
    state,
    taskTitle: (task) => String(task?.title || task?.id || '任务'),
    announce: options.announce || (() => {}),
    pushState: () => {},
    now: () => new Date(2026, 0, 1, 12).getTime(),
    ...options
  });
}

test('running 为空时返回 idle 且 runningCount 为 0', () => {
  const poller = makePoller({ snapshot: async () => ({}) });
  const result = poller.statusFromSnapshot({ online: true, running: [], tasks: [] });
  assert.equal(result.status, 'idle');
  assert.equal(result.runningCount, 0);
  assert.ok(!Number.isNaN(result.runningCount));
});

test('running 到 done 只播报一次边沿', () => {
  const lines = [];
  const poller = makePoller({ snapshot: async () => ({}) }, { announce: (text) => lines.push(text) });
  poller.applySnapshot({ online: true, tasks: [{ id: 1, status: 'running', title: '任务一' }], running: [{ id: 1, status: 'running' }] });
  poller.applySnapshot({ online: true, tasks: [{ id: 1, status: 'done', title: '任务一' }], running: [] });
  poller.applySnapshot({ online: true, tasks: [{ id: 1, status: 'done', title: '任务一' }], running: [] });
  assert.equal(lines.filter((line) => line.includes('完成了')).length, 1);
});

test('blocked、failed、review 分类各自正确', () => {
  const lines = [];
  const poller = makePoller({ snapshot: async () => ({}) }, { announce: (text) => lines.push(text) });
  poller.applySnapshot({ online: true, tasks: [{ id: 1, status: 'running' }] });
  poller.applySnapshot({ online: true, tasks: [{ id: 1, status: 'blocked' }] });
  poller.applySnapshot({ online: true, tasks: [{ id: 1, status: 'review' }] });
  assert.equal(lines.some((line) => line.includes('受阻了')), true);
  assert.equal(lines.some((line) => line.includes('等你验收')), true);
  assert.equal(lines.some((line) => line.includes('失败了')), false);
});

test('连续失败三次后轮询间隔为 15 秒', async () => {
  let calls = 0;
  const poller = makePoller({ snapshot: async () => { calls += 1; throw new Error('offline'); } });
  await poller.poll();
  await poller.poll();
  await poller.poll();
  assert.equal(calls, 3);
  assert.equal(poller.getInterval(), 15000);
});
