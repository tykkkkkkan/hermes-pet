/**
 * build-pet-3d.js —— 把平面立绘"打光"成有体积感的桌面精灵素材
 *
 * 关键判断：赫尔墨兹是银发白裙的浅色角色。
 * 对浅色角色一律"加光"只会把细节烧平（白发、翅膀会变成白团）。
 * 所以这里走的是相反的路子 —— 加"遮蔽"：
 *
 *   1. 烘焙 AO（环境光遮蔽）：用灰度当高度场，凹陷处压暗，褶皱/发缝/裙下自然出层次
 *   2. 选择性边缘光：只给暗部（帽子、披风、鞋）勾轮廓光，亮部跳过，不破坏细节
 *   3. 底部沉降：轻微压暗下半身，制造"站在地上"的坠落感
 *   4. 分离 FX 层：整体落影、贴地接触影、背后泛光，交给 CSS 做动画
 *
 * 全程纯像素运算，不改人物造型、不重绘。
 *
 * 用法： node tools/build-pet-3d.js
 * 输入： .bak-flat/（存在则优先，保证可反复重跑不叠加）
 *       否则 assets/states/body/idle.png、assets/states/face/expr_*.png
 * 输出： assets/states/body、assets/states/face 原地覆盖 + assets/states/fx/*
 *
 * 依赖： pngjs
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const STATES = path.join(ROOT, 'assets', 'states');
const BAK = path.join(ROOT, '.bak-flat');

/* ---------------------------------------------------------------- 基础工具 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const readPNG = (p) => PNG.sync.read(fs.readFileSync(p));

function writePNG(p, png) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PNG.sync.write(png, { colorType: 6, deflateLevel: 9 }));
}

/** 可分离盒式模糊，多次叠加≈高斯。单通道 Float64Array */
function blur2D(src, w, h, r, passes = 3) {
  if (r <= 0) return Float64Array.from(src);
  const buf = Float64Array.from(src);
  const tmp = new Float64Array(w * h);
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const off = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += buf[off + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[off + x] = sum / win;
        sum += buf[off + clamp(x + r + 1, 0, w - 1)] - buf[off + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        buf[y * w + x] = sum / win;
        sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return buf;
}

function channel(png, which) {
  const { width: w, height: h, data } = png;
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    out[i] = which === 'alpha'
      ? data[o + 3] / 255
      : (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
  }
  return out;
}

function alphaBBox(png) {
  const { width: w, height: h, data } = png;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/* ------------------------------------------------------- 去底清理（前置） */

/**
 * AI 出图常见的两类底残留，深色桌面上都会露馅：
 *   1. 腿缝 / 胳膊缝里塞着纯白不透明像素 → 露出一道白楔子
 *   2. 脚下那块给白底准备的"浅灰影子" → 在深色壁纸上变成一块白斑
 * 这里都清掉，影子交给 fx/contact.png 重新生成。
 */
function deBackground(png, footX, footY, log = console.log) {
  const w = png.width, h = png.height, d = png.data;
  const cx = Math.round(footX * w);
  let wedge = 0;

  const isWhite = (x, y) => {
    const o = (y * w + x) * 4;
    if (d[o + 3] < 248) return false;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.955 && Math.max(r, g, b) - Math.min(r, g, b) < 9;
  };
  const isDark = (x, y) => {
    const o = (y * w + x) * 4;
    if (d[o + 3] < 200) return false;
    return (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255 < 0.5;
  };

  // ---- 1. 中线白楔 ----
  const yStart = Math.round(h * 0.6);
  const yEnd = Math.round(footY * h) - 6;
  for (let y = yStart; y <= yEnd; y++) {
    if (!isWhite(cx, y)) continue;
    let l = cx, r = cx;
    while (l > 0 && isWhite(l - 1, y)) l--;
    while (r < w - 1 && isWhite(r + 1, y)) r++;
    // 太宽的不是缝，是衣服
    if (r - l > w * 0.14) continue;
    // 左右各向外找 10px 内是否有暗边，有才算被夹住的缝
    const darkNear = (x0, dir) => {
      for (let k = 1; k <= 10; k++) {
        const x = x0 + dir * k;
        if (x < 0 || x >= w) return false;
        if (isDark(x, y)) return true;
      }
      return false;
    };
    if (!darkNear(l, -1) || !darkNear(r, 1)) continue;
    for (let x = l; x <= r; x++) {
      const o = (y * w + x) * 4;
      d[o + 3] = 0;
      wedge++;
    }
  }
  if (wedge) log(`[clean] 清除腿缝白楔 ${wedge} px`);

  // ---- 2. 脚下浅色假影子：只在鞋底那一窄带、且只在鞋子左右两侧之外 ----
  //      这块区域除影子外不该有任何东西，所以可以无条件清掉，不会误伤高光
  const yb0 = Math.max(0, Math.round(footY * h - h * 0.035));
  let shoeX0 = w, shoeX1 = -1;
  for (let y = Math.round(footY * h - h * 0.05); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (d[o + 3] > 200 && (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255 < 0.45) {
        if (x < shoeX0) shoeX0 = x;
        if (x > shoeX1) shoeX1 = x;
      }
    }
  }
  let ghost = 0;
  if (shoeX1 > 0) {
    // 先按列找"鞋子最低点"，它下面一律清掉；空列（两鞋之间）整条带清掉
    const shoeBot = new Int32Array(w).fill(-1);
    for (let y = Math.round(footY * h - h * 0.05); y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (d[o + 3] > 200 && (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255 < 0.45) {
          shoeBot[x] = y;
        }
      }
    }
    for (let y = yb0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inFoot = x >= shoeX0 - 1 && x <= shoeX1 + 1;
        if (inFoot && shoeBot[x] >= 0 && y <= shoeBot[x]) continue; // 鞋身本体，保留
        const o = (y * w + x) * 4;
        if (d[o + 3] > 0) { d[o + 3] = 0; ghost++; }
      }
    }
  }
  if (ghost) log(`[clean] 清除脚下白影子 ${ghost} px（鞋底带 ${yb0}~${h - 1}，鞋位于 x ${shoeX0}~${shoeX1}）`);
}

/* -------------------------------------------------------------- 立体化核心 */

function sculpt(png, opt = {}) {
  const o = Object.assign(
    {
      clarity: 0.62,    // 局部对比（清晰度）：这是立体感的主力，不是压暗
      ao: 0.55,         // 凹陷遮蔽权重，只压真正的凹槽，不压整体
      aoMax: 0.26,
      light: 0.10,      // 左上主光的整体明暗起伏
      rim: 0.45,        // 边缘光（只作用于暗部）
      rimDarkMax: 0.55,
      sink: 0.05,       // 底部沉降
      sat: 1.12,        // 饱和度补偿
      rimColor: [232, 241, 255],
    },
    opt
  );

  const w = png.width, h = png.height;
  const src = png.data;
  const out = Buffer.from(src);

  const alpha = channel(png, 'alpha');
  const lum = channel(png, 'lum');

  const rDetail = Math.max(2, Math.round(w / 260));  // 1024→4, 512→2
  const rCavity = Math.max(5, Math.round(w / 90));   // 1024→11, 512→6
  const lumDetail = blur2D(lum, w, h, rDetail, 3);
  const lumCavity = blur2D(lum, w, h, rCavity, 3);

  // 高度场（用于主光方向的法线）
  const height = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = lum[i] * alpha[i];
  const hS = blur2D(height, w, h, Math.max(3, Math.round(w / 160)), 3);

  // 边缘光窄带
  const rimR = Math.max(2, Math.round(w / 280));
  const aBlur = blur2D(alpha, w, h, rimR, 2);

  const L = (() => {
    const v = [-0.40, -0.62, 0.68];
    const len = Math.hypot(...v);
    return v.map((x) => x / len);
  })();

  for (let y = 0; y < h; y++) {
    const yn = h > 1 ? y / (h - 1) : 0;
    const sinkMul = 1 - o.sink * smoothstep(0.5, 1.0, yn);

    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i];
      if (a <= 0.004) continue;
      const o4 = i * 4;
      const v = lum[i];

      // ---- 1. 清晰度：把细节从它自己的模糊版里拉出来 ----
      //      v' = v + k * (v - blur(v))，白的地方仍然是白，只是过渡更硬
      //      按梯度加权：只拉柔和明暗过渡，不碰线稿硬边，避免边缘拉毛
      const raw = v - lumDetail[i];
      const guard = 1 - smoothstep(0.055, 0.16, Math.abs(raw));
      const detail = clamp(raw, -0.12, 0.12) * guard;
      let nv = v + o.clarity * detail;

      // ---- 2. 凹陷遮蔽：只处理"明显低于周边"的窄区，权重小、上限低 ----
      const cavity = clamp((lumCavity[i] - v) * 3.0, 0, 1);
      nv *= 1 - o.ao * cavity * o.aoMax * 3.4;

      // ---- 3. 左上主光：用平滑高度场算法线，只做整体起伏 ----
      const gx = S2(hS, w, h, x + 1, y) - S2(hS, w, h, x - 1, y);
      const gy = S2(hS, w, h, x, y + 1) - S2(hS, w, h, x, y - 1);
      let nx = clamp(-gx * 1.8, -0.6, 0.6);
      let ny = clamp(-gy * 1.8, -0.6, 0.6);
      const nl = Math.hypot(nx, ny, 1);
      const diff = clamp((nx / nl) * L[0] + (ny / nl) * L[1] + (1 / nl) * L[2], 0, 1);
      nv *= 1 + (diff - 0.62) * o.light * 2.0;

      nv = clamp(nv, 0.02, 1.35) * sinkMul;

      // 按亮度比例缩放 RGB，保住色相
      const ratio = clamp(nv / Math.max(v, 0.012), 0.45, 1.9);
      let r = src[o4] * ratio;
      let g = src[o4 + 1] * ratio;
      let b = src[o4 + 2] * ratio;

      // 比例缩放会顺带掉一点饱和，这里补回来
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * o.sat;
      g = gray + (g - gray) * o.sat;
      b = gray + (b - gray) * o.sat;

      // ---- 4. 边缘光：只给暗部勾轮廓，亮部完全跳过 ----
      const band = clamp((a - aBlur[i]) * 2.8, 0, 1);
      if (band > 0 && v < o.rimDarkMax) {
        const wgt = band * (1 - smoothstep(o.rimDarkMax * 0.5, o.rimDarkMax, v)) * o.rim;
        r += o.rimColor[0] * wgt;
        g += o.rimColor[1] * wgt;
        b += o.rimColor[2] * wgt;
      }

      out[o4] = clamp(r, 0, 255);
      out[o4 + 1] = clamp(g, 0, 255);
      out[o4 + 2] = clamp(b, 0, 255);
    }
  }

  const res = new PNG({ width: w, height: h });
  out.copy(res.data);
  return res;
}

const S2 = (arr, w, h, x, y) => arr[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];

/* ------------------------------------------------------------ FX 分离图层 */

/**
 * 整体落影：把轮廓沿竖直方向压扁到脚底平面，再模糊。
 * 直接平移整张轮廓会得到"第二个人"的观感，压扁后才像光从上方打下来的投影。
 */
function makeShadow(png, footY, { dx = 8, dy = 4, squash = 0.34, blur = 20, opacity = 0.42 } = {}) {
  const w = png.width, h = png.height;
  const alpha = channel(png, 'alpha');
  const gy = footY * h;

  // 前向映射 + 取最大值，避免压扁后出现空洞
  const acc = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (a <= 0.004) continue;
      const ty = Math.round(gy + (y - gy) * squash + dy);
      const tx = Math.round(x + dx);
      if (ty < 0 || ty >= h || tx < 0 || tx >= w) continue;
      const idx = ty * w + tx;
      if (a > acc[idx]) acc[idx] = a;
    }
  }

  const soft = blur2D(acc, w, h, blur, 3);
  // 离脚底越远越淡
  const res = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const fade = 1 - 0.55 * smoothstep(gy, gy + h * 0.16, y);
    for (let x = 0; x < w; x++) {
      const a = soft[y * w + x] * opacity * fade;
      if (a <= 0.002) continue;
      const o = (y * w + x) * 4;
      res.data[o] = 10; res.data[o + 1] = 12; res.data[o + 2] = 20;
      res.data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  return res;
}

