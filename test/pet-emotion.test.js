const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEvent, decay, chooseAddress } = require('../pet-emotion');

const pool = [
  { word: '好大爹', weight: 30 },
  { word: '板板', weight: 25 },
  { word: '老板', weight: 15 },
  { word: '小朋友', weight: 7 }
];

test('事件按人设配置积累对应情绪分数', () => {
  const success = applyEvent({ emotionScores: {} }, 'success', () => 0);
  assert.equal(success.emotionScores['得意'], 2);
  assert.equal(success.emotion, '得意');

  const touched = applyEvent(success, 'touched', () => 0);
  assert.equal(touched.emotionScores['开心'], 1);
  assert.equal(touched.emotion, '得意');
});

test('时间衰减逐小时回落，未满一小时不衰减', () => {
  const start = 1000000000000;
  const state = { lastEmotionDecay: start, emotionScores: { 得意: 4, 开心: 2 } };
  assert.equal(decay(state, start + 3599999).emotionScores['得意'], 4);
  const after = decay(state, start + 2 * 3600000, () => 0);
  assert.equal(after.emotionScores['得意'], 2);
  assert.equal(after.emotionScores['开心'], 0);
  assert.equal(after.lastEmotionDecay, start + 2 * 3600000);
});

test('称呼按切换概率与情绪偏好选择，并避开连续重复', () => {
  assert.equal(chooseAddress('得意', '好大爹', pool, [], () => 0), '老板');
  assert.equal(chooseAddress('得意', '老板', pool, ['老板', '老板'], () => 0), '好大爹');
});

test('未知事件不破坏已有情绪状态', () => {
  const state = { emotion: '开心', emotionScores: { 开心: 3 } };
  assert.deepEqual(applyEvent(state, 'unknown'), { ...state, emotionScores: { 开心: 3, 平静: 0, 得意: 0, 犯困: 0, '有点烦': 0, 闹别扭: 0, 委屈: 0, 兴奋: 0 } });
});
