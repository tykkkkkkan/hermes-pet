// SVG → PNG 批量栅格化（Electron / Chromium）
// 用法：env -u ELECTRON_RUN_AS_NODE npx electron tools/svg2png.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const ROOT = path.join(__dirname, '..');
const A = (p) => path.join(ROOT, p);

function buildJobs() {
  const jobs = [];

  // E 类符号：统一 256 输出，另出 128 供小尺寸叠加
  const fxDir = A('assets/fx/svg');
  for (const f of fs.readdirSync(fxDir).filter((x) => x.endsWith('.svg'))) {
    const base = path.basename(f, '.svg');
    jobs.push({ src: path.join(fxDir, f), out: A(`assets/fx/png/${base}.png`), w: 256, h: 256 });
    jobs.push({ src: path.join(fxDir, f), out: A(`assets/fx/png/${base}@128.png`), w: 128, h: 128 });
  }

  // 气泡框：原尺寸 + 只有尾巴
  const uiDir = A('assets/ui/svg');
  const uiSizes = {
    'bubble-normal': [480, 160],
    'bubble-success': [480, 160],
    'bubble-error': [480, 160],
    'bubble-tail': [48, 26],
  };
  for (const f of fs.readdirSync(uiDir).filter((x) => x.endsWith('.svg'))) {
    const base = path.basename(f, '.svg');
    if (uiSizes[base]) {
      const [w, h] = uiSizes[base];
      jobs.push({ src: path.join(uiDir, f), out: A(`assets/ui/png/${base}.png`), w, h });
      continue;
    }
    // 托盘图标：64 / 32 / 16 三档（16 是 Windows 托盘实际显示尺寸）
    if (base.startsWith('tray-')) {
      for (const s of [64, 32, 16]) {
        jobs.push({ src: path.join(uiDir, f), out: A(`assets/ui/png/${base}@${s}.png`), w: s, h: s });
      }
      continue;
    }
    // 应用图标：多尺寸，供打包 .ico
    if (base === 'app-icon') {
      for (const s of [512, 256, 128, 64, 48, 32, 16]) {
        jobs.push({ src: path.join(uiDir, f), out: A(`assets/ui/png/app-icon@${s}.png`), w: s, h: s });
      }
    }
  }
  return jobs;
}

app.whenReady().then(async () => {
  const jobs = buildJobs();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');

  let ok = 0;
  for (const j of jobs) {
    const b64 = fs.readFileSync(j.src).toString('base64');
    const uri = `data:image/svg+xml;base64,${b64}`;
    try {
      const res = await win.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = ${j.w}; c.height = ${j.h};
            const g = c.getContext('2d');
            g.clearRect(0, 0, c.width, c.height);
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, 0, 0, ${j.w}, ${j.h});
            resolve(c.toDataURL('image/png'));
          };
          img.onerror = () => reject(new Error('svg load failed'));
          img.src = ${JSON.stringify(uri)};
        })
      `);
      const out = String(res).split(',')[1];
      fs.mkdirSync(path.dirname(j.out), { recursive: true });
      fs.writeFileSync(j.out, Buffer.from(out, 'base64'));
      ok++;
    } catch (e) {
      console.error('失败 ' + path.basename(j.out) + ': ' + (e && e.message ? e.message : e));
    }
  }
  console.log(`完成 ${ok}/${jobs.length}`);
  app.exit(0);
});
