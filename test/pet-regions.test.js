const test = require('node:test');
const assert = require('node:assert/strict');
const regions = require('../pet-regions.json');
const { hitRegion } = require('../pet-regions');

test('四个热区按立绘归一化坐标命中', () => {
  assert.equal(hitRegion(0.5, 0.1, regions), 'head');
  assert.equal(hitRegion(0.5, 0.35, regions), 'face');
  assert.equal(hitRegion(0.5, 0.65, regions), 'body');
  assert.equal(hitRegion(0.5, 0.9, regions), 'feet');
});

test('重叠边界按头、脸、身体、脚的固定优先级处理', () => {
  const overlapping = {
    head: { left: 0, top: 0, right: 1, bottom: 0.5 },
    face: { left: 0, top: 0.25, right: 1, bottom: 0.75 },
    body: { left: 0, top: 0.5, right: 1, bottom: 1 },
    feet: { left: 0, top: 0.75, right: 1, bottom: 1 }
  };
  assert.equal(hitRegion(0.5, 0.4, overlapping), 'head');
  assert.equal(hitRegion(0.5, 0.6, overlapping), 'face');
  assert.equal(hitRegion(0.5, 0.8, overlapping), 'body');
});

test('无效坐标和缺失区域不会误报热区', () => {
  assert.equal(hitRegion(-0.1, 0.5, regions), null);
  assert.equal(hitRegion(0.5, 1.1, regions), null);
  assert.equal(hitRegion('nope', 0.5, regions), null);
  assert.equal(hitRegion(0.5, 0.5, {}), null);
});
