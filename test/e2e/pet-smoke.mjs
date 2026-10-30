// 桌宠实机冒烟验收：真的把 Electron 窗口开起来，用 CDP 进去逐项验，验完关掉。
// 用法：node test/e2e/pet-smoke.mjs   （可选 --port=9333 --keep 截图保留）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 9333;
const REPEAT = Math.max(1, Number((process.argv.find((a) => a.startsWith('--repeat=')) || '').split('=')[1]) || 1);
const KEEP = process.argv.includes('--keep');
const LONG = process.argv.includes('--long');
const DASHBOARD_FIXTURE = process.argv.includes('--dashboard-fixture');
// 桌宠可能已经在跑（单例锁会让新实例直接退出），隔离一份 userData 才能并行验收
const ISOLATED = process.argv.includes('--isolated');
const TMP_PROFILE = path.join(ROOT, '.tmp', 'smoke-profile');
const ART = path.join(ROOT, 'test/e2e/artifacts');
const FIXTURE_LOCALAPPDATA = path.join(ROOT, '.tmp', 'dashboard-fixture-localappdata');

let fixtureServer = null;
let fixturePoll = 0;
let fixturePort = 0;
let fixturePhase = 0;

function fixtureTasks() {
  const make = (prefix, status, count) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: `${prefix} 任务 ${index + 1}`,
    assignee: index % 2 ? 'Agent B' : 'Agent A',
    status
  }));
  const queued = make('排队', 'todo', 6);
  queued[0].title = '这是一个特别特别长的任务标题用于验证单行省略号不会撑破仪表盘宽度';
  queued.push({ id: 'transition-blocked', title: '会变成受阻的任务', assignee: 'Agent C', status: fixturePhase >= 1 ? 'blocked' : 'todo' });
  queued.push({ id: 'transition-failed', title: '会变成失败的任务', assignee: 'Agent C', status: fixturePhase >= 2 ? 'failed' : 'todo' });
  queued.push({ id: 'transition-review', title: '会进入验收的任务', assignee: 'Agent C', status: fixturePhase >= 3 ? 'review' : 'todo' });
  return [
    { name: 'running', tasks: make('执行中', 'running', 6) },
    { name: 'blocked', tasks: make('受阻', 'blocked', 6) },
    { name: 'review', tasks: make('待验收', 'review', 6) },
    { name: 'todo', tasks: queued }
  ];
}

async function startDashboardFixture() {
  fixtureServer = createServer((request, response) => {
    if (request.url?.startsWith('/fixture/phase')) {
      const phase = Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('value'));
      fixturePhase = Math.max(0, Math.min(3, Number.isFinite(phase) ? phase : 0));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, phase: fixturePhase }));
      return;
    }
    const body = request.url === '/api/plugins/kanban/board'
      ? (fixturePoll += 1, { columns: fixtureTasks(), assignees: ['Agent A', 'Agent B', 'Agent C'], latest_event_id: fixturePoll })
      : request.url === '/api/status'
        ? { gateway_state: 'running', gateway_busy: false, active_agents: 2, active_sessions: 1, components: {} }
        : null;
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<script>window.__HERMES_SESSION_TOKEN__="dashboard-fixture"</script>');
      return;
    }
    if (!body) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  const address = fixtureServer.address();
  fixturePort = address.port;
  fs.mkdirSync(path.join(FIXTURE_LOCALAPPDATA, 'hermes'), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_LOCALAPPDATA, 'hermes', 'spawn-ledger.json'), JSON.stringify([
    { purpose: 'serve', port: address.port, startedAt: Date.now() }
  ]));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && /hermes|桌宠/i.test(t.title || '') )
        || list.find((t) => t.type === 'page' && /index\.html/i.test(t.url || ''));
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error('等不到 Electron 的调试目标，窗口可能没起来');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('CDP 连接失败: ' + (e.message || 'error'))));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}

async function capture(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return fs.statSync(file).size > 5000;
}

async function captureClip(cdp, file, clip) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return fs.statSync(file).size > 1000;
}

