/* 固定视口尺寸截图，用来验收窗口在真实尺寸下的排版。
 * 用法：node tools/shot.js <页面路径> <输出 png> [宽] [高] [等待毫秒]
 * 例：node tools/shot.js renderer/_mock-chat.html .tmp/chat.png 760 780 1800
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [, , target, outPath, wArg, hArg, waitArg] = process.argv;
const W = Number(wArg) || 760;
const H = Number(hArg) || 780;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    webPreferences: { offscreen: true }
  });
  const file = path.isAbsolute(target) ? target : path.join(__dirname, '..', target);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, Number(waitArg) || 1600));
  win.setContentSize(W, H);
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, img.toPNG());
  console.log(`saved ${outPath} ${W}x${H}`);
  app.quit();
}).catch((err) => {
  console.error(err);
  app.quit();
});
