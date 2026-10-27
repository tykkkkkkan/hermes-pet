const fs = require('fs');
const path = require('path');

const HERMES_DIR = path.join(process.env.LOCALAPPDATA || '', 'hermes');
const LEDGER_FILE = path.join(HERMES_DIR, 'spawn-ledger.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function findServe() {
  const ledger = readJson(LEDGER_FILE, []);
  const rows = Array.isArray(ledger) ? ledger : Object.values(ledger || {});
  return rows.find((row) => row && row.purpose === 'serve' && Number(row.port) > 0) || null;
}

function timeoutSignal(ms = 2500) {
  try { return AbortSignal.timeout(ms); } catch { return undefined; }
}

async function connect() {
  const serve = findServe();
  if (!serve) throw new Error('找不到 Hermes 服务实例');
  const base = `http://127.0.0.1:${Number(serve.port)}`;
  const home = await fetch(`${base}/`, { signal: timeoutSignal() });
  if (!home.ok) throw new Error(`Hermes 首页返回 ${home.status}`);
  const html = await home.text();
  const token = html.match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)?.[1];
  if (!token) throw new Error('Hermes 服务没有提供会话令牌');
  return { base, token, serve };
}

async function getJson(connection, endpoint) {
  const response = await fetch(`${connection.base}${endpoint}`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: timeoutSignal()
  });
  if (!response.ok) throw new Error(`${endpoint} 返回 ${response.status}`);
  return response.json();
}

function taskStatus(task, column) {
  return String(task?.status || task?.state || column || '').toLowerCase();
}

function normalizeBoard(board) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  const tasks = [];
  const counts = { triage: 0, todo: 0, scheduled: 0, ready: 0, running: 0, blocked: 0, review: 0, done: 0 };
  for (const column of columns) {
    const name = String(column?.name || '').toLowerCase();
    const rows = Array.isArray(column?.tasks) ? column.tasks : [];
    counts[name] = rows.length;
    for (const task of rows) {
      tasks.push({ ...task, status: taskStatus(task, name), column: name });
    }
  }
  const running = tasks.filter((task) => task.status === 'running');
  const blocked = tasks.filter((task) => task.status === 'blocked');
  const review = tasks.filter((task) => task.status === 'review');
  const currentTask = running[0] || tasks.find((task) => ['ready', 'todo', 'scheduled'].includes(task.status)) || null;
  const agents = (Array.isArray(board?.assignees) ? board.assignees : []).map((name) => {
    const task = running.find((row) => row.assignee === name);
    return { name, status: task ? 'working' : 'idle', taskId: task?.id || null, title: task?.title || '' };
  });
  return {
    tasks,
    counts,
    running,
    blocked,
    review,
    currentTask,
    agents,
    latestEventId: Number(board?.latest_event_id) || 0
  };
}

async function snapshot() {
  const connection = await connect();
  const [status, board] = await Promise.all([
    getJson(connection, '/api/status'),
    getJson(connection, '/api/plugins/kanban/board')
  ]);
  const normalized = normalizeBoard(board);
  return {
    online: true,
    port: Number(connection.serve.port),
    gatewayState: status?.gateway_state || 'unknown',
    activeAgents: Number(status?.active_agents) || normalized.running.length,
    activeSessions: Number(status?.active_sessions) || 0,
    components: status?.components || {},
    ...normalized,
    checkedAt: Date.now()
  };
}

module.exports = { HERMES_DIR, LEDGER_FILE, snapshot, normalizeBoard };
