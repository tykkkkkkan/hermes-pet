/* 把「睁眼 / 闭眼 / 张嘴」三张同姿势立绘拆成可驱动 2.5D 表现的图层。
 *
 * 思路：AI 只负责生成同姿势的表情差分，图层由程序差分得出——
 *   睁眼 - 闭眼 = 眼睛像素；闭眼图同位置 = 眼窝底（肤色眼皮）
 *   睁眼 - 张嘴 = 口腔像素
 * 好处是图层与底图逐像素对齐，边缘无接缝，不存在「AI 分别画几张对不上」的问题。
 *
 * 产出：assets/pet-layers/{body,head,eyes,mouth}.png + meta.json
 */
const path = require('path');
const fs = require('fs');
const U = require('./lib/imgutil');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'pet-layers');
const DIAG = path.join(ROOT, '.tmp', 'layer-diag');

const SRC = {
  open: path.join(ROOT, 'assets/states/v2/aligned/state/state-idle.png'),
  closed: path.join(ROOT, '.tmp/ai-raw/Edit_this_image__Keep_the_char_2026-10-28T06-24-06.png'),
  talk: path.join(ROOT, '.tmp/ai-raw/Edit_this_image__Keep_the_char_2026-10-28T06-24-23.png')
};

/* 关键坐标：由 tools/analyze-layers.js 的测量结果确定 */
const NECK_CUT_Y = 258;                       // 头身切缝：下巴下方，头部层在此处截断
const PIVOT = { x: 224, y: NECK_CUT_Y };       // 头部旋转轴心（脖子根部）
const EYE_RECT = { x0: 145, y0: 152, x1: 303, y1: 215 };   // 双眼合并区域
const MOUTH_RECT = { x0: 202, y0: 216, x1: 248, y1: 247 }; // 嘴部区域
const BODY_PAD_TOP = 232;                      // 身体层向上补绘的高度（头部转动时填缝）
const HEAD_OVERPAINT = 32;                     // 头部向下过画高度，旋转时覆盖切缝
const HEAD_EDGE = 4;                           // 头部轮廓柔性外扩半径，用于抗锯齿

function prepare(file, mode) {
  const png = U.readPNG(file);
  if (mode === 'green') U.keyoutGreen(png);
  else U.keyoutBlack(png);
  const cx = Math.round(png.width / 2);
  const cy = Math.round(png.height * 0.5);
  const { png: iso, bbox } = U.isolateMain(png, cx, cy);
  return { png: iso, bbox };
}

console.log('[1/6] 载入并键控三张素材…');
const A = prepare(SRC.open, 'black');
const B = prepare(SRC.closed, 'green');
const C = prepare(SRC.talk, 'green');

const all = [A.bbox, B.bbox, C.bbox];
const cx0 = Math.min(...all.map((b) => b.x0)) - 6;
const cy0 = Math.min(...all.map((b) => b.y0)) - 6;
const cx1 = Math.max(...all.map((b) => b.x1)) + 6;
const cy1 = Math.max(...all.map((b) => b.y1)) + 6;
const W = cx1 - cx0 + 1, H = cy1 - cy0 + 1;
console.log(`    统一画布 ${W}x${H}（原点 ${cx0},${cy0}）`);

const O = U.crop(A.png, cx0, cy0, W, H);
const Bc = U.crop(B.png, cx0, cy0, W, H);
const Cc = U.crop(C.png, cx0, cy0, W, H);

console.log('[2/6] 按轮廓精对齐…');
function bestShift(ref, tgt, range = 10) {
  let best = { dx: 0, dy: 0, score: Infinity };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      let s = 0;
      for (let y = 0; y < ref.height; y += 3) {
        const ty = y + dy;
        if (ty < 0 || ty >= tgt.height) continue;
        for (let x = 0; x < ref.width; x += 3) {
          const tx = x + dx;
          if (tx < 0 || tx >= tgt.width) continue;
          s += Math.abs(ref.data[(y * ref.width + x) * 4 + 3] - tgt.data[(ty * tgt.width + tx) * 4 + 3]);
        }
      }
      if (s < best.score) best = { dx, dy, score: s };
    }
  }
  return best;
}
const sB = bestShift(O, Bc);
const sC = bestShift(O, Cc);
const CLOSED = U.shift(Bc, sB.dx, sB.dy);
const TALK = U.shift(Cc, sC.dx, sC.dy);
console.log(`    闭眼偏移 ${sB.dx},${sB.dy}；张嘴偏移 ${sC.dx},${sC.dy}`);

console.log('[3/6] 拆分头部与身体…');
/* 头部掩码：从脸部中心向外做连通填充，上限到下巴切缝。
   之前按行取中心跨度，会把两侧离得较远的头发排除掉，那些头发留在身体层，
   歪头时与头部脱开、看起来像断了一块。改成连通填充后整头头发都归 head。 */
