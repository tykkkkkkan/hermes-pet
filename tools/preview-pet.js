/* 桌宠立体化的离线验收：加载真实渲染层，分别在「正面 / 向右看 / 向左看」三个视角截图，
 * 横向拼成一张对比图。用来判断透视、投影、视差是否真的起了作用。
 *
 * 用法：node tools/preview-pet.js [输出 png]
 */
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT = process.argv[2] || path.join(__dirname, '..', '.tmp', 'pet-3d.png');
const W = 360;
const H = 520;

app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  { scheme: 'petasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

app.whenReady().then(async () => {
  const rootDir = path.join(__dirname, '..');
  protocol.handle('petasset', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const target = path.normalize(path.join(rootDir, rel));
    if (!target.startsWith(rootDir)) return new Response('forbidden', { status: 403 });
    const types = { '.png': 'image/png', '.json': 'application/json', '.js': 'text/javascript', '.html': 'text/html' };
    try {
      const data = await fs.promises.readFile(target);
      return new Response(data, {
        headers: {
          'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
          // standard scheme 会走 CORS 检查，页面是 file:// 源，必须显式放行
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'lib', 'mock-pet-preload.js')
    }
  });

  win.webContents.on('console-message', (event) => {
    const msg = event && event.message ? event.message : '';
    if (msg) console.log('[page]', msg);
  });
  await win.loadFile(path.join(rootDir, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const diag = await win.webContents.executeJavaScript(`({
    pixi: typeof window.PIXI,
    host: !!document.getElementById('pet-live2d-host'),
    api: typeof window.petLive2d,
    flag: document.body.dataset.live2d,
    ready: !!(window.petLive2d && window.petLive2d.isReady())
  })`);
  diag.puppet = await win.webContents.executeJavaScript('JSON.stringify(window.__petPuppetDebug ? window.__petPuppetDebug() : "no-debug")');
  console.log('diag', JSON.stringify(diag));
  const ready = diag.ready;
  if (!ready) console.warn('渲染层没起来，后面截到的是静态立绘，不能用来判断立体化效果');

  await win.webContents.executeJavaScript(`
    document.body.style.background = '#efe7f7';
    const b = document.getElementById('bubble'); if (b) b.style.display = 'none';
    true;
  `);

  const shots = [];
  // 第二参数传 states 时切状态截图，用来验状态符号与弹簧过渡；否则照旧出三视角
  const statesMode = process.argv[3] === 'states';
  const frames = statesMode
    ? ['idle', 'thinking', 'working', 'success', 'error', 'sleep'].map((s) => [s, s])
    : [['front', [0, 0]], ['right', [0.95, 0]], ['left', [-0.95, 0]]];
  for (const [label, value] of frames) {
    if (statesMode) {
      await win.webContents.executeJavaScript(`window.petLive2d.setState(${JSON.stringify(value)}); true;`);
      // 主进程每 3 秒推一次真实状态，等太久会被改回 idle，所以只留符号淡入的时间
      await new Promise((r) => setTimeout(r, 420));
    } else {
      await win.webContents.executeJavaScript(`window.petLive2d.setLook(${value[0]}, ${value[1]}); true;`);
      await new Promise((r) => setTimeout(r, 900));
    }
    const img = await win.webContents.capturePage();
    const fxDbg = await win.webContents
      .executeJavaScript('JSON.stringify((window.__petPuppetDebug() || {}).fx || {})')
      .catch(() => 'n/a');
    console.log('[fx]', label, fxDbg);
    shots.push({ label, png: PNG.sync.read(img.toPNG()) });
  }

  const totalW = shots.reduce((sum, s) => sum + s.png.width, 0);
  const out = new PNG({ width: totalW, height: shots[0].png.height });
  let offset = 0;
  for (const s of shots) {
    for (let y = 0; y < s.png.height; y++) {
      for (let x = 0; x < s.png.width; x++) {
        const from = (y * s.png.width + x) * 4;
        const to = (y * totalW + offset + x) * 4;
        for (let c = 0; c < 4; c++) out.data[to + c] = s.png.data[from + c];
      }
    }
    offset += s.png.width;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, PNG.sync.write(out));
  console.log('saved', OUT, `${totalW}x${out.height}`);
  app.quit();
}).catch((err) => {
  console.error(err);
  app.quit();
});