function makeContact(png, anchor, { rx = 0.118, ry = 0.026, opacity = 0.66 } = {}) {
  const w = png.width, h = png.height;
  const cx = anchor[0] * w, cy = anchor[1] * h;
  const RX = rx * w, RY = ry * h;
  const res = new PNG({ width: w, height: h });
  const x0 = Math.max(0, Math.floor(cx - RX * 3)), x1 = Math.min(w - 1, Math.ceil(cx + RX * 3));
  const y0 = Math.max(0, Math.floor(cy - RY * 3)), y1 = Math.min(h - 1, Math.ceil(cy + RY * 3));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x - cx) / RX, (y - cy) / RY);
      const a = Math.exp(-d * d * 1.15) * opacity;
      if (a < 0.004) continue;
      const o = (y * w + x) * 4;
      res.data[o] = 6; res.data[o + 1] = 8; res.data[o + 2] = 14;
      res.data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  return res;
}

function makeHalo(png, anchor, { color = [122, 160, 255], opacity = 0.22 } = {}) {
  const w = png.width, h = png.height;
  const cx = anchor[0] * w, cy = h * 0.46, R = w * 0.46;
  const res = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - cx) / R, (y - cy) / (R * 1.06));
      const a = Math.pow(clamp(1 - d, 0, 1), 2.4) * opacity;
      if (a < 0.004) continue;
      const o = (y * w + x) * 4;
      res.data[o] = color[0]; res.data[o + 1] = color[1]; res.data[o + 2] = color[2];
      res.data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  return res;
}