const headMask = U.floodMask(O, PIVOT.x, Math.round(NECK_CUT_Y * 0.72), NECK_CUT_Y);
const overpaintAlpha = new Map();
for (let y = NECK_CUT_Y; y < Math.min(H, NECK_CUT_Y + HEAD_OVERPAINT); y++) {
  const fade = 1 - (y - NECK_CUT_Y) / HEAD_OVERPAINT;
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (O.data[i * 4 + 3] <= 8) continue;
    headMask[i] = 1;
    overpaintAlpha.set(i, fade);
  }
}

let headCount = 0;
for (let p = 0; p < W * H; p++) headCount += headMask[p];

/* head 层：头部像素，眼睛位置换成闭眼眼皮（这样眼睛层淡出时自然呈现闭眼）。
   再沿轮廓向外扩一圈柔性边缘，头部旋转时这圈「毛边」负责填住原轮廓位置的缝隙。 */
const head = U.clone(O);
U.applyMask(head, headMask);
U.pasteRegion(head, CLOSED, EYE_RECT);
U.expandEdge(head, headMask, HEAD_EDGE);
for (const [i, fade] of overpaintAlpha) head.data[i * 4 + 3] = Math.round(head.data[i * 4 + 3] * fade);

/* body 层：挖掉整个头部区域。
   之前 body 保留完整原图，歪头时底下的原头部会露出来，两套轮廓叠成虚影。
   挖掉后头只由 head 层提供，转动时不会再出现第二张脸。 */
const body = U.clone(O);
const bodyMask = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const y = Math.floor(p / W);
  if (!headMask[p] || (y >= BODY_PAD_TOP && y <= NECK_CUT_Y)) bodyMask[p] = 1;
}
U.applyMask(body, bodyMask);

console.log(`    头部 ${headCount} px（下过画 ${HEAD_OVERPAINT}px，外扩 ${HEAD_EDGE}px）；身体层补绘 y=${BODY_PAD_TOP}..${NECK_CUT_Y - 1}`);

console.log('[4/6] 差分提取眼睛与嘴巴…');
/* 把全画布掩码裁成与小图层同尺寸，用于「只保留变化像素」 */
function cropMask(mask, rect) {
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = mask[(y + rect.y0) * W + (x + rect.x0)] || 0;
    }
  }
  return out;
}

/* 按掩码裁掉像素后逐像素贴回，返回小图层 */
function extractLayer(src, rect, mask, dilateR) {
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  const full = U.blank(W, H);
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const si = (y * W + x) * 4;
      const di = si;
      full.data[di] = src.data[si];
      full.data[di + 1] = src.data[si + 1];
      full.data[di + 2] = src.data[si + 2];
      full.data[di + 3] = src.data[si + 3];
    }
  }
  let m = mask;
  if (dilateR) m = U.dilateMask(m, W, H, dilateR);
  const cm = cropMask(m, rect);
  const out = U.crop(full, rect.x0, rect.y0, w, h);
  for (let p = 0; p < w * h; p++) if (!cm[p]) out.data[p * 4 + 3] = 0;
  U.featherAlpha(out, 1);
  return out;
}

const dmEye = U.diffMap(O, CLOSED);
const eyeMask = U.maskFromDiff(dmEye, 25, EYE_RECT);
const eyes = extractLayer(O, EYE_RECT, eyeMask, 3);

const dmMouth = U.diffMap(O, TALK);
const mouthMask = U.maskFromDiff(dmMouth, 22, MOUTH_RECT);
const mouth = extractLayer(TALK, MOUTH_RECT, mouthMask, 2);

console.log(`    眼睛层 ${eyes.width}x${eyes.height}；嘴巴层 ${mouth.width}x${mouth.height}`);

console.log('[5/6] 写出图层与元数据…');
fs.mkdirSync(OUT, { recursive: true });
U.writePNG(path.join(OUT, 'body.png'), body);
U.writePNG(path.join(OUT, 'head.png'), head);
U.writePNG(path.join(OUT, 'eyes.png'), eyes);
U.writePNG(path.join(OUT, 'mouth.png'), mouth);

const meta = {
  version: 2,
  source: 'state-idle.png + AI 同姿势表情差分（闭眼 / 张嘴）',
  canvas: { width: W, height: H },
  head: { cutY: NECK_CUT_Y, pivotX: PIVOT.x, pivotY: PIVOT.y },
  eyes: { x: EYE_RECT.x0, y: EYE_RECT.y0, w: eyes.width, h: eyes.height },
  mouth: { x: MOUTH_RECT.x0, y: MOUTH_RECT.y0, w: mouth.width, h: mouth.height }
};
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));

