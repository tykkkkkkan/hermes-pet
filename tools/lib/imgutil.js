/* 纯 JS 图像处理工具：PNG 读写、绿幕/黑底键控、包围盒、裁切、差分、羽化。
   只依赖 pngjs，不引入原生编译依赖。 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function readPNG(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function writePNG(file, png) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

function blank(w, h) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return png;
}

function clone(png) {
  const out = blank(png.width, png.height);
  png.data.copy(out.data);
  return out;
}

/* 绿幕键控：按绿色优势度判定背景，边缘像素做半透明 + 去绿溢色(despill) */
function keyoutGreen(png) {
  const { data, width: W, height: H } = png;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const dom = g - Math.max(r, b);
    if (dom > 45 && g > 80) {
      data[i + 3] = 0;
    } else if (dom > 10) {
      const t = Math.min(1, (dom - 10) / 35);
      data[i + 3] = Math.round(data[i + 3] * (1 - t));
      const m = Math.max(r, b);
      if (g > m) data[i + 1] = m;
    }
  }
  return png;
}

/* 黑底键控：从四边 flood fill 只吃掉与边缘连通的暗区，角色内部的暗色（黑袍）保留 */
function keyoutBlack(png, threshold = 30) {
  const { data, width: W, height: H } = png;
  const N = W * H;
  const seen = new Uint8Array(N);
  const stack = [];
  const dark = (p) => {
    const i = p * 4;
    return Math.max(data[i], data[i + 1], data[i + 2]) < threshold;
  };
  const seed = (p) => {
    if (!seen[p] && dark(p)) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p / W) | 0;
    if (x > 0) seed(p - 1);
    if (x < W - 1) seed(p + 1);
    if (y > 0) seed(p - W);
    if (y < H - 1) seed(p + W);
  }
  for (let p = 0; p < N; p++) if (seen[p]) data[p * 4 + 3] = 0;

  // 边缘黑晕处理：与背景相邻的角色像素若整体偏暗，按亮度给半透明，避免深色描边糊成一片
  const halo = [];
  for (let p = 0; p < N; p++) {
    if (seen[p]) continue;
    const x = p % W, y = (p / W) | 0;
    let touchesBg = false;
    if (x > 0 && seen[p - 1]) touchesBg = true;
    else if (x < W - 1 && seen[p + 1]) touchesBg = true;
    else if (y > 0 && seen[p - W]) touchesBg = true;
    else if (y < H - 1 && seen[p + W]) touchesBg = true;
    if (!touchesBg) continue;
    const i = p * 4;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 60) halo.push([p, lum]);
  }
  for (const [p, lum] of halo) {
    const i = p * 4;
    data[i + 3] = Math.round(data[i + 3] * Math.max(0.35, lum / 60));
  }
  return png;
}

/* 取主体连通域（从给定的种子点 flood fill），返回掩码；用来排除水印等离群元素 */
function mainMask(png, seedX, seedY) {
  const { data, width: W, height: H } = png;
  const N = W * H;
  const mask = new Uint8Array(N);
  const stack = [];
  const solid = (p) => data[p * 4 + 3] > 8;
  let sp = null;
  outer: for (let r = 0; r < Math.max(W, H); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = seedX + dx, y = seedY + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (solid(y * W + x)) { sp = y * W + x; break outer; }
      }
    }
  }
  if (sp == null) return mask;
  mask[sp] = 1;
  stack.push(sp);
  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p / W) | 0;
    const nbrs = [];
    if (x > 0) nbrs.push(p - 1);
    if (x < W - 1) nbrs.push(p + 1);
    if (y > 0) nbrs.push(p - W);
    if (y < H - 1) nbrs.push(p + W);
    for (const q of nbrs) {
      if (!mask[q] && solid(q)) { mask[q] = 1; stack.push(q); }
    }
  }
  return mask;
}

