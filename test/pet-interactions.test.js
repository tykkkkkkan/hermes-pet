const test = require('node:test');
const assert = require('node:assert/strict');
const persona = require('../persona.json');
const { touchPoolKey, createTouchPicker } = require('../pet-interactions');

test('现有人格配置提供五十三条触摸台词', () => {
  const lines = Object.values(persona.touchReactions).flatMap((region) =>
    Object.values(region).flatMap((pool) => Array.isArray(pool) ? pool : [pool])
  );
  assert.equal(lines.length, 53);
  assert.equal(new Set(lines).size, 53);
});

test('触摸心情映射到已有的人格分组', () => {
  assert.equal(touchPoolKey('开心', 20), 'happy');
  assert.equal(touchPoolKey('犯困', 80), 'tired');
  assert.equal(touchPoolKey('闹别扭', 90), 'sulky');
  assert.equal(touchPoolKey('平静', 80), 'happy');
  assert.equal(touchPoolKey('平静', 20), 'sulky');
});

test('同一区域第三次触摸扩展到完整台词池且不连续复读', () => {
  const pick = createTouchPicker(persona, () => 0.999);
  const first = pick('head', '平静', 50);
  const second = pick('head', '平静', 50);
  const third = pick('head', '平静', 50);
  assert.match(first, /摸吧|帽子歪了|轻点/);
  assert.notEqual(second, first);
  assert.match(third, /帽檐检查通过|摸完记得夸一句/);
  assert.notEqual(third, second);
});

test('换区域后连续次数重新计算', () => {
  const pick = createTouchPicker(persona, () => 0.999);
  pick('head', '平静', 50);
  pick('head', '平静', 50);
  const firstBodyTouch = pick('body', '平静', 50);
  assert.match(firstBodyTouch, /检查完毕|有活就派|拍可以/);
});
