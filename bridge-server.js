const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

module.exports = function createBridgeServer({
  bridgeFile,
  writeJson,
  getState,
  getVisibility,
  appVersion,
  appPath,
  announce,
  setStatus,
  interact,
  showChat,
  showPet,
  hidePet,
  httpModule = http,
  cryptoModule = crypto
} = {}) {
  let server = null;
  let token = '';

  function bridgeJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  function bridgeAuthorized(req) {
    return String(req.headers.authorization || '') === `Bearer ${token}`;
  }

  function readBridgeBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 100000) reject(new Error('请求体过大'));
      });
      req.on('end', () => {
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求体不是有效 JSON')); }
      });
      req.on('error', reject);
    });
  }

  function bridgeState() {
    const visibility = getVisibility?.() || {};
    return {
      ...(getState?.() || {}),
      pid: process.pid,
      visible: !!visibility.visible,
      chatVisible: !!visibility.chatVisible
    };
  }

  function start() {
    token = cryptoModule.randomBytes(32).toString('hex');
    server = httpModule.createServer(async (req, res) => {
      if (!bridgeAuthorized(req)) return bridgeJson(res, 401, { ok: false, error: '未授权的桌宠桥接请求' });
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      try {
        if (req.method === 'GET' && url.pathname === '/health') {
          return bridgeJson(res, 200, { ok: true, pid: process.pid, version: appVersion?.() });
        }
        if (req.method === 'GET' && url.pathname === '/state') {
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        if (req.method !== 'POST') return bridgeJson(res, 404, { ok: false, error: '桥接路径不存在' });
        const body = await readBridgeBody(req);
        if (url.pathname === '/say') {
          const text = String(body.text || '').trim().slice(0, 2000);
          if (!text) return bridgeJson(res, 400, { ok: false, error: '播报内容不能为空' });
          announce(text, {
            kind: String(body.kind || 'plugin').slice(0, 40),
            notify: body.notify === true,
            taskResult: body.taskResult === true,
            userInitiated: true,
            source: 'hermes-plugin'
          });
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        if (url.pathname === '/status') {
          const status = String(body.status || 'idle').toLowerCase();
          if (!['idle', 'thinking', 'working', 'success', 'error', 'sleep'].includes(status)) {
            return bridgeJson(res, 400, { ok: false, error: '不支持的桌宠状态' });
          }
          setStatus(status, String(body.statusText || '').slice(0, 80) || undefined);
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        if (url.pathname === '/interact') {
          if (!['head', 'face', 'body', 'feet'].includes(String(body.zone || ''))) {
            return bridgeJson(res, 400, { ok: false, error: '不支持的互动区域' });
          }
          interact(body.zone);
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        if (url.pathname === '/open-chat') {
          showChat();
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        if (url.pathname === '/show') {
          showPet();
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        if (url.pathname === '/hide') {
          hidePet();
          return bridgeJson(res, 200, { ok: true, state: bridgeState() });
        }
        return bridgeJson(res, 404, { ok: false, error: '桥接路径不存在' });
      } catch (error) {
        return bridgeJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    });
    server.on('error', (error) => console.error('[hermes-pet] bridge error:', error.message));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      writeJson(bridgeFile(), {
        pid: process.pid,
        port: address.port,
        token,
        startedAt: Date.now(),
        appPath
      });
      console.log(`[hermes-pet] bridge listening on 127.0.0.1:${address.port}`);
    });
    return server;
  }

  function stop() {
    try { server?.close(); } catch {}
    server = null;
    token = '';
    try {
      const current = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
      if (Number(current?.pid) === process.pid) fs.unlinkSync(bridgeFile());
    } catch {}
  }

  return { start, stop, bridgeState, bridgeAuthorized, readBridgeBody, getToken: () => token };
};