function bboxOfMask(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* 把主体以外的像素（水印、杂点）清掉 */
function isolateMain(png, seedX, seedY) {
  const mask = mainMask(png, seedX, seedY);
  const { data, width: W, height: H } = png;
  for (let p = 0; p < W * H; p++) if (!mask[p]) data[p * 4 + 3] = 0;
  const bb = bboxOfMask(mask, W, H);
  return { png, mask, bbox: bb };
}

function crop(png, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= png.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= png.width) continue;
      const si = (sy * png.width + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function shift(png, dx, dy) {
  const out = blank(png.width, png.height);
  for (let y = 0; y < png.height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= png.height) continue;
    for (let x = 0; x < png.width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= png.width) continue;
      const si = (sy * png.width + sx) * 4;
      const di = (y * png.width + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

/* 差异图：返回每像素 RGB 距离，用于定位「只改了眼睛/嘴巴」的区域 */
function diffMap(a, b) {
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      if (a.data[i + 3] < 16 || b.data[j + 3] < 16) { d[y * W + x] = 0; continue; }
      const dr = a.data[i] - b.data[j];
      const dg = a.data[i + 1] - b.data[j + 1];
      const db = a.data[i + 2] - b.data[j + 2];
      d[y * W + x] = Math.sqrt(dr * dr + dg * dg + db * db);
    }
  }
  return { data: d, width: W, height: H };
}

/* 在指定矩形内找差异超阈值的包围盒（用来框眼睛、嘴巴） */
function diffBoxIn(dm, rect, threshold) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, count = 0;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (x < 0 || y < 0 || x >= dm.width || y >= dm.height) continue;
      if (dm.data[y * dm.width + x] > threshold) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, count };
}

/* 形态学膨胀：把二值掩码向外扩 r 像素，用来让眼睛/嘴巴的遮罩覆盖到睫毛与外沿 */
function dilateMask(mask, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask[p]) { out[p] = 1; continue; }
      let hit = false;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          if (mask[yy * W + xx]) { hit = true; break; }
        }
      }
      if (hit) out[p] = 1;
    }
  }
  return out;
}

/* 从差异图生成二值掩码（差异超过阈值即为 1），可选区域限制 */
function maskFromDiff(dm, threshold, rect = null) {
  const W = dm.width, H = dm.height;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    if (rect && (y < rect.y0 || y > rect.y1)) continue;
    for (let x = 0; x < W; x++) {
      if (rect && (x < rect.x0 || x > rect.x1)) continue;
      if (dm.data[y * W + x] > threshold) out[y * W + x] = 1;
    }
  }
  return out;
}

/* 把掩码应用到 alpha 通道：掩码外全部透明 */
function applyMask(png, mask) {
  const { data, width: W, height: H } = png;
  for (let p = 0; p < W * H; p++) if (!mask[p]) data[p * 4 + 3] = 0;
  return png;
}

/* 从指定中心点向左右扫描连续实心段，得到该行的主体跨度（用于排除同行的离群元素） */
function rowSpanFrom(png, y, cx) {
  const { data, width: W } = png;
  const solid = (x) => x >= 0 && x < W && data[(y * W + x) * 4 + 3] > 8;
  if (!solid(cx)) {
    let found = -1;
    for (let d = 1; d < W && found < 0; d++) {
      if (solid(cx - d)) found = cx - d;
      else if (solid(cx + d)) found = cx + d;
    }
    if (found < 0) return null;
    cx = found;
  }
  let xl = cx, xr = cx;
  while (solid(xl - 1)) xl--;
  while (solid(xr + 1)) xr++;
  return { xl, xr };
}

/* 差异图的连通块聚类：用来把「眼睛/嘴巴」从 AI 重绘的全图细微噪声里分离出来。
   返回按面积降序的块，每块带包围盒与差异总量。 */
