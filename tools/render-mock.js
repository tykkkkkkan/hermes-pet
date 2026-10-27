/**
 * render-mock.js —— 把素材按"桌面实际效果"合成出来，用于验证观感
 *
 * 左边：直接贴原图（无任何处理）
 * 右边：贴处理后的图 + 落影 + 贴地影 + 泛光 + 玻璃高光扫过
 *
 * 仅用于看效果，不参与打包。输出 assets/states/_mock-desktop.png
 *
 * 用法： node tools/render-mock.js
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const STATES = path.join(ROOT, 'assets', 'states');
const BAK = path.join(ROOT, '.bak-flat');

const W = 1600, H = 900;
const FOOT_Y = 700;       // 脚底落在桌面上的 y
const CHAR_H = 360;       // 角色显示高度
const CANVAS = 1024;
const SCALE = CHAR_H / (0.7998 * CANVAS);
const DRAW = CANVAS * SCALE;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function load(p) {
  return PNG.sync.read(fs.readFileSync(p));
}

/** 双线性采样，返回 [r,g,b,a] a∈0..1 */
function sample(img, fx, fy) {
  const { width: w, height: h, data } = img;
  if (fx < -1 || fy < -1 || fx > w || fy > h) return [0, 0, 0, 0];
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const get = (x, y) => {
    const xx = clamp(x, 0, w - 1), yy = clamp(y, 0, h - 1);
    const o = (yy * w + xx) * 4;
    return [data[o], data[o + 1], data[o + 2], data[o + 3] / 255];
  };
  const p00 = get(x0, y0), p10 = get(x0 + 1, y0), p01 = get(x0, y0 + 1), p11 = get(x0 + 1, y0 + 1);
  const mix = (i) =>
    (p00[i] * (1 - tx) + p10[i] * tx) * (1 - ty) + (p01[i] * (1 - tx) + p11[i] * tx) * ty;
  return [mix(0), mix(1), mix(2), mix(3)];
}

function main() {
  const flat = load(path.join(BAK, 'body', 'idle.png'));
  const body = load(path.join(STATES, 'body', 'idle.png'));
  const shadow = load(path.join(STATES, 'fx', 'shadow.png'));
  const contact = load(path.join(STATES, 'fx', 'contact.png'));
  const halo = load(path.join(STATES, 'fx', 'halo.png'));

  const out = new PNG({ width: W, height: H });
  const buf = out.data;

  // ---------- 壁纸 ----------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const yn = y / H, xn = x / W;
      // 竖向渐变：上方偏冷的浅灰蓝 → 下方偏暖的灰
      let r = 232 - 44 * yn;
      let g = 238 - 46 * yn;
      let b = 245 - 40 * yn;
      // 左上角一团柔光
      const d1 = Math.hypot(xn - 0.22, yn - 0.18) / 0.55;
      const gl = Math.pow(clamp(1 - d1, 0, 1), 2.2);
      r += 18 * gl; g += 16 * gl; b += 10 * gl;
      // 右下角一点暗角
      const d2 = Math.hypot(xn - 0.85, yn - 0.88) / 0.6;
      const vg = Math.pow(clamp(1 - d2, 0, 1), 2.0);
      r -= 26 * vg; g -= 28 * vg; b -= 24 * vg;
      // 极细噪点，避免带状
      const n = ((x * 37 + y * 17) % 7) - 3;
      const o = (y * W + x) * 4;
      buf[o] = clamp(r + n * 0.4, 0, 255);
      buf[o + 1] = clamp(g + n * 0.4, 0, 255);
      buf[o + 2] = clamp(b + n * 0.4, 0, 255);
      buf[o + 3] = 255;
    }
  }

  const centers = [460, 1130]; // 左：原图  右：处理版

  const composite = (cx, layers) => {
    const offX = cx - DRAW / 2;
    const offY = FOOT_Y - 0.9492 * DRAW;
    for (let y = Math.floor(offY) - 10; y < Math.min(H, offY + DRAW + 40); y++) {
      for (let x = Math.floor(offX) - 10; x < Math.min(W, offX + DRAW + 10); x++) {
        if (x < 0 || y < 0) continue;
        const o = (y * W + x) * 4;
        let cr = buf[o], cg = buf[o + 1], cb = buf[o + 2];

        for (const L of layers) {
          const sx = (x - offX - (L.dx || 0)) / SCALE;
          const sy = (y - offY - (L.dy || 0)) / SCALE;
          const [r, g, b, a0] = sample(L.img, sx, sy);
          if (a0 <= 0.001) continue;
          let a = a0 * (L.opacity === undefined ? 1 : L.opacity);

          // 玻璃高光：只在有像素的地方按斜向条带叠加
          if (L.gloss) {
            const t = ((x - offX) * 0.55 + (y - offY) * 0.45) / DRAW;
            const band = smoothstep(0.225, 0.265, t) * (1 - smoothstep(0.285, 0.325, t));
            const add = band * 0.40 * a0;
            cr = 255 - (255 - cr) * (1 - add);
            cg = 255 - (255 - cg) * (1 - add);
            cb = 255 - (255 - cb) * (1 - add);
            continue;
          }

          if (L.blend === 'screen') {
            const sr = 255 - (255 - cr) * (255 - r) / 255;
            const sg = 255 - (255 - cg) * (255 - g) / 255;
            const sb = 255 - (255 - cb) * (255 - b) / 255;
            cr = cr + (sr - cr) * a;
            cg = cg + (sg - cg) * a;
            cb = cb + (sb - cb) * a;
          } else {
            cr = cr * (1 - a) + r * a;
            cg = cg * (1 - a) + g * a;
            cb = cb * (1 - a) + b * a;
          }
        }
        buf[o] = clamp(cr, 0, 255);
        buf[o + 1] = clamp(cg, 0, 255);
        buf[o + 2] = clamp(cb, 0, 255);
        buf[o + 3] = 255;
      }
    }
  };

  // 左：原图裸贴
  composite(centers[0], [{ img: flat }]);

  // 右：完整图层栈
  composite(centers[1], [
    { img: halo, blend: 'screen', opacity: 0.32, dy: 6 },
    { img: shadow, dy: 10 },
    { img: body },
    { img: body, gloss: true },   // 玻璃高光扫过的静态帧
    { img: contact },
  ]);

  fs.writeFileSync(path.join(STATES, '_mock-desktop.png'), PNG.sync.write(out, { colorType: 6 }));
  console.log('[mock] _mock-desktop.png', W + 'x' + H, ' 角色高', CHAR_H + 'px');
}

main();
