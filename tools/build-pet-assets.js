/**
 * 把 06 产出目录里的成品图，转成桌宠能直接用的素材。
 *
 * 做四件事：
 *   1. 白底 -> 透明（从四周洪泛，不吃掉角色内部的白色）
 *   2. 去掉边缘白边（收缩 1px + alpha 羽化）
 *   3. 统一画幅：角色高度归一、脚底对齐、水平居中到身体中线
 *   4. 六表情拆格，六格共用同一个裁切框，保证切换时不跳
 *
 * 用法：
 *   node tools/build-pet-assets.js          正常出图
 *   node tools/build-pet-assets.js --diag   只打印测量数据，不写文件
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const SRC = 'D:/06-AI协作/WorkBuddy/产出';
const OUT = path.join(__dirname, '..', 'assets', 'states');

const FILES = {
  full: '2026-10-27 Hermes正面全身图.png',
  face: '2026-10-27 Hermes表情九宫格.png',
  exprs: '2026-10-27 Hermes六表情参考图.png',
  acts: [
    ['done', '2026-10-27 Hermes动作-搞定叉腰.png'],
    ['rest', '2026-10-27 Hermes动作-歇一下抱鱼.png'],
    ['work', '2026-10-27 Hermes动作-赶工敲代码.png'],
  ],
  props: [
    ['trust', '2026-10-27 Hermes道具-交给我吧.png'],
    ['dispatch', '2026-10-27 Hermes道具-我来调度.png'],
    ['memory', '2026-10-27 Hermes道具-记忆存好了.png'],
  ],
};

// ---------- 读写 ----------

function loadRGBA(p) {
  const buf = fs.readFileSync(p);
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (isPng) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: j.width, height: j.height, data: j.data };
}

function savePNG(img, p) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PNG.sync.write(png));
}

// ---------- 抠白底 ----------

/**
 * 背景色取「边框像素里出现最多的那个颜色」，而不是四角取样。
 * 四角会被格子分隔线污染，导致整片白底识别不出来。
 */
function cornerColor(img) {
  const { width: W, height: H, data: d } = img;
  const buckets = new Map();
  const add = (x, y) => {
    const p = (y * W + x) * 4;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(k, e);
  };
  for (let x = 0; x < W; x++) { add(x, 0); add(x, H - 1); }
  for (let y = 0; y < H; y++) { add(0, y); add(W - 1, y); }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

function removeWhiteBg(img, tol = 22) {
  const { width: W, height: H, data: d } = img;
  const n = W * H;
  const bg = new Uint8Array(n);
  const stack = [];

  // 判据用「够亮 + 不带彩」，不用「离某个基准色多远」。
  // 因为 JPEG 在格子分隔线旁边会拖出一条渐变灰带，固定色差会把这条带判成角色。
  const like = (i) => {
    const p = i * 4;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 226 && mx - mn <= 20;
  };

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (bg[i]) return;
    if (!like(i)) return;
    bg[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }

  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  return bg;
}

/**
 * 把 bg 掩码写成透明，并处理边缘：
 *   收缩 1px 去掉白边 -> alpha 3x3 羽化 -> 半透明像素按白底反解颜色
 */
function applyMask(img, bg, { shrink = 1, feather = 1 } = {}) {
  const { width: W, height: H, data: d } = img;
  const n = W * H;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 1;

  for (let s = 0; s < shrink; s++) {
    const next = fg.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!fg[i]) continue;
        const nb =
          (x > 0 && !fg[i - 1]) || (x < W - 1 && !fg[i + 1]) ||
          (y > 0 && !fg[i - W]) || (y < H - 1 && !fg[i + W]);
        if (nb) next[i] = 0;
      }
    }
    fg.set(next);
  }

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = fg[i] ? 255 : 0;

  if (feather > 0) {
    const src = alpha.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const edge =
          (x > 0 && (src[i - 1] === 0) !== (src[i] === 0)) ||
          (x < W - 1 && (src[i + 1] === 0) !== (src[i] === 0)) ||
          (y > 0 && (src[i - W] === 0) !== (src[i] === 0)) ||
          (y < H - 1 && (src[i + W] === 0) !== (src[i] === 0));
        if (!edge) continue;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            sum += src[yy * W + xx]; cnt++;
          }
        }
        alpha[i] = sum / cnt;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = Math.round(alpha[i]);
    d[p + 3] = a;
    if (a > 0 && a < 250) {
      // 半透明边缘是白底混出来的，按 a 反解回纯色，避免白色毛边
      const k = 255 / a;
      d[p] = Math.min(255, Math.round(d[p] * k - (k - 1) * 255 * 0));
      d[p + 1] = Math.min(255, Math.round(d[p + 1] * k));
      d[p + 2] = Math.min(255, Math.round(d[p + 2] * k));
    }
  }
  return img;
}

