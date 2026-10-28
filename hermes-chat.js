'use strict';

/**
 * Hermes 桌宠对话通道。
 *
 * Hermes 桌面端（serve / dashboard）把「发消息」放在 WebSocket 的 JSON-RPC 上，
 * 没有 REST 端点：POST /api/sessions/<id>/chat 会直接 405。所以这里维持一条常驻
 * socket，用 session.resume / session.create 拿到 live 会话，再用 prompt.submit
 * 提交，靠 message.delta / message.complete 收回答。
 *
 * 常驻还有另一个原因：socket 一断，宿主的回收器（ws_orphan）会把会话收回，
 * 下一次又要重新 resume，桌宠这边就会被当成新会话。
 */

const fs = require('fs');
const path = require('path');

const HERMES_DIR = path.join(process.env.LOCALAPPDATA || '', 'hermes');
const LEDGER_FILE = path.join(HERMES_DIR, 'spawn-ledger.json');
const SESSION_FILE = process.env.PET_SESSION_FILE || path.join(HERMES_DIR, 'hermes-pet-chat.json');
const CHAT_TITLE = 'Hermes 桌宠';

const OPEN_TIMEOUT = 8000;
const CALL_TIMEOUT = 25000;
const TURN_TIMEOUT = 240000;
const HEARTBEAT_EVERY = 45000;
const HEARTBEAT_TIMEOUT = 12000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    /* 存不下来不影响本次会话，只是下次会新建 */
  }
}

function timing(ms) {
  try { return AbortSignal.timeout(ms); } catch { return undefined; }
}

function servePort() {
  const ledger = readJson(LEDGER_FILE, []);
  const rows = Array.isArray(ledger) ? ledger : Object.values(ledger || {});
  const serve = rows.find((row) => row && row.purpose === 'serve' && Number(row.port) > 0);
  if (!serve) throw new Error('没找到 Hermes 服务，先把 Hermes 打开');
  return Number(serve.port);
}

async function mintToken(base) {
  const response = await fetch(`${base}/`, { signal: timing(4000) });
  if (!response.ok) throw new Error(`Hermes 首页返回 ${response.status}`);
  const html = await response.text();
  const token = html.match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)?.[1];
  if (!token) throw new Error('Hermes 没有给出会话令牌');
  return token;
}

class PetConversation {
  constructor() {
    this.ws = null;
    this.connecting = null;
    this.seq = 0;
    this.calls = new Map();
    this.runtimeId = null;   // socket 周期内的会话 id，断开即失效
    this.storedId = null;    // 落盘的会话 id，跨进程可 resume
    this.turn = null;
    this.heartbeat = null;
    this.lastFrameAt = 0;
    const saved = readJson(SESSION_FILE, {});
    if (saved && typeof saved.sessionId === 'string') this.storedId = saved.sessionId;
  }

  /* ---------- 连接 ---------- */