async function runOnce(runIndex = 1) {
  fs.mkdirSync(ART, { recursive: true });
  if (DASHBOARD_FIXTURE) await startDashboardFixture();
  console.log(`启动 Electron（调试端口 ${PORT}）…`);
  const electronBin = createRequire(import.meta.url)('electron'); // 拿到真正的 electron 可执行文件路径
  const extraArgs = ISOLATED ? [`--user-data-dir=${TMP_PROFILE}`] : [];
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`, ...extraArgs], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      PET_DISABLE_POLL: DASHBOARD_FIXTURE ? '0' : '1',
      ...(DASHBOARD_FIXTURE ? { LOCALAPPDATA: FIXTURE_LOCALAPPDATA } : {}),
      ...(ISOLATED ? { PET_BRIDGE_FILE: path.join(ROOT, '.tmp', 'smoke-bridge.json') } : {}),
    },
  });
  child.on('error', (e) => { console.error('启动 Electron 失败:', e.message); });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => {});

  let cdp;
  try {
    const page = await waitForTarget();
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(1200); // 让首帧和呼吸动画先跑一会儿

    // ---- 1. 页面真的起来了 ----
    const meta = await evaluate(cdp, `({
      title: document.title,
      ready: document.readyState,
      hasStage: !!document.getElementById('stage'),
      hasPet: !!document.getElementById('pet'),
      hasState: !!document.getElementById('pet-state'),
      hasGesture: !!document.getElementById('pet-gesture'),
      hasInner: !!document.getElementById('pet-inner'),
      size: [innerWidth, innerHeight]
    })`);
    check('窗口渲染出桌宠页面', meta?.ready === 'complete' && meta?.hasPet && meta?.hasState && meta?.hasGesture && meta?.hasInner,
      `${meta?.title} ${meta?.size?.join('x')}`);

    const split = await evaluate(cdp, `(() => {
      const state = document.getElementById('pet-state');
      const gesture = document.getElementById('pet-gesture');
      return { state: !!state, gesture: !!gesture, nested: !!state?.contains(gesture), stateAnimation: getComputedStyle(state).animationName, gestureAnimation: getComputedStyle(gesture).animationName };
    })()`);
    check('状态层与动作层独立嵌套', split?.nested && split?.stateAnimation === 'none' && split?.gestureAnimation === 'none', JSON.stringify(split));

    // ---- 2. preload 暴露的 API 齐全 ----
    const api = await evaluate(cdp, `(() => {
      const need = ['hitRegion','faceSources','stateSources','getState','interact','setStatus','openChat','getHermesSnapshot','sendChat'];
      const p = window.pet || {};
      return { present: need.filter(k => typeof p[k] !== 'undefined'), missing: need.filter(k => typeof p[k] === 'undefined') };
    })()`);
    check('preload API 全部就位', api?.missing.length === 0,
      api?.missing.join(',') || `${api?.present.length}/${api?.present.length}`);

    // ---- 3. 只有一层人物立绘 + 一层眨眼帧（防重影回归） ----
    const layersInDom = await evaluate(cdp, `(() => {
      const pet = document.getElementById('pet');
      const blink = document.getElementById('pet-blink');
      const face = document.getElementById('pet-face');
      return {
        images: pet ? pet.querySelectorAll('img.pet-layer').length : -1,
        hasBlink: !!blink && blink.classList.contains('pet-blink-layer'),
        hasFace: !!face && face.classList.contains('pet-face'),
        facePointerEvents: face ? getComputedStyle(face).pointerEvents : null,
        blinkOpacity: blink ? getComputedStyle(blink).opacity : null,
        gloss: !!document.querySelector('.pet-gloss')
      };
    })()`);
    check('立绘、表情、眨眼三层顺序正确', layersInDom?.images === 3 && layersInDom?.hasFace && layersInDom?.hasBlink
      && layersInDom?.facePointerEvents === 'none' && Number(layersInDom?.blinkOpacity) === 0 && !layersInDom?.gloss,
      `立绘层 ${layersInDom?.images} 张，表情穿透 ${layersInDom?.facePointerEvents}，眨眼透明度 ${layersInDom?.blinkOpacity}`);

    const faces = await evaluate(cdp, `(() => {
      const sources = { ...window.pet.faceSources };
      return Promise.all(Object.entries(sources).map(([key, src]) => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ key, ok: img.naturalWidth > 0 });
        img.onerror = () => resolve({ key, ok: false });
        img.src = src;
      })));
    })()`);
    check('十二态表情贴片全部加载', faces?.length >= 12 && faces.every((face) => face.ok), JSON.stringify(faces));

    // ---- 4. 立绘分层图片没有 404 ----
    const layers = await evaluate(cdp, `(() => {
      const sources = { ...window.pet.stateSources };
      return Promise.all(Object.entries(sources).map(([key, src]) => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ key, src, ok: img.naturalWidth > 0 });
        img.onerror = () => resolve({ key, src, ok: false });
        img.src = src;
      })));
    })()`);
    const broken = (layers || []).filter((l) => !l.ok);
    check('六态状态立绘全部加载', layers?.length >= 6 && broken.length === 0,
      `${layers?.length} 张（${layers?.map((l) => l.key).join('/')}），坏 ${broken.map((b) => b.src).join(',') || '无'}`);

    const poses = await evaluate(cdp, `(() => {
      const sources = { ...window.pet.poseSources };
      return Promise.all(Object.entries(sources).map(([key, src]) => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ key, ok: img.naturalWidth > 0 });
        img.onerror = () => resolve({ key, ok: false });
        img.src = src;
      })));
    })()`);
    check('七张行为姿态素材全部加载', poses?.length === 7 && poses.every((pose) => pose.ok), JSON.stringify(poses));

    const poseBoxes = await evaluate(cdp, `(() => {
      const pose = document.getElementById('pet-pose')?.getBoundingClientRect();
      const canvas = document.querySelector('#pet-live2d-host canvas')?.getBoundingClientRect();
      if (!pose || !canvas) return { available: false, pose, canvas };
      const keys = ['width', 'height', 'top', 'left'];
      const delta = Object.fromEntries(keys.map((key) => [key, Math.abs(pose[key] - canvas[key])]));
      return { available: true, pose: { width: pose.width, height: pose.height, top: pose.top, left: pose.left }, canvas: { width: canvas.width, height: canvas.height, top: canvas.top, left: canvas.left }, delta };
    })()`);
    check('姿态层和 canvas 盒子一致', poseBoxes?.available
      && Object.values(poseBoxes.delta).every((value) => value <= 2), JSON.stringify(poseBoxes));

    for (const scale of [80, 140]) {
      await evaluate(cdp, `window.pet.saveSettings({ petScale: ${scale} })`);
      await sleep(180);
      const box = await evaluate(cdp, `(() => {
        const pose = document.getElementById('pet-pose')?.getBoundingClientRect();
        const canvas = document.querySelector('#pet-live2d-host canvas')?.getBoundingClientRect();
        if (!pose || !canvas) return { scale: ${scale}, available: false };
        return { scale: ${scale}, available: true, delta: { width: Math.abs(pose.width - canvas.width), height: Math.abs(pose.height - canvas.height), top: Math.abs(pose.top - canvas.top), left: Math.abs(pose.left - canvas.left) } };
      })()`);
      check(`petScale ${scale}% 姿态仍对齐`, box?.available && Object.values(box.delta).every((value) => value <= 2), JSON.stringify(box));
      check(`petScale ${scale}% 截图`, await capture(cdp, path.join(ART, `pet-pose-${scale}.png`)), `test/e2e/artifacts/pet-pose-${scale}.png`);
    }
    await evaluate(cdp, `window.pet.saveSettings({ petScale: 100 }); true`);
    await sleep(180);
    const seamClip = await evaluate(cdp, `(() => {
      const vp = window.petLive2d?.getViewport?.();
      if (!vp) return null;
      const cutY = vp.rootY + 258 * vp.scale;
      const y0 = vp.rootY + 240 * vp.scale;
      const y1 = vp.rootY + 310 * vp.scale;
      return { x: Math.max(0, vp.rootX - 20), y: Math.max(0, y0), width: Math.min(window.innerWidth, 448 * vp.scale + 40), height: Math.min(window.innerHeight - Math.max(0, y0), y1 - y0), scale: 4 };
    })()`);
    check('切缝放大截图范围正确', !!seamClip && seamClip.height > 0, JSON.stringify(seamClip));
    if (seamClip) check('切缝放大截图', await captureClip(cdp, path.join(ART, 'neck-cut-zoom-4x.png'), seamClip), 'test/e2e/artifacts/neck-cut-zoom-4x.png');

    // ---- 5. 热区命中真实坐标 ----
    const hit = await evaluate(cdp, `(() => {
      const regions = window.pet?.regions || {};
      const out = {};
      for (const [zone, area] of Object.entries(regions)) {
        if (!area) continue;
        const x = (Number(area.left) + Number(area.right)) / 2;
        const y = (Number(area.top) + Number(area.bottom)) / 2;
        out[zone] = window.pet.hitRegion(x, y);
      }
      return { out, outside: window.pet.hitRegion(-1, -1), nan: window.pet.hitRegion('x', 0) };
    })()`);
    const hitBad = Object.entries(hit?.out || {}).filter(([zone, got]) => got !== zone);
    check('四区热区都能命中自己', hitBad.length === 0 && hit?.outside === null && hit?.nan === null,
      hitBad.length ? hitBad.map(([z, g]) => `${z}→${g}`).join(',') : Object.keys(hit?.out || {}).join('/'));

    // ---- 6. 主进程状态接口有响应 ----
    const state = await evaluate(cdp, `window.pet.getState().then(s => ({ ok: true, keys: Object.keys(s || {}).slice(0, 12) })).catch(e => ({ ok: false, err: String(e) }))`);
    check('getState 能从主进程拿到状态', state?.ok, state?.ok ? state.keys.join(',') : state?.err);

    const dashboard = await evaluate(cdp, `(() => {
      const panel = document.getElementById('status-panel');
      const tasks = document.getElementById('panel-tasks');
      return {
        present: !!panel && !!tasks,
        empty: tasks?.textContent.includes('看板是空的，暂时没活派给我'),
        total: document.getElementById('panel-total')?.textContent.includes('看板共 0 条'),
        maxHeight: getComputedStyle(panel).maxHeight,
        overflowY: getComputedStyle(panel).overflowY
      };
    })()`);
    check(DASHBOARD_FIXTURE ? '仪表盘滚动容器就位' : '仪表盘离线空态与滚动容器就位', dashboard?.present
      && (DASHBOARD_FIXTURE || (dashboard?.empty && dashboard?.total))
      && dashboard?.maxHeight === '300px' && dashboard?.overflowY === 'auto', JSON.stringify(dashboard));

    if (DASHBOARD_FIXTURE) {
      await sleep(900);
      const populated = await evaluate(cdp, `(() => {
        const panel = document.getElementById('status-panel');
        const tasks = document.getElementById('panel-tasks');
        const groups = [...tasks.querySelectorAll('.t-group')].map((group) => ({
          label: group.querySelector('.t-head')?.textContent || '',
          total: Number(group.querySelector('.t-head b')?.textContent || 0),
          rows: group.querySelectorAll('li:not(.t-more)').length,
          more: group.querySelector('.t-more')?.textContent || ''
        }));
        const first = tasks.querySelector('li > span');
        return {
          groups,
          total: document.getElementById('panel-total')?.textContent || '',
          longTitle: tasks.textContent.includes('特别特别长的任务标题'),
          ellipsis: first ? getComputedStyle(first).textOverflow : '',
          whiteSpace: first ? getComputedStyle(first).whiteSpace : '',
          hidden: panel.classList.contains('hidden'),
          scrollTop: panel.scrollTop
        };
      })()`);
      check('四组顺序、真实总数、三条截断提示与顶部总数', populated?.groups.map((group) => group.label.split(' ')[0]).join('/') === '待验收/受阻/执行中/排队'
        && populated.groups.every((group) => group.rows === 3)
        && populated.groups[0].total === 6 && populated.groups[0].more === '还有 3 条没显示'
        && populated.groups[3].total === 9 && populated.groups[3].more === '还有 6 条没显示'
        && populated.total === '看板共 27 条' && populated.longTitle && populated.scrollTop === 0
        && populated.ellipsis === 'ellipsis' && populated.whiteSpace === 'nowrap', JSON.stringify(populated));
      await evaluate(cdp, `document.getElementById('state-pill').click(); true`);
      await sleep(100);
      check('仪表盘顶部截图（第一组和总数）', await capture(cdp, path.join(ART, 'pet-dashboard-list.png')), 'test/e2e/artifacts/pet-dashboard-list.png');
      await evaluate(cdp, `(() => { const panel = document.getElementById('status-panel'); panel.scrollTop = Math.round((panel.scrollHeight - panel.clientHeight) / 2); })()`);
      await sleep(120);
      check('仪表盘中段截图（切边检查）', await capture(cdp, path.join(ART, 'pet-dashboard-scroll.png')), 'test/e2e/artifacts/pet-dashboard-scroll.png');
      await sleep(3500);
      check('后台状态变化时面板不自动收起', await evaluate(cdp, `!document.getElementById('status-panel').classList.contains('hidden')`), 'status-panel 保持展开');
      for (const [label, expected] of [['受阻播报', '受阻了'], ['失败播报', '失败了'], ['待验收播报', '做完了，等你验收']]) {
        await fetch(`http://127.0.0.1:${fixturePort}/fixture/phase?value=${label === '受阻播报' ? 1 : label === '失败播报' ? 2 : 3}`);
        await sleep(3400);
        const text = await evaluate(cdp, `document.getElementById('bubble').textContent`);
        console.log(`[播报] ${label}: ${text}`);
        check(label + '文案', text.includes(expected), text);
      }
    } else {
      await evaluate(cdp, `document.getElementById('state-pill').click(); true`);
      check('离线空态截图', await capture(cdp, path.join(ART, 'pet-dashboard-empty.png')), 'test/e2e/artifacts/pet-dashboard-empty.png');
      await evaluate(cdp, `document.getElementById('state-pill').click(); true`);
    }

    // ---- 7. 状态切换后表情层真的换图 ----
    const statusFaces = await evaluate(cdp, `(async () => {
      const expected = { working: 'face-serious', thinking: 'face-serious', success: 'face-laugh', sleep: 'face-yawn', error: 'face-angry' };
      const out = {};
      for (const [status, file] of Object.entries(expected)) {
        window.pet.setStatus(status);
        await new Promise(r => setTimeout(r, 340));
        const face = document.getElementById('pet-face');
        out[status] = { state: document.getElementById('pet').dataset.state || '', face: document.getElementById('pet').dataset.face || '', src: face.getAttribute('src') || '', ok: (face.getAttribute('src') || '').includes(file), opacity: getComputedStyle(face).opacity };
      }
      window.pet.setStatus('idle');
      return out;
    })()`);
    check('六态状态表情按优先级切换', Object.values(statusFaces || {}).every((item) => item.ok), JSON.stringify(statusFaces));

    const switched = await evaluate(cdp, `(async () => {
      const before = document.getElementById('pet-body').getAttribute('src');
      window.pet.interact('head');
      await new Promise(r => setTimeout(r, 800));
      const after = document.getElementById('pet-body').getAttribute('src');
      const bubble = document.getElementById('bubble');
      return { before, after, changed: !!bubble.textContent.trim() && !bubble.classList.contains('hidden') };
    })()`);
    check('点头能触发互动回应', switched?.changed, `回应气泡已显示：${switched?.changed}`);

    const triggerZone = async (zone) => evaluate(cdp, `(async () => {
      const area = document.getElementById('pet-hit-area');
      const regions = window.pet.regions;
      const region = regions.${zone};
      const bounds = area.getBoundingClientRect();
      const x = bounds.left + bounds.width * ((region.left + region.right) / 2);
      const y = bounds.top + bounds.height * ((region.top + region.bottom) / 2);
      const event = { bubbles: true, button: 0, clientX: x, clientY: y, screenX: x, screenY: y };
      window.dispatchEvent(new MouseEvent('mousemove', event));
      area.dispatchEvent(new MouseEvent('mousedown', event));
      window.dispatchEvent(new MouseEvent('mouseup', event));
      const action = window.pet.actions.find((item) => item.id === document.getElementById('pet-gesture').dataset.action);
      const puppet = !!window.petLive2d?.isReady?.() && !!action?.tracks;
      const poseBefore = puppet ? window.petLive2d.getPose() : null;
      const immediate = { action: document.getElementById('pet-gesture').dataset.action || '', active: document.getElementById('pet-gesture').classList.contains('gesture-active'), puppet, poseBefore };
      const before = document.getElementById('pet-gesture').getBoundingClientRect();
      await new Promise(r => setTimeout(r, 70));
      const gesture = document.getElementById('pet-gesture');
      const after = gesture.getBoundingClientRect();
      const style = getComputedStyle(gesture);
      const poseAfter = puppet ? window.petLive2d.getPose() : null;
      const poseMoved = puppet && poseBefore && poseAfter && ['rot', 'dy', 'eye', 'mouth', 'lean', 'jump'].some((key) => Math.abs((poseAfter[key] || 0) - (poseBefore[key] || 0)) > 0.02);
      return { immediate, stateActive: document.getElementById('pet-state').className, action: gesture.dataset.action || '', active: gesture.classList.contains('gesture-active'), iteration: style.animationIterationCount, animation: style.animationName, duration: style.animationDuration, moved: puppet ? !!poseMoved : Math.abs(after.top - before.top) + Math.abs(after.left - before.left) > 0.5, delta: { top: after.top - before.top, left: after.left - before.left }, poseAfter };
    })()`);

    const allActionPlayback = await evaluate(cdp, `(async () => {
      const gesture = document.getElementById('pet-gesture');
      const actions = window.pet.actions || [];
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const out = [];
      for (const action of actions) {
        const puppet = !!window.petLive2d?.isReady?.() && !!action.tracks;
        if (puppet) {
          const before = window.petLive2d.getPose();
          window.petLive2d.playTrack(action.tracks, action.duration, 1);
          const samples = [];
          const started = performance.now();
          while (performance.now() - started < action.duration + 200) {
            samples.push({ t: performance.now() - started, pose: window.petLive2d.getPose() });
            await wait(30);
          }
          const maxDev = Math.max(...samples.slice(1).map((sample) => Math.max(...['rot', 'dy', 'eye', 'mouth', 'lean', 'jump'].map((key) => Math.abs((sample.pose[key] || 0) - (before[key] || 0))))));
          out.push({ id: action.id, declared: action.duration, duration: (action.duration / 1000) + 's', animation: 'puppet-track', deltaTop: 0, deltaLeft: 0, moved: maxDev > 0.5, maxDev, puppet: true });
          window.petLive2d.stopTrack();
          await wait(20);
          continue;
        }
        gesture.classList.remove('gesture-active');
        delete gesture.dataset.action;
        gesture.style.removeProperty('animation-duration');
        gesture.dataset.action = action.id;
        gesture.style.animationDuration = action.duration + 'ms';
        void gesture.offsetWidth;
        gesture.classList.add('gesture-active');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const before = gesture.getBoundingClientRect();
        const firstStyle = getComputedStyle(gesture);
        const samples = [];
        const started = performance.now();
        while (performance.now() - started < action.duration + 200) {
          const rect = gesture.getBoundingClientRect();
          samples.push({ top: rect.top, left: rect.left });
          await wait(30);
        }
        const maxDev = Math.max(...samples.slice(1).map((sample) => Math.abs(sample.top - before.top) + Math.abs(sample.left - before.left)));
        out.push({ id: action.id, declared: action.duration, duration: firstStyle.animationDuration, animation: firstStyle.animationName, deltaTop: maxDev, deltaLeft: 0, moved: maxDev > 0.5, maxDev });
        gesture.classList.remove('gesture-active');
        delete gesture.dataset.action;
        gesture.style.removeProperty('animation-duration');
        await wait(20);
      }
      return out;
    })()`);
    for (const item of allActionPlayback || []) {
      console.log(`[动作] ${item.id} duration=${item.duration} declared=${item.declared}ms Δtop=${Number(item.deltaTop).toFixed(2)} Δleft=${Number(item.deltaLeft).toFixed(2)} animation=${item.animation}`);
    }
    check('十五个动作逐个有非零时长并产生位移', allActionPlayback?.length === 15 && allActionPlayback.every((item) => Number.parseFloat(item.duration) > 0.1 && item.moved), JSON.stringify(allActionPlayback));

    const headAction = await triggerZone('head');
    check('点头动作单次播放且不抢呼吸', headAction?.immediate?.action && (headAction.immediate?.puppet
      ? headAction.immediate.puppet && headAction.moved
      : headAction.immediate.active && headAction.iteration === '1' && Number.parseFloat(headAction.duration) > 0.1 && headAction.moved), JSON.stringify(headAction));
    check('点头截图', await capture(cdp, path.join(ART, 'pet-action-head.png')), 'test/e2e/artifacts/pet-action-head.png');

    const feetAction = await triggerZone('feet');
    check('点脚动作单次播放', feetAction?.immediate?.action && (feetAction.immediate?.puppet
      ? feetAction.immediate.puppet && feetAction.moved
      : feetAction.immediate.active && feetAction.iteration === '1' && Number.parseFloat(feetAction.duration) > 0.1 && feetAction.moved), JSON.stringify(feetAction));
    check('点脚截图', await capture(cdp, path.join(ART, 'pet-action-feet.png')), 'test/e2e/artifacts/pet-action-feet.png');

    const offsetSamples = await evaluate(cdp, `(async () => {
      const action = window.pet.actions.find((item) => item.id === 'hat-check');
      window.petLive2d.playTrack(action.tracks, action.duration, 1);
      const started = performance.now(); const rows = [];
      while (performance.now() - started <= action.duration + 80) {
        const pose = window.petLive2d.getPose();
        rows.push({ t: performance.now() - started, rot: pose.rot, lean: pose.lean });
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      window.petLive2d.stopTrack();
      const peak = (key) => rows.reduce((best, row) => Math.abs(row[key]) > Math.abs(best[key]) ? row : best, rows[0]);
      const rotPeak = peak('rot'); const leanPeak = peak('lean');
      return { rotPeak, leanPeak, deltaMs: Math.abs(rotPeak.t - leanPeak.t), samples: rows.length };
    })()`);
    check('动作 rot 与 lean 峰值错峰至少 35ms', offsetSamples?.deltaMs >= 35, JSON.stringify(offsetSamples));

    await evaluate(cdp, `window.pet.setStatus('working'); true`);
    await sleep(60);
    const workingAction = await triggerZone('body');
    const stateDuringAction = await evaluate(cdp, `(() => { const state = document.getElementById('pet-state'); const gesture = document.getElementById('pet-gesture'); return { working: state.classList.contains('working'), active: gesture.classList.contains('gesture-active'), iteration: getComputedStyle(gesture).animationIterationCount }; })()`);
    check('工作状态下动作不变成无限循环', workingAction?.immediate?.action
      && (workingAction.immediate.puppet
        ? workingAction.immediate.puppet && workingAction.moved && !workingAction.immediate.active
        : workingAction.immediate.active && stateDuringAction?.iteration === '1'), JSON.stringify({ workingAction, stateDuringAction }));

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await triggerZone('face');
    await sleep(120);
    const reducedAfter = await evaluate(cdp, `({ cssActive: document.getElementById('pet-gesture').classList.contains('gesture-active'), track: window.__petPuppetDebug?.().track || null })`);
    check('减少动态下动作能降级并清理', reduced?.immediate?.puppet
      ? reduced.moved && !reduced.immediate.active
      : reduced?.immediate?.active && reduced?.iteration === '1' && reducedAfter.cssActive === false, JSON.stringify({ reduced, reducedAfter }));
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await evaluate(cdp, `window.pet.setStatus('idle'); true`);

    if (LONG) {
      const mutations = evaluate(cdp, `new Promise((resolve) => {
        const target = document.getElementById('panel-tasks');
        if (!target) return resolve(-1);
        let count = 0;
        const observer = new MutationObserver(() => { count += 1; });
        observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
        setTimeout(() => { observer.disconnect(); resolve(count); }, 30000);
      })`);
      await sleep(4500);
      if (DASHBOARD_FIXTURE) {
        await sleep(30000);
      } else {
        const idleRun = await evaluate(cdp, `(async () => {
          const gesture = document.getElementById('pet-gesture');
          const actions = Object.fromEntries((window.pet.actions || []).map((action) => [action.id, action.duration]));
          const records = [];
          const started = performance.now();
          let active = null;
          while (performance.now() - started < 42000) {
            const now = performance.now();
            const isActive = gesture.classList.contains('gesture-active');
            const action = gesture.dataset.action || '';
            if (isActive && !active) active = { action, at: now };
            if (!isActive && active) {
              const elapsed = now - active.at;
              records.push({ action: active.action, elapsed, declared: actions[active.action] || 0, delta: elapsed - (actions[active.action] || 0) });
              active = null;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return records;
        })()`);
        for (const item of idleRun || []) console.log(`[待机] ${item.action} elapsed=${item.elapsed.toFixed(0)}ms declared=${item.declared}ms Δ=${item.delta.toFixed(0)}ms`);
        check('待机四十二秒动作持续时间接近声明值', idleRun?.length >= 2 && idleRun.every((item) => Math.abs(item.delta) <= 100), JSON.stringify(idleRun));
      }
      const mutationCount = await mutations;
      console.log(`[仪表盘] 30 秒 MutationObserver 变更次数=${mutationCount}`);
      check('仪表盘数据未变时三十秒不重建 DOM', mutationCount === 0, `mutations=${mutationCount}`);

      const tripleLines = {};
      for (const zone of ['head', 'face', 'body', 'feet']) {
        tripleLines[zone] = [];
        for (let i = 0; i < 3; i++) {
          await triggerZone(zone);
          await sleep(900);
          tripleLines[zone].push(await evaluate(cdp, "document.getElementById('bubble').textContent"));
        }
        check(`${zone} 区连续三次台词不复读`, new Set(tripleLines[zone]).size === 3, JSON.stringify(tripleLines[zone]));
      }
    }

    check('待机截图', await capture(cdp, path.join(ART, 'pet-action-idle.png')), 'test/e2e/artifacts/pet-action-idle.png');

    // ---- 8. 截图留证 ----
    const file = path.join(ART, `pet-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    check('截图留证', await capture(cdp, file), file);
  } catch (e) {
    check('实机验收执行', false, e.message);
  } finally {
    try { cdp?.close(); } catch {}
    child.kill();
    try { fixtureServer?.close(); } catch {}
    fixtureServer = null;
    if (DASHBOARD_FIXTURE) {
      try { fs.rmSync(FIXTURE_LOCALAPPDATA, { recursive: true, force: true }); } catch {}
    }
    if (!KEEP) await sleep(800);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (stderr.trim() && failed.length) console.log('Electron stderr 片段:\n' + stderr.split('\n').slice(-12).join('\n'));
  return failed.length === 0;
}

async function main() {
  let allPassed = true;
  for (let run = 1; run <= REPEAT; run++) {
    console.log(`\n===== smoke 第 ${run}/${REPEAT} 次 =====`);
    const passed = await runOnce(run);
    allPassed = allPassed && passed;
  }
  process.exit(allPassed ? 0 : 1);
}

main();
