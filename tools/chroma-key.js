/**
 * 洋红底抠像（magenta chroma key）
 *
 * 为什么不用全图按颜色判定：
 *   她的眼睛是紫色（r、b 偏高、g 偏低），颜色特征与洋红重合，
 *   一刀切会把眼皮打成半透明。所以先做「与画布边缘连通」的洪泛，
 *   只有能和背景连起来的洋红才算背景。
 *
 * 为什么必须 despill：
 *   白色头发/衣服的抗锯齿边缘会和洋红混出粉紫，
 *   不修正的话抠完白发边缘一圈粉边，深色桌面上非常明显。
 *
 * 用法：
 *   node tools/chroma-key.js <输入文件或目录> [输出目录]
 */
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

// ---------- 解码：按魔数分派，不信任扩展名 ----------
function decode(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.slice(0, 4).toString('hex');
  if (magic.startsWith('ffd8ff')) {
    const im = jpeg.decode(buf, { useTArray: true });
    return { width: im.width, height: im.height, data: im.data, kind: 'jpeg' };
  }
  if (magic === '89504e47') {
    const im = PNG.sync.read(buf);
    return { width: im.width, height: im.height, data: im.data, kind: 'png' };
  }
  throw new Error('不认识的图片格式: ' + magic);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 抠像主过程
 * @param {object} im decode 结果
 * @param {object} opt
 *   bgTol      与背景色的 RGB 欧氏距离，小于此值视为背景候选
 *   softLo/softHi  洋红强度过渡带（alpha 从 1 降到 0 的区间）。不传则按实测底色自动推导
 *   despill    去色溢强度 0~1
 *   despillBand  只在该 alpha 区间内做 despill
 */
function keyOut(im, opt = {}) {
  const o = Object.assign(
    { bgTol: 150, despill: 0.72, despillBand: [0.02, 0.98] },
    opt
  );
  const { width: w, height: h } = im;
  const src = im.data;
  const out = Buffer.from(src);

  // ---- 1. 估计背景色：四边一圈的中位数 ----
  const samples = [[], [], []];
  const push = (x, y) => {
    const p = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) samples[c].push(src[p + c]);
  };
  for (let x = 0; x < w; x += 3) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 3) { push(0, y); push(w - 1, y); }
  const bg = samples.map((arr) => {
    arr.sort((a, b) => a - b);
    return arr[(arr.length / 2) | 0];
  });

  // 洋红强度：纯 #FF00FF 约 255，白色约 0
  const bgMag = Math.min(bg[0], bg[2]) - bg[1];
  const bgIsMagenta = bgMag > 55 && bg[0] > 150;

  // 关键：过渡带必须跟着实际底色走。
  // 豆包有时把「洋红」画成偏粉的 #FD4A97（bgMag≈80），
  // 用固定 45/165 会把人物边缘判成半透明，抠完一圈发虚。
  const softLo = o.softLo != null ? o.softLo : Math.max(12, bgMag * 0.25);
  const softHi = o.softHi != null ? o.softHi : Math.max(softLo + 25, bgMag * 0.88);


  // ---- 2. 洪泛：从画布边缘向内，标记与外界连通的背景 ----
  // 两个条件必须同时满足：
  //   a) 颜色接近实测底色
  //   b) 洋红强度不低（mag >= softLo）
  // 只靠 (a) 会出事：C 类底色是 (253,124,216)，到白色的欧氏距离只有 136，
  // 落在 bgTol=150 内，白色手写标题会被当成背景整块吃掉（C7「摸鱼」就是这么没的）。
  const isBg = new Uint8Array(w * h);
  const stack = [];
  const near = (i) => {
    const p = i * 4;
    const dr = src[p] - bg[0], dg = src[p + 1] - bg[1], db = src[p + 2] - bg[2];
    if (dr * dr + dg * dg + db * db >= o.bgTol * o.bgTol) return false;
    return Math.min(src[p], src[p + 2]) - src[p + 1] >= softLo;
  };
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (isBg[i]) continue;
    if (!near(i)) continue;
    isBg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  // ---- 3. 算 alpha：洋红强度 = min(r,b) - g ----
  let bgPx = 0, softPx = 0, spillPx = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const r = src[p], g = src[p + 1], b = src[p + 2];

    let a;
    if (bgIsMagenta) {
      const magScore = Math.min(r, b) - g;             // 洋红≈198，白≈0
      a = 1 - smoothstep(softLo, softHi, magScore);
    } else {
      a = isBg[i] ? 0 : 1;
    }
    // 洪泛判定的背景强制透明；洪泛外部的纯色（如眼睛内部）不受影响
    if (isBg[i]) a = 0;

    if (a <= 0.004) {
      out[p + 3] = 0;
      bgPx++;
      continue;
    }
    if (a < 0.98) softPx++;

    // ---- 4. despill：只削「多出来的红/蓝」，不动本来就该偏紫的像素 ----
    let rr = r, gg = g, bb = b;
    if (a < o.despillBand[1] || a < 1) {
      const excess = Math.min(rr, bb) - gg;
      if (excess > 0 && (rr > gg || bb > gg)) {
        rr = rr - excess * o.despill;
        bb = bb - excess * o.despill;
        spillPx++;
      }
    }

    out[p] = clamp(rr, 0, 255);
    out[p + 1] = clamp(gg, 0, 255);
    out[p + 2] = clamp(bb, 0, 255);
    out[p + 3] = Math.round(a * 255);
  }

  const res = new PNG({ width: w, height: h });
  out.copy(res.data);
  return {
    png: res,
    stats: {
      bg: bg.join(','),
      bgIsMagenta,
      bgMag,
      softLo: Math.round(softLo),
      softHi: Math.round(softHi),
      bgPx,
      softPx,
      spillPx,
      total: w * h,
    },
  };
}

// ---------- 主流程 ----------
const args = process.argv.slice(2);
if (!args[0]) {
  console.error('用法: node tools/chroma-key.js <文件或目录> [输出目录]');
  process.exit(1);
}
const input = args[0];
const outDir = args[1] || path.join(path.dirname(input), '_keyed');
fs.mkdirSync(outDir, { recursive: true });

const files = fs.statSync(input).isDirectory()
  ? fs
      .readdirSync(input)
      .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
      .map((f) => path.join(input, f))
  : [input];

for (const f of files) {
  const name = path.basename(f).replace(/\.(png|jpe?g)$/i, '');
  const im = decode(f);
  const { png, stats } = keyOut(im);
  const dest = path.join(outDir, name + '.png');
  png.pack = png.pack || null;
  fs.writeFileSync(dest, PNG.sync.write(png, { colorType: 6 }));
  const pct = (n) => ((n / stats.total) * 100).toFixed(2) + '%';
  console.log(
    `${name}  [${im.kind} ${im.width}x${im.height}]  bg=(${stats.bg})` +
      `  mag=${stats.bgMag} 带=[${stats.softLo},${stats.softHi}]  透明 ${pct(stats.bgPx)}  软边 ${pct(stats.softPx)}  去色溢 ${pct(stats.spillPx)}` +
      `  -> ${path.basename(dest)}`
  );
}
console.log('\n输出目录: ' + outDir);
