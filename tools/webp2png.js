// WebP → PNG（项目里没有 sharp/jimp，借 electron 的 nativeImage 解码）
// 用法：env -u ELECTRON_RUN_AS_NODE npx electron tools/webp2png.js <in.webp> <out.png>
const { app, nativeImage } = require('electron');
const fs = require('fs');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const argv = process.argv.filter(a => !a.startsWith('--'));
  const inp = argv[argv.length - 2];
  const outp = argv[argv.length - 1];
  try {
    const img = nativeImage.createFromPath(inp);
    if (img.isEmpty()) {
      console.error('解码失败（空图）: ' + inp);
      app.exit(2);
      return;
    }
    const size = img.getSize();
    fs.writeFileSync(outp, img.toPNG());
    console.log(`ok ${size.width}x${size.height} -> ${outp}`);
    app.exit(0);
  } catch (e) {
    console.error('异常: ' + e.message);
    app.exit(3);
  }
});
