// 合成预览：把透明 PNG 叠到深色桌面底上，检查白边 / 粉边 / 半透明
// 用法：node tools/compose-check.js <输出.png> <图1> <图2> ...
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const [outFile, ...inputs] = process.argv.slice(2);
if (!outFile || !inputs.length) {
  console.error('用法: node tools/compose-check.js <输出.png> <图1> <图2> ...');
  process.exit(1);
}

function decode(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.slice(0, 4).toString('hex');
  if (magic.startsWith('ffd8ff')) {
    const im = jpeg.decode(buf, { useTArray: true });
    return { w: im.width, h: im.height, d: im.data };
  }
  const im = PNG.sync.read(buf);
  return { w: im.width, h: im.height, d: im.data };
}

const CELL_H = 460;
const GAP = 16;
const PAD = 16;

const imgs = inputs.map(f => {
  const im = decode(f);
  const scale = CELL_H / im.h;
  return { name: path.basename(f), im, scale, w: Math.round(im.w * scale) };
});

const totalW = PAD * 2 + imgs.reduce((s, x) => s + x.w, 0) + GAP * (imgs.length - 1);
const totalH = CELL_H + PAD * 2;
const canvas = new PNG({ width: totalW, height: totalH });

// 深色桌面底：径向略亮，模拟真实壁纸
for (let y = 0; y < totalH; y++) {
  for (let x = 0; x < totalW; x++) {
    const p = (y * totalW + x) * 4;
    const dx = (x - totalW / 2) / totalW, dy = (y - totalH / 2) / totalH;
    const v = 34 + 18 * (1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2.2));
    canvas.data[p] = v;
    canvas.data[p + 1] = v;
    canvas.data[p + 2] = v + 4;
    canvas.data[p + 3] = 255;
  }
}

let cursorX = PAD;
for (const it of imgs) {
  const { im, scale, w } = it;
  const h = CELL_H;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(im.h - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(im.w - 1, Math.floor(x / scale));
      const sp = (sy * im.w + sx) * 4;
      const a = im.d[sp + 3] / 255;
      if (a <= 0.004) continue;
      const dp = ((y + PAD) * totalW + (x + cursorX)) * 4;
      for (let c = 0; c < 3; c++) {
        canvas.data[dp + c] = Math.round(im.d[sp + c] * a + canvas.data[dp + c] * (1 - a));
      }
      canvas.data[dp + 3] = 255;
    }
  }
  cursorX += w + GAP;
}

fs.writeFileSync(outFile, PNG.sync.write(canvas, { colorType: 6 }));
console.log('ok ' + outFile + '  ' + totalW + 'x' + totalH + '  ' + imgs.map(i => i.name).join(' | '));
