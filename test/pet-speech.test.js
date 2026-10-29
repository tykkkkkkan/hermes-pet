const test = require('node:test');
const assert = require('node:assert/strict');
const createPetSpeech = require('../pet-speech');

const speech = createPetSpeech();
const pool = [
  { word: '好大爹', weight: 30 },
  { word: '老板', weight: 15 }
];

test('prepareUtterance 替换 address 占位符', () => {
  assert.equal(speech.prepareUtterance('{address}，早上好', { address: '老板' }), '老板，早上好');
});

test('已有称呼时不会重复添加', () => {
  assert.equal(speech.prepareUtterance('老板，任务完成了', {
    address: '老板',
    pool,
    chooseAddress: () => '老板'
  }), '老板，任务完成了');
});

test('keepAddress 为 true 时不轮换称呼', () => {
  let called = false;
  const text = speech.prepareUtterance('任务完成了', {
    address: '老板',
    pool,
    keepAddress: true,
    chooseAddress: () => { called = true; return '好大爹'; }
  });
  assert.equal(text, '任务完成了');
  assert.equal(called, false);
});

test('称呼池为空时回落好大爹', () => {
  assert.equal(speech.prepareUtterance('{address}，收到', { pool: [] }), '好大爹，收到');
});