  async _socket() {
    if (this.ws && this.ws.readyState === 1) return this.ws;
    if (this.connecting) return this.connecting;
    this.connecting = this._open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async _open() {
    const port = servePort();
    const base = `http://127.0.0.1:${port}`;
    const token = await mintToken(base);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error('连 Hermes 超时，它可能正在忙'));
      }, OPEN_TIMEOUT);
      const onOpen = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('连不上 Hermes 服务，确认它还在运行')); };
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
    });

    this.ws = ws;
    this.runtimeId = null;
    this.lastFrameAt = Date.now();
    this._onDelta = null;

    ws.addEventListener('message', (event) => this._onFrame(String(event.data)));
    ws.addEventListener('close', () => this._onClose(ws));
    ws.addEventListener('error', () => { /* close 会跟着来 */ });

    this._startHeartbeat();
    return ws;
  }

  _onClose(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.runtimeId = null;
    this._stopHeartbeat();
    for (const [, call] of this.calls) {
      clearTimeout(call.timer);
      call.reject(new Error('Hermes 连接断开了'));
    }
    this.calls.clear();
    if (this.turn) {
      const turn = this.turn;
      this.turn = null;
      clearTimeout(turn.timer);
      turn.reject(new Error('Hermes 连接断开了，回复没拿到'));
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (Date.now() - this.lastFrameAt > HEARTBEAT_TIMEOUT + HEARTBEAT_EVERY) {
        try { this.ws.close(); } catch { /* ignore */ }
        return;
      }
      try {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id: `hb-${++this.seq}`, method: 'gateway.ping' }));
      } catch { /* close 会兜住 */ }
    }, HEARTBEAT_EVERY);
    if (this.heartbeat.unref) this.heartbeat.unref();
  }

  _stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /* ---------- 收发 ---------- */

  _call(method, params, timeoutMs = CALL_TIMEOUT) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('Hermes 连接没就绪'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  _onFrame(raw) {
    this.lastFrameAt = Date.now();
    let frame;
    try { frame = JSON.parse(raw); } catch { return; }

    if (frame.id != null && this.calls.has(frame.id)) {
      const call = this.calls.get(frame.id);
      this.calls.delete(frame.id);
      clearTimeout(call.timer);
      if (frame.error) call.reject(new Error(frame.error.message || 'Hermes 拒绝了这次请求'));
      else call.resolve(frame.result || {});
      return;
    }

    if (frame.method !== 'event' || !frame.params) return;
    const { type, session_id: sid, payload } = frame.params;

    if (type === 'message.delta' && this.turn && sid === this.turn.sessionId) {
      const text = String(payload?.text || '');
      if (text) {
        this.turn.buffer += text;
        this._awaitQuiet(this.turn, 4000);
        if (this._onDelta) this._onDelta(text);
      }
      return;
    }

    if (type === 'message.complete' && this.turn && sid === this.turn.sessionId) {
      const text = String(payload?.text || '').trim();
      if (text) this.turn.final = text;
      // 一条消息说完不代表整个回合结束（还有工具调用与后续消息），
      // 用一段静默窗口收尾，比猜某个固定事件稳。
      this._awaitQuiet(this.turn, 900);
      return;
    }

    if (type === 'status.update' && this.turn && sid === this.turn.sessionId) {
      const kind = String(payload?.kind || '');
      if (kind === 'error') {
        this.turn.error = String(payload?.text || 'Hermes 报错了');
        this._awaitQuiet(this.turn, 300);
      }
      return;
    }

    if (type === 'session.reclaimed' && payload?.session_id && payload.session_id === this.runtimeId) {
      // 宿主把会话收走了（通常是自己的 socket 断过），下次要重新 resume
      this.runtimeId = null;
      return;
    }

    if (type === 'session.title' && payload?.title && payload?.session_id === this.storedId) {
      writeJson(SESSION_FILE, { sessionId: this.storedId, title: payload.title });
    }
  }

  /* ---------- 会话 ---------- */

  async ensureSession() {
    await this._socket();
    if (this.runtimeId) return this.runtimeId;

    if (this.storedId) {
      try {
        const resumed = await this._call('session.resume', {
          session_id: this.storedId,
          defer_history: true
        });
        this.runtimeId = resumed.session_id || this.storedId;
        return this.runtimeId;
      } catch {
        // 会话被删或换库了，往下走新建
        this.storedId = null;
      }
    }

    const created = await this._call('session.create', { title: CHAT_TITLE });
    this.runtimeId = created.session_id;
    this.storedId = created.stored_session_id || created.session_id;
    writeJson(SESSION_FILE, { sessionId: this.storedId, title: CHAT_TITLE, createdAt: Date.now() });
    return this.runtimeId;
  }

  /**
   * 发一条消息，等 Hermes 说完再返回。
   * @param {string} text
   * @param {(delta: string) => void} [onDelta] 流式增量，用于打字机
   */
  async chat(text, onDelta) {
    const message = String(text || '').trim().slice(0, 4000);
    if (!message) throw new Error('消息不能为空');

    const sessionId = await this.ensureSession();
    if (this.turn) throw new Error('上一句还没说完');

    const turn = { sessionId, buffer: '', final: '', error: '', timer: null, quiet: null, resolve: null, reject: null };
    const done = new Promise((resolve, reject) => {
      turn.resolve = resolve;
      turn.reject = reject;
      turn.timer = setTimeout(() => this._finishTurn(turn, 'timeout'), TURN_TIMEOUT);
    });

    this.turn = turn;
    this._onDelta = typeof onDelta === 'function' ? onDelta : null;

    // prompt.submit 只回 {status:"streaming"}，正文全靠事件流；
    // 连接层失败就当场收尾，别让界面一直转圈。
    this._call('prompt.submit', { session_id: sessionId, text: message }, 30000).catch((error) => {
      if (this.turn === turn) this._finishTurn(turn, 'error', error.message);
    });

    const answer = await done;

    // 会话被回收过就顺手恢复，避免下次再撞空
    try { await this.ensureSession(); } catch { /* 不影响本条回复 */ }

    return { sessionId: this.storedId || sessionId, answer };
  }

  /** 回合收尾：拿最终文本，或抛出可读原因 */
  _finishTurn(turn, reason, detail) {
    if (this.turn !== turn) return;
    this.turn = null;
    this._onDelta = null;
    clearTimeout(turn.timer);
    clearTimeout(turn.quiet);

    const answer = (turn.final || turn.buffer).trim();
    if (answer) {
      turn.resolve(answer);
      return;
    }
    const message = detail
      || turn.error
      || (reason === 'timeout' ? 'Hermes 这次想太久了，先放弃' : 'Hermes 没给出可显示的内容');
    turn.reject(new Error(message));
  }

  /** 事件静默 ms 毫秒后收尾；新事件会重置计时 */
  _awaitQuiet(turn, ms) {
    if (this.turn !== turn) return;
    clearTimeout(turn.quiet);
    turn.quiet = setTimeout(() => this._finishTurn(turn, 'quiet'), ms);
  }

  async history(limit = 200) {
    const port = servePort();
    const base = `http://127.0.0.1:${port}`;
    const token = await mintToken(base);
    const headers = { Authorization: `Bearer ${token}` };

    let sessionId = this.storedId;
    if (!sessionId) {
      const listed = await fetch(`${base}/api/sessions?title=${encodeURIComponent(CHAT_TITLE)}&include_hidden=true&limit=5`, {
        headers, signal: timing(6000)
      });
      const data = await listed.json().catch(() => ({}));
      const rows = Array.isArray(data?.sessions) ? data.sessions : Array.isArray(data?.data) ? data.data : [];
      const exact = rows.find((row) => row?.id && row.title === CHAT_TITLE);
      if (!exact) return { sessionId: '', entries: [] };
      sessionId = exact.id;
      this.storedId = sessionId;
      writeJson(SESSION_FILE, { sessionId, title: CHAT_TITLE });
    }

    const response = await fetch(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${Math.min(limit, 400)}&order=latest`,
      { headers, signal: timing(8000) }
    );
    if (!response.ok) return { sessionId, entries: [] };
    const result = await response.json().catch(() => ({}));
    const rows = Array.isArray(result?.data) ? result.data : Array.isArray(result?.messages) ? result.messages : [];
    return {
      sessionId,
      // 接口按时间升序返回（limit 只截最近 N 条），不要再 reverse
      entries: rows.map((message) => ({
        role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system',
        content: this._text(message?.content),
        // timestamp 是秒级浮点，前端按毫秒算
        at: this._ms(message.timestamp)
      })).filter((row) => row.content && row.role !== 'system')
    };
  }

  _ms(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return Date.now();
    return num < 1e11 ? Math.round(num * 1000) : Math.round(num);
  }

  _text(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
    }
    return '';
  }

  dispose() {
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
    this.ws = null;
  }
}

module.exports = { PetConversation, CHAT_TITLE, SESSION_FILE };