/* ------------------------------------------------------------- 合成对比图 */

/** 在深色桌面上把各层叠起来，输出对比图（左=平涂，右=立体） */
function makeCompare(flat, lit, fx, anchor) {
  const w = lit.width, h = lit.height;
  const res = new PNG({ width: w * 2, height: h });
  const contact = fx.contact, shadow = fx.shadow, halo = fx.halo;

  for (let side = 0; side < 2; side++) {
    const srcImg = side === 0 ? flat : lit;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xn = x / w, yn = y / h;
        // 深色桌面：对角渐变 + 一点噪点感
        let br = 22 + 26 * (1 - yn) + 8 * Math.sin(xn * 6.0);
        let bg = 26 + 26 * (1 - yn) + 6 * Math.sin(xn * 6.0);
        let bb = 38 + 34 * (1 - yn);
        let cr = br, cg = bg, cb = bb; // 当前合成色

        const put = (img, opacity = 1, blend = 'normal') => {
          if (!img) return;
          const o = (y * w + x) * 4;
          const a = (img.data[o + 3] / 255) * opacity;
          if (a <= 0) return;
          const sr = img.data[o], sg = img.data[o + 1], sb = img.data[o + 2];
          if (blend === 'screen') {
            cr = 255 - ((255 - cr) * (255 - sr)) / 255;
            cg = 255 - ((255 - cg) * (255 - sg)) / 255;
            cb = 255 - ((255 - cb) * (255 - sb)) / 255;
            // screen 后再按 a 混回背景
            cr = bg + (cr - bg) * a; cg = bg + (cg - bg) * a; cb = bb + (cb - bb) * a;
          } else {
            cr = cr * (1 - a) + sr * a;
            cg = cg * (1 - a) + sg * a;
            cb = cb * (1 - a) + sb * a;
          }
        };

        if (side === 1) {
          put(halo, 0.9, 'screen');
          put(shadow, 1);
        }
        put(srcImg, 1);
        if (side === 1) put(contact, 1);

        const o = (y * w * 2 + side * w + x) * 4;
        res.data[o] = clamp(cr, 0, 255);
        res.data[o + 1] = clamp(cg, 0, 255);
        res.data[o + 2] = clamp(cb, 0, 255);
        res.data[o + 3] = 255;
      }
    }
  }
  return res;
}

