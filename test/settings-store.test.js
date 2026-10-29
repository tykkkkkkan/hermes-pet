const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createSettingsStore = require('../settings-store');

const defaults = {
  userName: '好大爹', petName: '赫尔墨兹', persona: 'persona',
  apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
  petScale: 100, petOpacity: 100, lineFrequency: 'normal',
  voiceEnabled: true, voiceName: '', voiceRate: 100, voiceVolume: 85,
  dndEnabled: false, dndStart: '23:30', dndEnd: '08:00', dndAllowApproval: true
};

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pet-settings-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`cipher:${value}`),
    decryptString: (value) => String(value).replace(/^cipher:/, '')
  };
  const store = createSettingsStore({
    dataDir: () => root,
    hermesDir: path.join(root, 'hermes'),
    safeStorage,
    defaults
  });
  return { root, store };
}

test('文件不存在时 load 返回默认值', () => {
  const { store } = makeStore();
  assert.deepEqual(store.load(), defaults);
});

test('坏 JSON 时 load 返回默认值', () => {
  const { store } = makeStore();
  fs.mkdirSync(path.dirname(store.settingsFile()), { recursive: true });
  fs.writeFileSync(store.settingsFile(), '{bad', 'utf8');
  assert.deepEqual(store.load(), defaults);
});

test('save 会把 petScale 夹在 70 到 140', () => {
  const { store } = makeStore();
  assert.equal(store.save({ petScale: 999 }).petScale, 140);
  assert.equal(store.save({ petScale: 1 }).petScale, 70);
});

test('没有存储 key 时 getApiKey 返回空字符串', () => {
  const { store } = makeStore();
  assert.equal(store.getApiKey(), '');
});

test('明文 key 落盘后能在假 safeStorage 下解密', () => {
  const { store } = makeStore();
  store.save({ apiKey: 'test-secret-key' });
  assert.equal(store.getApiKey(), 'test-secret-key');
});
