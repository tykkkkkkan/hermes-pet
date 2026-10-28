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

/**
 * 帽子顶：角色的固定最高点，比 bbox 顶更可靠
 *
 * 为什么需要它：举手/跳跃的图，bbox 顶部是手套或平板，不是头顶。
 * 按 bbox 高度缩放，手臂举得越高的图被缩得越小——success 和 wave
 * 会比 idle 矮 3~4%，切换状态时人物会"忽大忽小"。
 *
 * 判据：深紫色 + 单行连续宽度 >= 100px + 连续 3 行
 *   - 只用颜色会把"举起的平板"误判成帽子（success 里平板在帽子上方），
 *     所以加了连续宽度门槛：帽檐宽 200~300px，平板只有 90~120px
 *   - 只用单行会把噪点算进来，所以要求连续 3 行
 */
function hatTop(im, bb) {
  const { width: w, data: d } = im;
  const isHat = (p) => {
    if (d[p + 3] <= 160) return false;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 105 && b > g + 12 && r < 140;
  };
  let run = 0;
  for (let y = bb.y0; y <= bb.y1; y++) {
    let maxSeg = 0, cur = 0;
    for (let x = bb.x0; x <= bb.x1; x++) {
      if (isHat((y * w + x) * 4)) {
        cur++;
        if (cur > maxSeg) maxSeg = cur;
      } else cur = 0;
    }
    if (maxSeg >= 100) {
      run++;
      if (run >= 3) return y - 2;
    } else run = 0;
  }
  return null;
}

function normalize(im, file, anchor) {
  const bb = bbox(im);
  if (!bb) throw new Error('整张图透明，没有内容: ' + file);

  // 顶部锚点：
  //   hat   —— 用贝雷帽顶（深紫色横向连续段），适合"手举过头顶"的姿势，
  //            否则包围盒顶会顶到手套，人物被整体缩小
  //   bbox  —— 直接用包围盒顶，适合同一批出图、位置与翅膀高度一致的组
  //            （这批图上帽顶的深紫段太窄，hat 会误判到帽檐，得差 5% 身高）
  const hat = anchor === 'bbox' ? null : hatTop(im, bb);
  const topY = hat != null && hat > bb.y0 ? hat : bb.y0;
  const bodyH = bb.y1 - topY + 1;          // 帽子顶 → 脚底，这才是"身高"
  const scale = (SIZE * CHAR_H) / bodyH;

  const destH = bb.h * scale;              // 含举起的手在内，bbox 缩放后的高度
  const destW = bb.w * scale;
  const destFootY = SIZE * FOOT_Y;         // 脚底落点
  const destTop = destFootY - destH;       // bbox 顶部落点（可能高于帽子顶）
  const destLeft = SIZE / 2 - destW / 2;   // 水平居中

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
      hatTop: hat != null ? ((hat / im.height) * 100).toFixed(1) + '%' : '-',
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
const ANCHOR = args.includes('--anchor=bbox') ? 'bbox' : 'hat';
if (!args[0]) {
  console.error('用法: node tools/normalize-frames.js <输入目录> [输出目录] [--anchor=bbox]');
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
  const { png, info } = normalize(im, f, ANCHOR);
  fs.writeFileSync(path.join(outDir, name + '.png'), PNG.sync.write(png, { colorType: 6 }));
  console.log(
    name.padEnd(16),
    info.srcSize.padEnd(11),
    info.srcCharH.padStart(6),
    info.srcFootY.padStart(6),
    info.scale.padStart(6),
    `  身高 ${info.outCharH} 脚底 ${info.outFootY} 锚点 ${ANCHOR}:${info.hatTop}`
  );
}
console.log('\n输出目录: ' + outDir);
