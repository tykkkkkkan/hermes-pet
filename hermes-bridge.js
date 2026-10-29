const fs = require('fs');
const path = require('path');
const { PetConversation } = require('./hermes-chat');

const conversation = new PetConversation();

const HERMES_DIR = path.join(process.env.LOCALAPPDATA || '', 'hermes');
const LEDGER_FILE = path.join(HERMES_DIR, 'spawn-ledger.json');
const MEMORY_DIR = path.join(HERMES_DIR, 'memories');
const SKILLS_DIR = path.join(HERMES_DIR, 'skills');

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

async function postJson(connection, endpoint, body) {
  const response = await fetch(`${connection.base}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {}),
    signal: timeoutSignal(90000)
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw }; }
  if (!response.ok) throw new Error(`${endpoint} 返回 ${response.status}：${data.detail || raw || '请求失败'}`);
  return data;
}

// 对话不能走 REST：Hermes 只把它开在 WebSocket 的 JSON-RPC 上（prompt.submit）。
// 细节与踩坑见 hermes-chat.js 顶部注释。
async function sessionHistory() {
  try {
    return await conversation.history();
  } catch {
    return { sessionId: '', entries: [] };
  }
}

async function sessionChat(text, onDelta) {
  return conversation.chat(text, onDelta);
}

async function createTask(payload) {
  const connection = await connect();
  return postJson(connection, '/api/plugins/kanban/tasks', {
    title: String(payload?.title || '').trim().slice(0, 240),
    body: String(payload?.body || '').slice(0, 12000),
    assignee: payload?.assignee || null,
    priority: Number.isFinite(Number(payload?.priority)) ? Number(payload.priority) : 0,
    workspace_kind: payload?.workspace_kind || null,
    workspace_path: payload?.workspace_path || null,
    skills: Array.isArray(payload?.skills) ? payload.skills.slice(0, 20) : null,
    triage: !!payload?.triage
  });
}

async function uploadAttachment(taskId, filePath) {
  const connection = await connect();
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('拖入的路径不是文件');
  if (stat.size > 50 * 1024 * 1024) throw new Error('附件超过 Hermes 的 50 MB 限制');
  const form = new FormData();
  const bytes = fs.readFileSync(filePath);
  form.append('file', new Blob([bytes]), path.basename(filePath));
  form.append('uploaded_by', 'hermes-pet');
  const response = await fetch(`${connection.base}/api/plugins/kanban/tasks/${encodeURIComponent(taskId)}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}` },
    body: form,
    signal: timeoutSignal(90000)
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw }; }
  if (!response.ok) throw new Error(`附件上传失败：${data.detail || raw || response.status}`);
  return data;
}

function readText(file, limit = 12000) {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').slice(0, limit); } catch { return ''; }
}

function memorySnapshot() {
  return {
    user: readText(path.join(MEMORY_DIR, 'USER.md')),
    longTerm: readText(path.join(MEMORY_DIR, 'MEMORY.md'))
  };
}

function skillSnapshot() {
  const rows = [];
  try {
    for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (fs.existsSync(file)) rows.push({ name: entry.name, content: readText(file, 5000) });
    }
  } catch {}
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function taskStatus(task, column) {
  return String(task?.status || task?.state || column || '').toLowerCase();
}

function normalizeBoard(board) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  const tasks = [];
  const seenTaskIds = new Set();
  const counts = { triage: 0, todo: 0, scheduled: 0, ready: 0, running: 0, blocked: 0, review: 0, done: 0 };
  for (const column of columns) {
    const name = String(column?.name || '').toLowerCase();
    const rows = Array.isArray(column?.tasks) ? column.tasks : [];
    const uniqueRows = rows.filter((task) => {
      const id = task?.id;
      if (id == null || id === '') return true;
      const key = String(id);
      if (seenTaskIds.has(key)) return false;
      seenTaskIds.add(key);
      return true;
    });
    if (Object.prototype.hasOwnProperty.call(counts, name)) counts[name] += uniqueRows.length;
    for (const task of rows) {
      const id = task?.id;
      if (id != null && id !== '' && !seenTaskIds.has(String(id))) continue;
      if (id != null && id !== '' && tasks.some((row) => String(row.id) === String(id))) continue;
      const providedTitle = [task?.title, task?.name]
        .map((value) => String(value || '').trim())
        .find(Boolean);
      const title = providedTitle || `任务 #${id == null || id === '' ? '?' : id}`;
      tasks.push({ ...task, title, status: taskStatus(task, name), column: name });
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
    gatewayBusy: status?.gateway_busy === true,
    activeAgents: Number(status?.active_agents) || normalized.running.length,
    activeSessions: Number(status?.active_sessions) || 0,
    components: status?.components || {},
    ...normalized,
    checkedAt: Date.now()
  };
}

module.exports = {
  HERMES_DIR, LEDGER_FILE, snapshot, normalizeBoard, sessionHistory, sessionChat,
  createTask, uploadAttachment, memorySnapshot, skillSnapshot
};
