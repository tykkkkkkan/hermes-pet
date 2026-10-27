const test = require('node:test');
const assert = require('node:assert/strict');
const { isQuietHours, isFailureStatus, shouldAnnounce } = require('../pet-runtime');

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
