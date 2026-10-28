// WebP → PNG（Chromium 解码，喂 data URI 绕过 file:// 限制）
// 用法：env -u ELECTRON_RUN_AS_NODE npx electron tools/webp2png-chromium.js <in> <out.png>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const argv = process.argv.filter(a => !a.startsWith('--'));
  const inp = argv[argv.length - 2];
  const outp = argv[argv.length - 1];

  try {
    const buf = fs.readFileSync(inp);
    const magic = buf.toString('ascii', 0, 4);
    let mime = 'image/webp';
    if (buf.slice(0, 2).toString('hex') === 'ffd8') mime = 'image/jpeg';
    else if (buf.toString('hex', 0, 4) === '89504e47') mime = 'image/png';
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`;

    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: { offscreen: true },
    });
    await win.loadURL('about:blank');

    const out = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const g = c.getContext('2d');
          g.clearRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0);
          resolve({ w: img.naturalWidth, h: img.naturalHeight, url: c.toDataURL('image/png') });
        };
        img.onerror = () => reject(new Error('img load failed (magic=' + ${JSON.stringify(magic)} + ')'));
        img.src = ${JSON.stringify(dataUri)};
      })
    `);

    const b64 = String(out.url).split(',')[1];
    fs.writeFileSync(outp, Buffer.from(b64, 'base64'));
    console.log(`ok ${out.w}x${out.h} -> ${outp}`);
    app.exit(0);
  } catch (e) {
    console.error('失败: ' + (e && e.message ? e.message : e));
    app.exit(3);
  }
});