/* ------------------------------------------------------------------ 主流程 */

let m_shotMeta = {};

function main() {
  const srcBody = fs.existsSync(path.join(BAK, 'body', 'idle.png'))
    ? path.join(BAK, 'body', 'idle.png')
    : path.join(STATES, 'body', 'idle.png');
  const body = readPNG(srcBody);
  console.log(`[body] 源 ${srcBody}  ${body.width}x${body.height}`);

  const bb = alphaBBox(body);
  const footX = (bb.x0 + bb.x1) / 2 / body.width;
  const footY = bb.y1 / body.height;
  const headY = bb.y0 / body.height;
  console.log(`[body] bbox y ${bb.y0}→${bb.y1}  foot=(${footX.toFixed(4)}, ${footY.toFixed(4)})  charH=${(footY - headY).toFixed(4)}`);

  // 0. 去底清理：腿缝白楔 + 脚下浅色假影子
  deBackground(body, footX, footY);

  const litBody = sculpt(body, { clarity: 0.62, ao: 0.55, light: 0.10, rim: 0.45, sink: 0.05 });
  writePNG(path.join(STATES, 'body', 'idle.png'), litBody);
  console.log('[body] 重打光完成');

  const fxDir = path.join(STATES, 'fx');
  const shadow = makeShadow(body, footY, { dx: 4, dy: 3, squash: 0.30, blur: 22, opacity: 0.40 });
  const contact = makeContact(body, [footX, footY], { rx: 0.118, ry: 0.026, opacity: 0.68 });
  const halo = makeHalo(body, [footX, 0.46], { opacity: 0.22 });
  writePNG(path.join(fxDir, 'shadow.png'), shadow);
  writePNG(path.join(fxDir, 'contact.png'), contact);
  writePNG(path.join(fxDir, 'halo.png'), halo);
  console.log('[fx] shadow / contact / halo 完成');

  const faceDir = path.join(STATES, 'face');
  const faceBak = path.join(BAK, 'face');
  const faces = (fs.existsSync(faceBak) ? fs.readdirSync(faceBak) : fs.readdirSync(faceDir))
    .filter((f) => /^expr_.*\.png$/i.test(f));
  for (const f of faces) {
    const src = fs.existsSync(path.join(faceBak, f)) ? path.join(faceBak, f) : path.join(faceDir, f);
    const img = readPNG(src);
    const done = sculpt(img, { clarity: 0.5, ao: 0.45, light: 0.08, rim: 0.3, sink: 0.03 });
    writePNG(path.join(faceDir, f), done);
    console.log(`[face] ${f} 完成`);
  }

  // ---- 场景配图：参数再收敛一档 ----
  // 它们自带透视、道具和手写标题，压太狠会跟标题打架；只做"提清晰 + 轻微体积"
  const shotDir = path.join(STATES, 'shots');
  const shotBak = path.join(BAK, 'shots');
  const shots = (fs.existsSync(shotBak) ? fs.readdirSync(shotBak) : fs.readdirSync(shotDir))
    .filter((f) => /\.png$/i.test(f));
  for (const f of shots) {
    const src = fs.existsSync(path.join(shotBak, f)) ? path.join(shotBak, f) : path.join(shotDir, f);
    const img = readPNG(src);
    const done = sculpt(img, { clarity: 0.45, ao: 0.40, light: 0.06, rim: 0.22, sink: 0, sat: 1.0, aoMax: 0.22 });
    writePNG(path.join(shotDir, f), done);
    const sb = alphaBBox(img);
    m_shotMeta[path.basename(f, '.png')] = {
      w: img.width, h: img.height,
      bbox: [sb.x0, sb.y0, sb.x1, sb.y1],
      charHeightFrac: Number(((sb.y1 - sb.y0) / img.height).toFixed(3)),
    };
    console.log(`[shots] ${f} 完成 (${img.width}x${img.height})`);
  }

  // 对比图
  const flatBody = readPNG(srcBody);
  writePNG(path.join(STATES, '_compare-3d.png'), makeCompare(flatBody, litBody, { shadow, contact, halo }, [footX, footY]));
  console.log('[preview] _compare-3d.png 已生成');

  const mPath = path.join(STATES, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  m.generatedAt = new Date().toISOString();
  m.body = { idle: 'body/idle.png' };
  m.fx = { shadow: 'fx/shadow.png', contact: 'fx/contact.png', halo: 'fx/halo.png' };
  m.shotMeta = m_shotMeta;
  m.anchors = {
    foot: [Number(footX.toFixed(4)), Number(footY.toFixed(4))],
    headTop: [Number(footX.toFixed(4)), Number(headY.toFixed(4))],
    charHeightFrac: Number((footY - headY).toFixed(4)),
  };
  m.layers = [
    { src: 'fx/halo.png', blend: 'screen', opacity: 0.55, note: '背后泛光，随呼吸轻微缩放' },
    { src: 'fx/shadow.png', blend: 'normal', opacity: 1, note: '压扁贴地的整体落影，随呼吸缩放变淡' },
    { src: 'body/idle.png', blend: 'normal', opacity: 1, note: '主体，已烘焙清晰度/遮蔽/暗部边缘光' },
    { src: 'body/idle.png', blend: 'screen', opacity: '0.85（用 alpha 做遮罩）', note: '玻璃高光扫过，用主图 alpha 当 mask 叠一条移动的白色斜带' },
    { src: 'fx/contact.png', blend: 'normal', opacity: 1, note: '贴地接触影，压在最上层底部' },
  ];
  m.notes = [
    '立体化方式：去底清理 + 清晰度（梯度加权）+ 凹陷遮蔽 + 左上主光 + 暗部边缘光 + 底部沉降，纯像素运算，未改动人物造型。',
    '浅色角色不能靠加光提立体感——白发和白翅膀会被烧成白团，所以边缘光只作用于亮度 < 0.55 的暗部。',
    '原图腿缝里有 8161px 纯白不透明像素、脚下有 1906px 浅灰假影子，深色壁纸上分别是白楔子和白斑，已清除。',
    'face/*.png 六张共用同一裁切框，同样做了轻量立体化，切表情不跳位。',
    'shots/*.png 也做了轻量立体化（清晰度 0.45 / 边缘光 0.22 / 不做沉降），保留原构图与手写标题。',
    'fx/*.png 按 layers 顺序叠加即得桌面立体效果；锚点 foot 为脚底中心。',
    '参考仓库 deepseek-fish-pet 的桌面呈现其实是单张平面 PNG + 挤压拉伸动画，不是真 3D，见 docs/指令-03-立体化接入.md。',
  ];
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
  console.log('[manifest] 已更新');
}

main();
