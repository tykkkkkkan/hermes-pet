const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const petEmotion = require('../pet-emotion');
const createPetState = require('../pet-state');

function makeStore(stateText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pet-state-'));
  const stateFile = path.join(dir, 'state.json');
  if (stateText !== undefined) fs.writeFileSync(stateFile, stateText, 'utf8');
  const settingsStore = {
    stateFile: () => stateFile,
    readJson: (file, fallback) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
    },
    writeJson: (file, value) => { fs.writeFileSync(file, JSON.stringify(value), 'utf8'); return true; }
  };
  return createPetState({ emotion: petEmotion, settingsStore });
}

test('affection 和 mood 始终夹在 0 到 100', () => {
  const state = makeStore();
  state.set({ affection: 999, mood: -10 });
  assert.deepEqual([state.get().affection, state.get().mood], [100, 0]);
});

test('success 事件提升心情和好感且不超过上限', () => {
  const state = makeStore();
  state.set({ affection: 99, mood: 99 });
  state.applyEmotion('success');
  state.set({ affection: Math.min(100, state.get().affection + 2), mood: Math.min(100, state.get().mood + 2) });
  assert.ok(state.get().mood <= 100);
  assert.ok(state.get().affection <= 100);
  assert.equal(state.get().emotionScores['得意'], 2);
});

test('跨一小时会衰减，未满一小时不衰减', () => {
  const state = makeStore();
  const start = 1000000000000;
  state.set({ lastEmotionDecay: start, emotionScores: { 得意: 4, 开心: 2 } });
  state.decay(start + 3599999);
  assert.equal(state.get().emotionScores['得意'], 4);
  state.decay(start + 2 * 3600000);
  assert.equal(state.get().emotionScores['得意'], 2);
  assert.equal(state.get().emotionScores['开心'], 0);
});

test('running 六条只展示三条但保留总数', () => {
  const state = makeStore();
  const panel = state.buildTaskPanel({
    running: Array.from({ length: 6 }, (_, id) => ({ id, title: `任务 ${id}`, status: 'running' })),
    tasks: []
  });
  assert.equal(panel.running.items.length, 3);
  assert.equal(panel.running.total, 6);
});

test('坏 state JSON 回落默认状态', () => {
  const state = makeStore('{bad json');
  state.load();
  assert.equal(state.get().status, 'idle');
  assert.equal(state.get().affection, 50);
  assert.equal(state.get().mood, 72);
});
