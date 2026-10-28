/* 从角色原立绘裁一枚圆形头像，供聊天窗标题栏与空态使用。
 *
 * 立绘是 818x1342 的整身图，直接当头像会缩成一根竖条；
 * 这里先求不透明像素的包围盒，再取「顶部 30% 高度的正方形」，
 * 正好框住帽子 + 脸 + 一点肩，缩放后裁成圆形。
 *
 * 用法：node tools/make-avatar.js [ratio] [size]
 */
const path = require('path');
const { readPNG, writePNG, blank } = require('./lib/imgutil');

const SRC = path.join(__dirname, '..', 'assets', 'hermes-chibi.png');
const OUT = path.join(__dirname, '..', 'assets', 'ui', 'avatar.png');

const ratio = Number(process.argv[2]) || 0.3;
const size = Number(process.argv[3]) || 192;
// 包围盒顶部是帽檐，直接从这里开框只会拍到帽子；往下让出这个比例才框得住脸
const offset = process.argv[4] != null ? Number(process.argv[4]) : 0.1;

function alphaBox(png) {
  const { data, width: W, height: H } = png;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/* 双线性缩放：头像最终只有一两百像素，最近邻会有锯齿 */
function resize(src, x0, y0, sw, sh, dw, dh) {
  const out = blank(dw, dh);
  const S = src.data, W = src.width;
  for (let y = 0; y < dh; y++) {
    const sy = y0 + ((y + 0.5) * sh) / dh - 0.5;
    const y1 = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
    const y2 = Math.min(src.height - 1, y1 + 1);
    const fy = Math.max(0, Math.min(1, sy - y1));
    for (let x = 0; x < dw; x++) {
      const sx = x0 + ((x + 0.5) * sw) / dw - 0.5;
      const x1 = Math.max(0, Math.min(W - 1, Math.floor(sx)));
      const x2 = Math.min(W - 1, x1 + 1);
      const fx = Math.max(0, Math.min(1, sx - x1));
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p11 = S[(y1 * W + x1) * 4 + c];
        const p12 = S[(y1 * W + x2) * 4 + c];
        const p21 = S[(y2 * W + x1) * 4 + c];
        const p22 = S[(y2 * W + x2) * 4 + c];
        const top = p11 + (p12 - p11) * fx;
        const bot = p21 + (p22 - p21) * fx;
        out.data[o + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return out;
}

/* 圆形裁切，边缘做 1.5px 羽化，避免缩放后出现硬锯齿 */
function circleMask(png) {
  const { width: W, height: H, data } = png;
  const R = W / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - R, y + 0.5 - R);
      const edge = R - 1.5;
      const k = d <= edge ? 1 : d >= R ? 0 : (R - d) / (R - edge);
      data[(y * W + x) * 4 + 3] = Math.round(data[(y * W + x) * 4 + 3] * k);
    }
  }
  return png;
}

const src = readPNG(SRC);
const box = alphaBox(src);
const bodyH = box.y1 - box.y0 + 1;
const bodyW = box.x1 - box.x0 + 1;
const side = Math.round(bodyH * ratio);
const cx = (box.x0 + box.x1) / 2;

let x0 = Math.round(cx - side / 2);
let y0 = Math.round(box.y0 + bodyH * offset);
x0 = Math.max(0, Math.min(src.width - side, x0));
y0 = Math.max(0, Math.min(src.height - side, y0));

const cut = resize(src, x0, y0, side, side, size, size);
circleMask(cut);
writePNG(OUT, cut);

console.log(
  `立绘 ${bodyW}x${bodyH} → 头部框 ${side}x${side} @(${x0},${y0}) → ${size}x${size}  ${OUT}`
);