// ---------- 测量 ----------

function bbox(img, thr = 8) {
  const { width: W, height: H, data: d } = img;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------- 缩放 ----------

function resizeRGBA(img, nw, nh) {
  const { width: W, height: H, data: s } = img;
  const out = new Uint8Array(nw * nh * 4);
  const sx = W / nw, sy = H / nh;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(W - 1.001, (x + 0.5) * sx - 0.5);
      const fy = Math.min(H - 1.001, (y + 0.5) * sy - 0.5);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      let r = 0, g = 0, b = 0, a = 0;
      const wts = [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ];
      for (const [xx, yy, w] of wts) {
        const p = (yy * W + xx) * 4;
        const al = s[p + 3] / 255;
        r += s[p] * al * w;
        g += s[p + 1] * al * w;
        b += s[p + 2] * al * w;
        a += s[p + 3] * w;
      }
      const o = (y * nw + x) * 4;
      out[o + 3] = Math.round(a);
      if (a > 0) {
        out[o] = Math.round(r / (a / 255));
        out[o + 1] = Math.round(g / (a / 255));
        out[o + 2] = Math.round(b / (a / 255));
      }
    }
  }
  return { width: nw, height: nh, data: out };
}

/**
 * 归一化：角色高度固定，脚底固定，水平对齐到身体中线。
 * 这是"切换不跳"的唯一保证。
 */
function normalize(img, { W = 1024, H = 1024, heightFrac = 0.78, bottomFrac = 0.06 } = {}) {
  const b = bbox(img);
  const targetH = Math.round(H * heightFrac);
  const scale = targetH / b.h;
  const nw = Math.max(1, Math.round(img.width * scale));
  const nh = Math.max(1, Math.round(img.height * scale));
  const rs = resizeRGBA(img, nw, nh);
  const rb = bbox(rs);

  const canvas = new Uint8Array(W * H * 4);
  const dx = Math.round(W / 2 - (rb.x0 + rb.w / 2));
  const dy = Math.round(H - H * bottomFrac - rb.y1 - 1);

  for (let y = 0; y < nh; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < nw; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= W) continue;
      const s = (y * nw + x) * 4;
      if (rs.data[s + 3] === 0) continue;
      const t = (ty * W + tx) * 4;
      canvas[t] = rs.data[s];
      canvas[t + 1] = rs.data[s + 1];
      canvas[t + 2] = rs.data[s + 2];
      canvas[t + 3] = rs.data[s + 3];
    }
  }
  return { width: W, height: H, data: canvas };
}

// ---------- 拼参照图 ----------

function fadeBottom(img, frac = 0.14) {
  const { width: W, height: H, data: d } = img;
  const y0 = Math.floor(H * (1 - frac));
  for (let y = y0; y < H; y++) {
    const t = (y - y0) / Math.max(1, H - y0);
    const k = 1 - t * t;
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      d[p + 3] = Math.round(d[p + 3] * k);
    }
  }
  return img;
}

function checker(W, H, cell = 16) {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2 ? 235 : 200;
      const o = (y * W + x) * 4;
      out[o] = c; out[o + 1] = c; out[o + 2] = c; out[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

function overOn(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const a = src.data[s + 3] / 255;
      if (a === 0) continue;
      const tx = x + ox, ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const t = (ty * dst.width + tx) * 4;
      for (let c = 0; c < 3; c++) {
        dst.data[t + c] = Math.round(src.data[s + c] * a + dst.data[t + c] * (1 - a));
      }
      dst.data[t + 3] = 255;
    }
  }
}

// ---------- 主流程 ----------

