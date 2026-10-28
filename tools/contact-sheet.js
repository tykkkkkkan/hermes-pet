// 总览拼版：把一批透明 PNG 拼成网格，便于一眼对比姿势/表情/画风
// 用法：node tools/contact-sheet.js <输出.png> <列数> <单元高> <图...>
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const [outFile, colsArg, cellArg, ...inputs] = process.argv.slice(2);
const COLS = parseInt(colsArg, 10) || 5;
const CELL = parseInt(cellArg, 10) || 260;
const GAP = 8;

function decode(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(0, 4).toString('hex').startsWith('ffd8ff')) {
    const im = jpeg.decode(buf, { useTArray: true });
    return { w: im.width, h: im.height, d: im.data };
  }
  const im = PNG.sync.read(buf);
  return { w: im.width, h: im.height, d: im.data };
}

const imgs = inputs.map(f => {
  const im = decode(f);
  const s = CELL / Math.max(im.w, im.h);
  return { f, im, s, w: Math.round(im.w * s), h: Math.round(im.h * s) };
});

const rows = Math.ceil(imgs.length / COLS);
const W = COLS * (CELL + GAP) + GAP;
const H = rows * (CELL + GAP) + GAP;
const cv = new PNG({ width: W, height: H });

// 棋盘底：半透明区域一眼可见（真透明会露出格子）
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    const dark = ((x >> 4) + (y >> 4)) & 1;
    const v = dark ? 46 : 58;
    cv.data[p] = v; cv.data[p + 1] = v; cv.data[p + 2] = v + 6; cv.data[p + 3] = 255;
  }
}

imgs.forEach((it, i) => {
  const cx = GAP + (i % COLS) * (CELL + GAP);
  const cy = GAP + Math.floor(i / COLS) * (CELL + GAP);
  const ox = cx + Math.round((CELL - it.w) / 2);
  const oy = cy + Math.round((CELL - it.h) / 2);
  for (let y = 0; y < it.h; y++) {
    for (let x = 0; x < it.w; x++) {
      const sx = Math.min(it.im.w - 1, Math.floor(x / it.s));
      const sy = Math.min(it.im.h - 1, Math.floor(y / it.s));
      const sp = (sy * it.im.w + sx) * 4;
      const a = it.im.d[sp + 3] / 255;
      if (a <= 0.004) continue;
      const dp = ((oy + y) * W + (ox + x)) * 4;
      for (let c = 0; c < 3; c++) {
        cv.data[dp + c] = Math.round(it.im.d[sp + c] * a + cv.data[dp + c] * (1 - a));
      }
    }
  }
});

fs.writeFileSync(outFile, PNG.sync.write(cv, { colorType: 6 }));
console.log('ok ' + outFile + '  ' + W + 'x' + H + '  ' + imgs.length + ' 张');
imgs.forEach((it, i) => console.log(`  ${i}  行${Math.floor(i / COLS) + 1}列${(i % COLS) + 1}  ${path.basename(it.f)}`));
