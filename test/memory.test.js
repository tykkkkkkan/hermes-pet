const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dayKey, record, snapshot } = require('../memory');

function withMemoryRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pet-memory-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function localDate(day, hour = 12) {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);
}

test('会话按天追加，摘要增量计数并只保留不同用户主题', () => {
  withMemoryRoot((root) => {
    const now = localDate('2026-10-28').getTime();
    assert.equal(record(root, 's1', 'user', '准备面试', now), true);
    assert.equal(record(root, 's1', 'assistant', '先整理项目经历', now + 1000), true);
    assert.equal(record(root, 's1', 'user', '准备面试', now + 2000), true);

    const day = dayKey(now);
    const session = fs.readFileSync(path.join(root, 'sessions', `${day}.jsonl`), 'utf8')
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const archive = JSON.parse(fs.readFileSync(path.join(root, 'midterm.json'), 'utf8'));
    assert.equal(session.length, 3);
    assert.equal(archive.find((row) => row.day === day).messageCount, 3);
    assert.deepEqual(archive.find((row) => row.day === day).userTopics, ['准备面试']);
  });
});

test('中期摘要按快照日期裁剪，Hermes 长期记忆不在本地另建副本', () => {
  withMemoryRoot((root) => {
    const now = localDate('2026-10-28').getTime();
    record(root, 's1', 'user', '旧事项', localDate('2026-10-01').getTime());
    record(root, 's1', 'user', '近期事项', now);
    const view = snapshot(root, now);
    assert.deepEqual(view.recent.map((row) => row.day), ['2026-10-28']);
    assert.equal(fs.existsSync(path.join(root, 'USER.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'MEMORY.md')), false);
  });
});

test('忽略空文本与非对话角色，不污染会话日志', () => {
  withMemoryRoot((root) => {
    assert.equal(record(root, 's1', 'system', '内部提示'), false);
    assert.equal(record(root, 's1', 'user', '   '), false);
    assert.deepEqual(snapshot(root).today, []);
  });
});
