const fs = require('fs');
const path = require('path');

const MIDTERM_DAYS = 14;
const MAX_DAILY_MESSAGES = 2000;
const MAX_SUMMARY_ITEMS = 8;

function dayKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sessionFile(root, day) {
  return path.join(root, 'sessions', `${day}.jsonl`);
}

function readDay(root, day) {
  try {
    return fs.readFileSync(sessionFile(root, day), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((row) => row && (row.role === 'user' || row.role === 'assistant'));
  } catch {
    return [];
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

function makeExtractiveSummary(entries, day) {
  const userMessages = entries
    .filter((entry) => entry.role === 'user')
    .map((entry) => String(entry.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const unique = [...new Set(userMessages)];
  const selected = unique.slice(-MAX_SUMMARY_ITEMS).map((text) => text.slice(0, 220));
  return {
    day,
    messageCount: entries.length,
    userTopics: selected,
    updatedAt: Date.now(),
    kind: 'extractive'
  };
}

function updateMidterm(root, day) {
  const file = path.join(root, 'midterm.json');
  const stored = (() => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  })();
  const next = stored.filter((row) => row?.day !== day);
  next.push(makeExtractiveSummary(readDay(root, day), day));
  next.sort((a, b) => a.day.localeCompare(b.day));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (MIDTERM_DAYS - 1));
  const cutoffDay = dayKey(cutoff);
  return writeJsonAtomic(file, next.filter((row) => row.day >= cutoffDay));
}

function record(root, sessionId, role, content, at = Date.now()) {
  if (!root || !['user', 'assistant'].includes(role)) return false;
  const text = String(content || '').trim();
  if (!text) return false;
  const day = dayKey(at);
  const file = sessionFile(root, day);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entries = readDay(root, day);
    if (entries.length >= MAX_DAILY_MESSAGES) return false;
    fs.appendFileSync(file, `${JSON.stringify({
      sessionId: String(sessionId || ''),
      role,
      content: text.slice(0, 8000),
      at: Number(at) || Date.now()
    })}\n`, 'utf8');
    updateMidterm(root, day);
    return true;
  } catch {
    return false;
  }
}

function snapshot(root) {
  let midterm = [];
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'midterm.json'), 'utf8'));
    if (Array.isArray(stored)) midterm = stored;
  } catch {}
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (MIDTERM_DAYS - 1));
  const cutoffDay = dayKey(cutoff);
  const recent = midterm.filter((row) => row && row.day >= cutoffDay);
  return {
    recent,
    today: readDay(root, dayKey()),
    midtermDays: MIDTERM_DAYS
  };
}

module.exports = { dayKey, readDay, record, snapshot, makeExtractiveSummary };