function main() {
  const diag = process.argv.includes('--diag');
  const report = [];

  // 1. 全身图 -> idle
  const full = loadRGBA(path.join(SRC, FILES.full));
  const fullBg = removeWhiteBg(full);
  applyMask(full, fullBg);
  const fb = bbox(full);
  report.push(`[全身] 原图 ${full.width}x${full.height}  角色框 ${fb.w}x${fb.h} @(${fb.x0},${fb.y0})`);
  const idle = normalize(full, { heightFrac: 0.80, bottomFrac: 0.05 });
  if (!diag) savePNG(idle, path.join(OUT, 'body', 'idle.png'));

  // 2. 六表情：拆 3 列 x 2 行，六格共用参考裁切框
  const ex = loadRGBA(path.join(SRC, FILES.exprs));
  const cw0 = Math.floor(ex.width / 3);
  const ch0 = Math.floor(ex.height / 2);
  const INSET = 4; // 躲开格子之间的灰色分隔线
  const cw = cw0 - INSET * 2;
  const ch = ch0 - INSET * 2;
  report.push(`[六表情] 原图 ${ex.width}x${ex.height}  单格 ${cw0}x${ch0}  内缩后 ${cw}x${ch}`);

  const cells = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = { width: cw, height: ch, data: new Uint8Array(cw * ch * 4) };
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const s = ((y + r * ch0 + INSET) * ex.width + (x + c * cw0 + INSET)) * 4;
          const t = (y * cw + x) * 4;
          cell.data[t] = ex.data[s];
          cell.data[t + 1] = ex.data[s + 1];
          cell.data[t + 2] = ex.data[s + 2];
          cell.data[t + 3] = 255;
        }
      }
      const bgc = removeWhiteBg(cell, 26);
      applyMask(cell, bgc, { shrink: 1, feather: 1 });
      const bb = bbox(cell);
      cells.push({ cell, bb, r, c });
      report.push(`  格${r * 3 + c + 1} 框 ${bb.w}x${bb.h} @(${bb.x0},${bb.y0})`);
    }
  }

  // 参考框：取六格的中位数，避免某一格偏移带歪全部
  const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const rx0 = med(cells.map((x) => x.bb.x0));
  const ry0 = med(cells.map((x) => x.bb.y0));
  const rw = med(cells.map((x) => x.bb.w));
  const rh = med(cells.map((x) => x.bb.h));
  report.push(`  参考框 ${rw}x${rh} @(${rx0},${ry0})`);

  const FACE = 512;
  const headFrac = 0.62; // 头顶到上半身，够看表情和领结
  const cropH = Math.round(rh * headFrac);
  const cropW = Math.min(cw, Math.round(cropH * 1.0));
  const cx = Math.round(rx0 + rw / 2 - cropW / 2);
  const cy = Math.max(0, ry0 - 4);

  const names = ['idle', 'happy', 'sleepy', 'thinking', 'angry', 'cry'];
  const previews = [];

  cells.forEach(({ cell }, idx) => {
    const cut = { width: cropW, height: cropH, data: new Uint8Array(cropW * cropH * 4) };
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const sx = x + cx, sy = y + cy;
        if (sx < 0 || sy < 0 || sx >= cw || sy >= ch) continue;
        const s = (sy * cw + sx) * 4;
        const t = (y * cropW + x) * 4;
        cut.data[t] = cell.data[s];
        cut.data[t + 1] = cell.data[s + 1];
        cut.data[t + 2] = cell.data[s + 2];
        cut.data[t + 3] = cell.data[s + 3];
      }
    }
    const sq = normalize(cut, { W: FACE, H: FACE, heightFrac: 1.0, bottomFrac: 0.0 });
    fadeBottom(sq, 0.16); // 底部软收边，当头像用时不会出现一刀切的断面
    if (!diag) savePNG(sq, path.join(OUT, 'face', `expr_${idx + 1}_${names[idx]}.png`));
    previews.push(sq);
  });

  // 3. 动作图 / 道具图：保留原构图，只去底，缩到 720 够气泡里显示
  const shots = [...FILES.acts, ...FILES.props];
  for (const [id, f] of shots) {
    const img = loadRGBA(path.join(SRC, f));
    const bg = removeWhiteBg(img, 24);
    applyMask(img, bg);
    const small = resizeRGBA(img, 720, 720);
    if (!diag) savePNG(small, path.join(OUT, 'shots', `${id}.png`));
    report.push(`[配图] ${id}  ${img.width}x${img.height} -> 720x720`);
  }

  // 4. 清单：把锚点和尺寸写清楚，前端直接读，不用猜
  if (!diag) {
    const ib = bbox(idle);
    const manifest = {
      generatedAt: new Date().toISOString(),
      source: SRC,
      canvas: { body: { w: 1024, h: 1024 } },
      body: { idle: 'body/idle.png' },
      face: {
        idle: 'face/expr_1_idle.png',
        happy: 'face/expr_2_happy.png',
        sleepy: 'face/expr_3_sleepy.png',
        thinking: 'face/expr_4_thinking.png',
        angry: 'face/expr_5_angry.png',
        cry: 'face/expr_6_cry.png',
      },
      shots: {
        done: 'shots/done.png',
        rest: 'shots/rest.png',
        work: 'shots/work.png',
        trust: 'shots/trust.png',
        dispatch: 'shots/dispatch.png',
        memory: 'shots/memory.png',
      },
      anchors: {
        // 归一化坐标（0-1），相对于 body/idle.png 画布
        foot: [
          +((ib.x0 + ib.w / 2) / idle.width).toFixed(4),
          +((ib.y1 + 1) / idle.height).toFixed(4),
        ],
        headTop: [
          +((ib.x0 + ib.w / 2) / idle.width).toFixed(4),
          +(ib.y0 / idle.height).toFixed(4),
        ],
        charHeightFrac: +(ib.h / idle.height).toFixed(4),
      },
      notes: [
        'body/idle.png 是唯一按 1024 画布归一化过的站姿图，角色高 80%、脚底距底 5%、水平居中到身体中线。',
        'face/*.png 六张共用同一个裁切框，切换表情时不会跳位；底部 16% 渐隐。',
        'shots/*.png 保留原构图与手写标题，用于气泡配图，不参与状态切换。',
        '所有图均为透明底 PNG，白边已用收缩 1px + alpha 羽化处理。',
      ],
    };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    report.push('[清单] assets/states/manifest.json');

    const html = `<!doctype html>
<meta charset="utf-8">
<title>赫尔墨兹素材预览</title>
<style>
  body{margin:0;padding:32px;font:14px/1.6 system-ui,"Segoe UI",sans-serif;color:#1a1a1a;
       background-color:#faf9f7;
       background-image:linear-gradient(45deg,#e8e6e1 25%,transparent 25%,transparent 75%,#e8e6e1 75%),
                        linear-gradient(45deg,#e8e6e1 25%,transparent 25%,transparent 75%,#e8e6e1 75%);
       background-size:24px 24px;background-position:0 0,12px 12px}
  h1{font-size:17px;font-weight:600;margin:0 0 4px}
  h2{font-size:14px;font-weight:600;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid #ddd}
  p.sub{margin:0 0 24px;color:#666;font-size:13px}
  .row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end}
  figure{margin:0;text-align:center}
  figure img{display:block;background:transparent}
  figcaption{font-size:12px;color:#666;margin-top:6px}
  .body img{width:300px}
  .face img{width:150px}
  .shot img{width:210px}
  .note{margin-top:36px;padding:14px 16px;background:#fff;border:1px solid #e5e3de;border-radius:8px;
        font-size:13px;color:#444}
  .note b{font-weight:600}
</style>
<h1>赫尔墨兹 · 桌宠素材</h1>
<p class="sub">背景是棋盘格，能看见格子的地方就是透明区域</p>

<h2>站姿主形象 · 1024 画布，角色高 80%，脚底距底 5%</h2>
<div class="row body"><figure><img src="body/idle.png"><figcaption>idle</figcaption></figure></div>

<h2>六表情 · 512 方形，共用同一裁切框</h2>
<div class="row face">
  <figure><img src="face/expr_1_idle.png"><figcaption>平常</figcaption></figure>
  <figure><img src="face/expr_2_happy.png"><figcaption>开心</figcaption></figure>
  <figure><img src="face/expr_3_sleepy.png"><figcaption>困</figcaption></figure>
  <figure><img src="face/expr_4_thinking.png"><figcaption>思考</figcaption></figure>
  <figure><img src="face/expr_5_angry.png"><figcaption>不满</figcaption></figure>
  <figure><img src="face/expr_6_cry.png"><figcaption>委屈</figcaption></figure>
</div>

<h2>场景配图 · 720 方形，保留原构图与手写标题</h2>
<div class="row shot">
  <figure><img src="shots/done.png"><figcaption>done 搞定</figcaption></figure>
  <figure><img src="shots/rest.png"><figcaption>rest 歇一下</figcaption></figure>
  <figure><img src="shots/work.png"><figcaption>work 赶工</figcaption></figure>
  <figure><img src="shots/trust.png"><figcaption>trust 交给我吧</figcaption></figure>
  <figure><img src="shots/dispatch.png"><figcaption>dispatch 我来调度</figcaption></figure>
  <figure><img src="shots/memory.png"><figcaption>memory 记忆存好了</figcaption></figure>
</div>

<div class="note">
  <b>用法分三档，各管各的尺度：</b><br>
  站姿图负责"站在那里"，六表情负责"表情和情绪"，场景图负责"说一句话时贴一张图"。<br>
  三者不需要互相对齐，因为它们从不出现在同一帧里。
</div>
`;
    fs.writeFileSync(path.join(OUT, '_preview.html'), html, 'utf8');
    report.push('[预览] assets/states/_preview.html');
  }

  console.log(report.join('\n'));
}

main();
