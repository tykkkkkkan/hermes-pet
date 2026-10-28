/* 截当前桌面（主屏），用于确认桌宠在真实桌面上的样子。
 * 用法：node tools/grab-screen.js [输出 png] [裁剪x,y,w,h]
 */
const { app, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(__dirname, '..', '.tmp', 'desktop.png');
const CROP = process.argv[3] || '';

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const w = Math.round(d.size.width * d.scaleFactor);
  const h = Math.round(d.size.height * d.scaleFactor);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  if (!sources.length) { console.log('没有可截的屏幕'); app.quit(); return; }
  let png = sources[0].thumbnail;
  if (CROP) {
    const [x, y, cw, ch] = CROP.split(',').map(Number);
    png = png.crop({ x, y, width: cw, height: ch });
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png.toPNG());
  console.log('saved', OUT, png.getSize().width + 'x' + png.getSize().height, 'scale', d.scaleFactor);
  app.quit();
});