function blobBoxes(dm, threshold, minArea = 60, rect = null) {
  const W = dm.width, H = dm.height;
  const x0r = rect ? Math.max(0, rect.x0) : 0;
  const y0r = rect ? Math.max(0, rect.y0) : 0;
  const x1r = rect ? Math.min(W - 1, rect.x1) : W - 1;
  const y1r = rect ? Math.min(H - 1, rect.y1) : H - 1;
  const seen = new Uint8Array(W * H);
  const boxes = [];
  const inside = (x, y) => x >= x0r && x <= x1r && y >= y0r && y <= y1r;

  for (let y = y0r; y <= y1r; y++) {
    for (let x = x0r; x <= x1r; x++) {
      const p = y * W + x;
      if (seen[p] || dm.data[p] <= threshold) continue;
      const stack = [p];
      seen[p] = 1;
      let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, area = 0, sum = 0;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % W, qy = (q / W) | 0;
        area++;
        sum += dm.data[q];
        if (qx < bx0) bx0 = qx;
        if (qx > bx1) bx1 = qx;
        if (qy < by0) by0 = qy;
        if (qy > by1) by1 = qy;
        const nbrs = [];
        if (qx > x0r) nbrs.push(q - 1);
        if (qx < x1r) nbrs.push(q + 1);
        if (qy > y0r) nbrs.push(q - W);
        if (qy < y1r) nbrs.push(q + W);
        for (const n of nbrs) {
          if (!seen[n] && dm.data[n] > threshold && inside(n % W, (n / W) | 0)) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      if (area >= minArea) {
        boxes.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, w: bx1 - bx0 + 1, h: by1 - by0 + 1, area, sum });
      }
    }
  }
  boxes.sort((a, b) => b.area - a.area);
  return boxes;
}

/* 按行统计非透明像素的跨度，用来找脖子（轮廓最窄处） */
function rowSpan(png, y) {
  const { data, width: W } = png;
  let first = -1, last = -1;
  for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 40) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 ? null : { first, last, width: last - first + 1 };
}

/* 矩形区域外的像素设为透明 */
function maskOutside(png, rect) {
  const { data, width: W, height: H } = png;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1) {
        data[(y * W + x) * 4 + 3] = 0;
      }
    }
  }
  return png;
}

/* 用 alpha 做羽化（盒式模糊两遍近似高斯），让图层切缝自然 */
function featherAlpha(png, radius) {
  const { width: W, height: H } = png;
  const src = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) src[p] = png.data[p * 4 + 3];
  let cur = src;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(W * H);
    // 横向
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += cur[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = sum / (radius * 2 + 1);
        const outX = x - radius, inX = x + radius + 1;
        sum -= cur[y * W + Math.min(W - 1, Math.max(0, outX))];
        sum += cur[y * W + Math.min(W - 1, Math.max(0, inX))];
      }
    }
    // 纵向
    const tmp2 = new Float32Array(W * H);
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        tmp2[y * W + x] = sum / (radius * 2 + 1);
        const outY = y - radius, inY = y + radius + 1;
        sum -= tmp[Math.min(H - 1, Math.max(0, outY)) * W + x];
        sum += tmp[Math.min(H - 1, Math.max(0, inY)) * W + x];
      }
    }
    cur = tmp2;
  }
  for (let p = 0; p < W * H; p++) png.data[p * 4 + 3] = Math.round(cur[p]);
  return png;
}

/* 仅对某矩形内的 alpha 做羽化，用于图层切缝的软过渡 */
function featherAlphaIn(png, rect, radius) {
  const band = radius * 3;
  const y0 = Math.max(0, rect.y0 - band);
  const y1 = Math.min(png.height - 1, rect.y1 + band);
  const x0 = Math.max(0, rect.x0 - band);
  const x1 = Math.min(png.width - 1, rect.x1 + band);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const sub = crop(png, x0, y0, w, h);
  featherAlpha(sub, radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = ((y + y0) * png.width + (x + x0)) * 4;
      // 只在切缝附近生效，避免整图变糊
      const inRect = (x + x0) >= rect.x0 && (x + x0) <= rect.x1 && (y + y0) >= rect.y0 && (y + y0) <= rect.y1;
      if (inRect) png.data[di + 3] = Math.min(png.data[di + 3], sub.data[si + 3]);
    }
  }
  return png;
}

/* 从已有像素「按列向上延展」，用于给身体层补绘被切走的脖子 */
function padUpColumns(png, fromY, toY) {
  const { data, width: W, height: H } = png;
  const start = Math.max(0, Math.min(H - 1, fromY));
  for (let x = 0; x < W; x++) {
    const si = (start * W + x) * 4;
    if (data[si + 3] < 24) continue;
    for (let y = toY; y < start; y++) {
      if (y < 0) continue;
      const di = (y * W + x) * 4;
      if (data[di + 3] > 24) continue;
      data[di] = data[si];
      data[di + 1] = data[si + 1];
      data[di + 2] = data[si + 2];
      data[di + 3] = data[si + 3];
    }
  }
  return png;
}

