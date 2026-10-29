'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function createLogger({ logDir, maxDays = 7, now = () => new Date() } = {}) {
  let stream = null;
  let currentDay = '';

  function dayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function prune(date) {
    try {
      const cutoff = date.getTime() - maxDays * 86400000;
      for (const name of fs.readdirSync(logDir)) {
        const match = name.match(/^pet-(\d{4})-(\d{2})-(\d{2})\.log$/);
        if (!match) continue;
        if (new Date(`${match[1]}-${match[2]}-${match[3]}`).getTime() < cutoff) {
          fs.unlinkSync(path.join(logDir, name));
        }
      }
    } catch {}
  }

  function open(date) {
    const key = dayKey(date);
    if (key === currentDay && stream) return;
    currentDay = key;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      stream?.end();
      stream = fs.createWriteStream(path.join(logDir, `pet-${key}.log`), { flags: 'a' });
      stream.on('error', () => { stream = null; });
    } catch {
      stream = null;
    }
    prune(date);
  }

  function format(value) {
    if (value instanceof Error) return `${value.message}\n${value.stack || ''}`;
    if (typeof value === 'object' && value !== null) {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
  }

  function write(level, args) {
    const date = now();
    open(date);
    const line = `${date.toISOString()} [${level}] ${args.map(format).join(' ')}\n`;
    try { stream?.write(line); } catch {}
    if (process.env.NODE_ENV !== 'production') {
      try { (level === 'error' ? process.stderr : process.stdout).write(line); } catch {}
    }
  }

  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    dir: logDir
  };
};
