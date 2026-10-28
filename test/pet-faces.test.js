const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FACE_FILES,
  EMOTION_FACE,
  STATE_FACE,
  findMissingFaceKeys
} = require('../pet-faces');

test('情绪与状态表情映射都登记了图源', () => {
  assert.deepEqual(findMissingFaceKeys(FACE_FILES), []);
});

test('映射完整性检查能抓到缺失的 smug 图源', () => {
  const incomplete = { ...FACE_FILES };
  delete incomplete.smug;
  assert.deepEqual(findMissingFaceKeys(incomplete), ['smug']);
  assert.equal(EMOTION_FACE['得意'], 'smug');
  assert.equal(STATE_FACE.working, 'thinking');
});
