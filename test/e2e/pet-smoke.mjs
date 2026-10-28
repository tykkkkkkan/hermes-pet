// 桌宠实机冒烟验收：真的把 Electron 窗口开起来，用 CDP 进去逐项验，验完关掉。
// 用法：node test/e2e/pet-smoke.mjs   （可选 --port=9333 --keep 截图保留）
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 9333;
const KEEP = process.argv.includes('--keep');
// 桌宠可能已经在跑（单例锁会让新实例直接退出），隔离一份 userData 才能并行验收
const ISOLATED = process.argv.includes('--isolated');
const TMP_PROFILE = path.join(ROOT, '.tmp', 'smoke-profile');
const ART = path.join(ROOT, 'test/e2e/artifacts');

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

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  console.log(`启动 Electron（调试端口 ${PORT}）…`);
  const electronBin = createRequire(import.meta.url)('electron'); // 拿到真正的 electron 可执行文件路径
  const extraArgs = ISOLATED ? [`--user-data-dir=${TMP_PROFILE}`] : [];
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`, ...extraArgs], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      PET_DISABLE_POLL: '1',
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
    check('六态表情贴片全部加载', faces?.length >= 6 && faces.every((face) => face.ok), JSON.stringify(faces));

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
      const immediate = { action: document.getElementById('pet-gesture').dataset.action || '', active: document.getElementById('pet-gesture').classList.contains('gesture-active') };
      await new Promise(r => setTimeout(r, 70));
      const gesture = document.getElementById('pet-gesture');
      return { immediate, stateActive: document.getElementById('pet-state').className, action: gesture.dataset.action || '', active: gesture.classList.contains('gesture-active'), iteration: getComputedStyle(gesture).animationIterationCount, animation: getComputedStyle(gesture).animationName };
    })()`);

    const headAction = await triggerZone('head');
    check('点头动作单次播放且不抢呼吸', headAction?.immediate?.active && headAction.immediate?.action && headAction.iteration === '1', JSON.stringify(headAction));
    check('点头截图', await capture(cdp, path.join(ART, 'pet-action-head.png')), 'test/e2e/artifacts/pet-action-head.png');

    const feetAction = await triggerZone('feet');
    check('点脚动作单次播放', feetAction?.immediate?.active && feetAction?.immediate?.action && feetAction.iteration === '1', JSON.stringify(feetAction));
    check('点脚截图', await capture(cdp, path.join(ART, 'pet-action-feet.png')), 'test/e2e/artifacts/pet-action-feet.png');

    await evaluate(cdp, `window.pet.setStatus('working'); true`);
    await sleep(60);
    const workingAction = await triggerZone('body');
    const stateDuringAction = await evaluate(cdp, `(() => { const state = document.getElementById('pet-state'); const gesture = document.getElementById('pet-gesture'); return { working: state.classList.contains('working'), active: gesture.classList.contains('gesture-active'), iteration: getComputedStyle(gesture).animationIterationCount }; })()`);
    check('工作状态下动作不变成无限循环', workingAction?.immediate?.active && stateDuringAction?.iteration === '1', JSON.stringify({ workingAction, stateDuringAction }));

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await triggerZone('face');
    await sleep(120);
    const reducedAfter = await evaluate(cdp, `document.getElementById('pet-gesture').classList.contains('gesture-active')`);
    check('减少动态下动作能降级并清理', reduced?.immediate?.active && reduced?.iteration === '1' && reducedAfter === false, JSON.stringify({ reduced, reducedAfter }));
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await evaluate(cdp, `window.pet.setStatus('idle'); true`);

    check('待机截图', await capture(cdp, path.join(ART, 'pet-action-idle.png')), 'test/e2e/artifacts/pet-action-idle.png');

    // ---- 8. 截图留证 ----
    const file = path.join(ART, `pet-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    check('截图留证', await capture(cdp, file), file);
  } catch (e) {
    check('实机验收执行', false, e.message);
  } finally {
    try { cdp?.close(); } catch {}
    child.kill();
    if (!KEEP) await sleep(800);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (stderr.trim() && failed.length) console.log('Electron stderr 片段:\n' + stderr.split('\n').slice(-12).join('\n'));
  process.exit(failed.length ? 1 : 0);
}

main();