console.log('[6/6] 生成预览图…');
function composite(base, layers) {
  // layers: [{png, dx, dy, alpha, rotate}]
  const out = U.flatten(base, [255, 255, 255]);
  for (const L of layers) {
    const a = L.alpha == null ? 1 : L.alpha;
    if (a <= 0) continue;
    const src = L.rotate ? rotateLayer(L.png, L.rotate.cx, L.rotate.cy, L.rotate.deg) : L.png;
    const ox = L.dx || 0, oy = L.dy || 0;
    for (let y = 0; y < src.height; y++) {
      const ty = y + oy;
      if (ty < 0 || ty >= out.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = x + ox;
        if (tx < 0 || tx >= out.width) continue;
        const si = (y * src.width + x) * 4;
        const sa = (src.data[si + 3] / 255) * a;
        if (sa <= 0) continue;
        const di = (ty * out.width + tx) * 4;
        out.data[di] = Math.round(src.data[si] * sa + out.data[di] * (1 - sa));
        out.data[di + 1] = Math.round(src.data[si + 1] * sa + out.data[di + 1] * (1 - sa));
        out.data[di + 2] = Math.round(src.data[si + 2] * sa + out.data[di + 2] * (1 - sa));
        out.data[di + 3] = 255;
      }
    }
  }
  return out;
}

function rotateLayer(png, cx, cy, deg) {
  const rad = (-deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const out = U.blank(png.width, png.height);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = Math.round(cx + dx * cos - dy * sin);
      const sy = Math.round(cy + dx * sin + dy * cos);
      if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) continue;
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

function placeLayer(png, spec) {
  // 把小图层按其基准坐标贴回全画布
  const full = U.blank(W, H);
  for (let y = 0; y < png.height; y++) {
    const ty = y + spec.y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < png.width; x++) {
      const tx = x + spec.x;
      if (tx < 0 || tx >= W) continue;
      const si = (y * png.width + x) * 4;
      const di = (ty * W + tx) * 4;
      full.data[di] = png.data[si];
      full.data[di + 1] = png.data[si + 1];
      full.data[di + 2] = png.data[si + 2];
      full.data[di + 3] = png.data[si + 3];
    }
  }
  return full;
}

const eyesFull = placeLayer(eyes, { x: EYE_RECT.x0, y: EYE_RECT.y0 });
const mouthFull = placeLayer(mouth, { x: MOUTH_RECT.x0, y: MOUTH_RECT.y0 });

/* source-over 合成，用于把眼睛/嘴巴并进头部层（这是渲染器实际的层级结构） */
function overlay(dst, src, alpha = 1) {
  const w = Math.min(dst.width, src.width), h = Math.min(dst.height, src.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * dst.width + x) * 4;
      const sa = (src.data[i + 3] / 255) * alpha;
      if (sa <= 0) continue;
      const da = dst.data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      dst.data[i] = Math.round((src.data[i] * sa + dst.data[i] * da * (1 - sa)) / oa);
      dst.data[i + 1] = Math.round((src.data[i + 1] * sa + dst.data[i + 1] * da * (1 - sa)) / oa);
      dst.data[i + 2] = Math.round((src.data[i + 2] * sa + dst.data[i + 2] * da * (1 - sa)) / oa);
      dst.data[i + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

function buildHead(opts = {}) {
  const out = U.clone(head);
  if (opts.eyes !== false) overlay(out, eyesFull);
  if (opts.mouth) overlay(out, mouthFull, opts.mouthAlpha == null ? 0.9 : opts.mouthAlpha);
  return out;
}

const p1 = composite(body, [{ png: buildHead() }]);
const p2 = composite(body, [{ png: buildHead({ eyes: false }) }]);
const p3 = composite(body, [{ png: buildHead({ mouth: true }) }]);
const p4 = composite(body, [{
  png: buildHead(),
  dx: -6, dy: -2,
  rotate: { cx: PIVOT.x, cy: PIVOT.y, deg: 4 }
}]);
const p5 = composite(body, [{
  png: buildHead(),
  dx: 6, dy: -2,
  rotate: { cx: PIVOT.x, cy: PIVOT.y, deg: -4 }
}]);

const sheetW = (W + 8) * 5;
const sheet = U.blank(sheetW, H);
[[p1, 0], [p2, W + 8], [p3, (W + 8) * 2], [p4, (W + 8) * 3], [p5, (W + 8) * 4]].forEach(([img, ox]) => {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = (y * sheetW + x + ox) * 4;
      sheet.data[di] = img.data[si];
      sheet.data[di + 1] = img.data[si + 1];
      sheet.data[di + 2] = img.data[si + 2];
      sheet.data[di + 3] = 255;
    }
  }
});
U.writePNG(path.join(DIAG, 'preview-sheet.png'), sheet);

console.log('完成。图层输出到', OUT);
console.log('预览图：', path.join(DIAG, 'preview-sheet.png'));
