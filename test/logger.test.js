const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createLogger = require('../logger');

test('日志按天落盘并清理过期文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pet-logs-'));
  fs.writeFileSync(path.join(dir, 'pet-2020-01-01.log'), 'old\n');
  const logger = createLogger({ logDir: dir, now: () => new Date('2026-10-29T12:00:00Z'), maxDays: 7 });
  logger.info('bridge listening', { port: 1234 });
  logger.error(new Error('boom'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const file = path.join(dir, 'pet-2026-10-29.log');
  assert.equal(fs.existsSync(file), true);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\[info\] bridge listening \{"port":1234\}/);
  assert.match(text, /\[error\] boom/);
  assert.equal(fs.existsSync(path.join(dir, 'pet-2020-01-01.log')), false);
});
