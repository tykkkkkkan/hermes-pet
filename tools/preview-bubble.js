/* 气泡三态验收：加载真实页面，把 #bubble 分别置于普通 / 成功 / 出错状态各截一张，
 * 横向拼成对比图。用来检查 9-slice 拉伸、尾巴接缝、圆角与描边粗细。
 *
 * 用法：node tools/preview-bubble.js [输出 png]
 */
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const imgutil = require('./lib/imgutil');

const OUT = process.argv[2] || path.join(__dirname, '..', '.tmp', 'bubble.png');
const W = 340;
const H = 500;

app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  { scheme: 'petasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const CASES = [
  { tone: '', text: '刚巡过一圈，没什么异常。' },
  { tone: 'tone-success', text: '任务「2020 阅读剩余两篇」完成了，验收一下' },
  { tone: 'tone-error', text: 'Hermes 服务断了，我先安静等它回来' }
];

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
        headers: { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }
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
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'lib', 'mock-pet-preload.js')
    }
  });

  await win.loadFile(path.join(rootDir, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1400));

  const shots = [];
  for (const item of CASES) {
    await win.webContents.executeJavaScript(`(() => {
      const b = document.getElementById('bubble');
      b.className = '';
      b.textContent = ${JSON.stringify(item.text)};
      ${item.tone ? `b.classList.add(${JSON.stringify(item.tone)});` : ''}
      b.classList.add('show');
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 420));
    const img = await win.webContents.capturePage();
    shots.push({ label: item.tone || 'normal', png: PNG.sync.read(img.toPNG()) });
  }

  const gap = 12;
  const totalW = shots.reduce((s, x) => s + x.png.width, 0) + gap * (shots.length - 1);
  const out = new PNG({ width: totalW, height: H });
  out.data.fill(24); // 深底色，方便看透明区域与描边
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  let dx = 0;
  for (const s of shots) {
    for (let y = 0; y < Math.min(H, s.png.height); y++) {
      for (let x = 0; x < s.png.width; x++) {
        const si = (y * s.png.width + x) * 4;
        const di = (y * totalW + dx + x) * 4;
        const a = s.png.data[si + 3] / 255;
        for (let c = 0; c < 3; c++) {
          out.data[di + c] = Math.round(s.png.data[si + c] * a + out.data[di + c] * (1 - a));
        }
        out.data[di + 3] = 255;
      }
    }
    dx += s.png.width + gap;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  imgutil.writePNG(OUT, out);
  console.log('saved', OUT, out.width + 'x' + out.height);
  app.quit();
});