/* 把 A 图在 rect 区域内替换成 B 图，用于「挖掉眼睛后填上闭眼眼皮」 */
function pasteRegion(dst, src, rect) {
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
      if (x >= src.width || y >= src.height) continue;
      const si = (y * src.width + x) * 4;
      const di = (y * dst.width + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

/* 把图合成到纯色底上，用于给人看的效果预览 */
function flatten(png, bg) {
  const out = blank(png.width, png.height);
  for (let p = 0; p < png.width * png.height; p++) {
    const i = p * 4;
    const a = png.data[i + 3] / 255;
    out.data[i] = Math.round(png.data[i] * a + bg[0] * (1 - a));
    out.data[i + 1] = Math.round(png.data[i + 1] * a + bg[1] * (1 - a));
    out.data[i + 2] = Math.round(png.data[i + 2] * a + bg[2] * (1 - a));
    out.data[i + 3] = 255;
  }
  return out;
}

/* 在图上画参考线，用于目视校准关键坐标 */
function drawGuideLines(png, lines, color = [255, 0, 0]) {
  const { data, width: W, height: H } = png;
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
  };
  for (const l of lines) {
    if (l.axis === 'y') for (let x = 0; x < W; x += 1) { put(x, l.at); if (l.thick) put(x, l.at + 1); }
    else for (let y = 0; y < H; y += 1) { put(l.at, y); if (l.thick) put(l.at + 1, y); }
  }
  return png;
}

function drawBox(png, rect, color = [0, 255, 255]) {
  const { data, width: W, height: H } = png;
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
  };
  for (let x = rect.x0; x <= rect.x1; x++) { put(x, rect.y0); put(x, rect.y1); }
  for (let y = rect.y0; y <= rect.y1; y++) { put(rect.x0, y); put(rect.x1, y); }
  return png;
}

/* 沿掩码边缘向外做柔性扩边：新增像素取最近的实心像素颜色，alpha 逐层衰减。
 * 用途：头部旋转时，原轮廓位置会露出缝隙，靠这圈柔软的外扩把缝填住。 */
function expandEdge(png, mask, radius) {
  const W = png.width, H = png.height;
  let cur = Uint8Array.from(mask);
  for (let step = 1; step <= radius; step++) {
    const next = Uint8Array.from(cur);
    const filled = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cur[i]) continue;
        let sr = 0, sg = 0, sb = 0, n = 0;
        const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!cur[j]) continue;
          const si = j * 4;
          sr += png.data[si]; sg += png.data[si + 1]; sb += png.data[si + 2];
          n++;
        }
        if (n) {
          next[i] = 1;
          filled.push([i, Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)]);
        }
      }
    }
    const a = Math.round((255 * (radius - step + 1)) / (radius + 1));
    for (const [i, r, g, b] of filled) {
      png.data[i * 4] = r;
      png.data[i * 4 + 1] = g;
      png.data[i * 4 + 2] = b;
      png.data[i * 4 + 3] = a;
    }
    cur = next;
  }
  return png;
}

/* 从种子点在实心像素上做连通填充，并可限制最大行号。
 * 用途：取「头部 + 头发 + 帽子」的完整轮廓——按行取跨度会漏掉两侧离得远的头发，
 * 那些头发留在身体层，歪头时就与头部脱开，看起来像断了一块。 */
function floodMask(png, seedX, seedY, maxY = Infinity, minAlpha = 8) {
  const W = png.width, H = png.height;
  const mask = new Uint8Array(W * H);
  const stack = [[seedX, seedY]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || y >= maxY) continue;
    const i = y * W + x;
    if (mask[i]) continue;
    if (png.data[i * 4 + 3] <= minAlpha) continue;
    mask[i] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    // 斜向也连，避免细发丝处断开
    stack.push([x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]);
  }
  return mask;
}

module.exports = {
  readPNG, writePNG, blank, clone,
  keyoutGreen, keyoutBlack, isolateMain, mainMask, bboxOfMask,
  crop, shift, diffMap, diffBoxIn, blobBoxes, rowSpan, rowSpanFrom,
  dilateMask, maskFromDiff, applyMask,
  maskOutside, featherAlpha, featherAlphaIn, padUpColumns, pasteRegion,
  flatten, drawGuideLines, drawBox, expandEdge, floodMask
};
