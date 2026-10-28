/**
 * 帧对齐：把任意尺寸的透明 PNG 统一到桌宠基准
 *
 * 基准（与现有 body/idle.png 完全一致）：
 *   画布 1024×1024 / 角色高占 80% / 脚底距底 5% / 身体中轴居中
 *
 * 为什么要重算而不是直接缩放：
 *   AI 每次出图的大小、位置都不一样（本次三张角色高 84.8%~89.3% 不等），
 *   直接叠会导致切换状态时人物忽大忽小、上下窜。
 *   这里按每张图的内容包围盒算出真实身高与脚底，再独立缩放平移。
 *
 * 用法：
 *   node tools/normalize-frames.js <输入目录> [输出目录]
 */
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const SIZE = 1024;        // 输出画布
const CHAR_H = 0.80;      // 角色高占画布比例
const FOOT_Y = 0.95;      // 脚底在画布中的 y 比例
const ALPHA_MIN = 8;      // 参与包围盒计算的最小 alpha

function decode(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.slice(0, 4).toString('hex');
  if (magic.startsWith('ffd8ff')) {
    const im = jpeg.decode(buf, { useTArray: true });
    return { width: im.width, height: im.height, data: im.data };
  }
  const im = PNG.sync.read(buf);
  return { width: im.width, height: im.height, data: im.data };
}

/** 内容包围盒（含 alpha 阈值过滤，避开 JPEG 压缩产生的极淡噪点） */
function bbox(im) {
  const { width: w, height: h, data: d } = im;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] <= ALPHA_MIN) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 双线性采样（预乘 alpha 处理，避免边缘出现暗边） */
function sample(im, sx, sy, out, o) {
  const { width: w, height: h, data: d } = im;
  if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const x0 = sx | 0, y0 = sy | 0;
  const fx = sx - x0, fy = sy - y0;
  let r = 0, g = 0, b = 0, a = 0;
  const wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const idx = [y0 * w + x0, y0 * w + x0 + 1, (y0 + 1) * w + x0, (y0 + 1) * w + x0 + 1];
  for (let k = 0; k < 4; k++) {
    const p = idx[k] * 4;
    const aw = (d[p + 3] / 255) * wts[k];
    r += d[p] * aw;
    g += d[p + 1] * aw;
    b += d[p + 2] * aw;
    a += aw;
  }
  if (a <= 0.0001) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a * 255;
}

function normalize(im, file) {
  const bb = bbox(im);
  if (!bb) throw new Error('整张图透明，没有内容: ' + file);

  const targetH = SIZE * CHAR_H;
  const scale = targetH / bb.h;

  // 缩放后，内容应该占据的左上角
  const destH = bb.h * scale;
  const destW = bb.w * scale;
  const destFootY = SIZE * FOOT_Y;              // 脚底落点
  const destTop = destFootY - destH;            // 内容顶部落点
  const destLeft = SIZE / 2 - destW / 2;        // 水平居中

  const out = new PNG({ width: SIZE, height: SIZE });
  out.data.fill(0);
  const tmp = [0, 0, 0, 0];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 只处理内容框内，省 80% 的采样
      if (y + 1 < destTop || y > destTop + destH || x + 1 < destLeft || x > destLeft + destW) continue;
      const sx = bb.x0 + (x + 0.5 - destLeft) / scale;
      const sy = bb.y0 + (y + 0.5 - destTop) / scale;
      sample(im, sx, sy, tmp, 0);
      const o = (y * SIZE + x) * 4;
      out.data[o] = tmp[0];
      out.data[o + 1] = tmp[1];
      out.data[o + 2] = tmp[2];
      out.data[o + 3] = tmp[3];
    }
  }

  return {
    png: out,
    info: {
      srcSize: im.width + 'x' + im.height,
      srcCharH: ((bb.h / im.height) * 100).toFixed(1) + '%',
      srcFootY: ((bb.y1 / im.height) * 100).toFixed(1) + '%',
      scale: scale.toFixed(3),
      outCharH: ((destH / SIZE) * 100).toFixed(1) + '%',
      outFootY: ((destFootY / SIZE) * 100).toFixed(1) + '%',
      outMidX: '50.0%',
    },
  };
}

// ---------------- 主流程 ----------------
const args = process.argv.slice(2);
if (!args[0]) {
  console.error('用法: node tools/normalize-frames.js <输入目录> [输出目录]');
  process.exit(1);
}
const inDir = args[0];
const outDir = args[1] || path.join(inDir, '_norm');
fs.mkdirSync(outDir, { recursive: true });

const files = fs
  .readdirSync(inDir)
  .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith('_'))
  .map((f) => path.join(inDir, f));

console.log('文件'.padEnd(18), '源尺寸'.padEnd(11), '源身高', '源脚底', '缩放', '→ 统一后');
for (const f of files) {
  const name = path.basename(f).replace(/\.(png|jpe?g)$/i, '');
  const im = decode(f);
  const { png, info } = normalize(im, f);
  fs.writeFileSync(path.join(outDir, name + '.png'), PNG.sync.write(png, { colorType: 6 }));
  console.log(
    name.padEnd(16),
    info.srcSize.padEnd(11),
    info.srcCharH.padStart(6),
    info.srcFootY.padStart(6),
    info.scale.padStart(6),
    `  身高 ${info.outCharH} 脚底 ${info.outFootY} 中轴 ${info.outMidX}`
  );
}
console.log('\n输出目录: ' + outDir);
