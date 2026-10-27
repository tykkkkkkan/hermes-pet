const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isQuietHours, isFailureStatus, shouldAnnounce,
  normalizeSnapshot, deriveStatus, taskTransitions
} = require('../pet-runtime');

function localTime(hour) {
  const date = new Date(2026, 0, 1, hour, 0, 0, 0);
  return date;
}

test('静默时段为凌晨一点到早上八点', () => {
  assert.equal(isQuietHours(localTime(0)), false);
  assert.equal(isQuietHours(localTime(1)), true);
  assert.equal(isQuietHours(localTime(7)), true);
  assert.equal(isQuietHours(localTime(8)), false);
});

test('静默时段只放行任务结果和用户主动触发的回应', () => {
  assert.equal(shouldAnnounce({ date: localTime(2) }), false);
  assert.equal(shouldAnnounce({ date: localTime(2), taskResult: true }), true);
  assert.equal(shouldAnnounce({ date: localTime(2), userInitiated: true }), true);
  assert.equal(shouldAnnounce({ date: localTime(10) }), true);
});

test('受阻与明确失败状态均识别为失败', () => {
  for (const status of ['blocked', 'failed', 'error']) assert.equal(isFailureStatus(status), true);
  assert.equal(isFailureStatus('done'), false);
});

test('空看板规范化为零计数且桌宠待命', () => {
  const snapshot = normalizeSnapshot({ online: true, tasks: [] });
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.counts.running, 0);
  assert.equal(deriveStatus(snapshot, { now: new Date(2026, 0, 1, 12).getTime() }).status, 'idle');
});

test('Hermes 离线与任务失败分开表达，不误显示失败表情', () => {
  const result = deriveStatus({ online: false }, { now: new Date(2026, 0, 1, 12).getTime() });
  assert.equal(result.status, 'idle');
  assert.equal(result.face, 'idle');
  assert.match(result.statusText, /离线/);
});

test('任务进入完成或失败只产生一次边沿事件', () => {
  const before = { tasks: [{ id: 7, status: 'running' }] };
  const after = { tasks: [{ id: 7, status: 'done' }] };
  assert.equal(taskTransitions(before, after).length, 1);
  assert.equal(taskTransitions(after, after).length, 0);
  assert.equal(taskTransitions({ tasks: [] }, after).length, 0);
});

test('忙碌与错误状态按真实任务数据映射', () => {
  const now = new Date(2026, 0, 1, 12).getTime();
  assert.equal(deriveStatus({ online: true, running: [{}] }, { now }).status, 'working');
  assert.equal(deriveStatus({ online: true, tasks: [{ status: 'failed' }] }, { now }).face, 'cry');
});
