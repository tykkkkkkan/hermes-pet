/* 分析三张素材：键控、对齐、定位眼睛/嘴巴/脖子，输出诊断数据与标注图。
   用途：在正式拆层前确认关键坐标，避免靠猜。 */
const path = require('path');
const U = require('./lib/imgutil');

const ROOT = path.resolve(__dirname, '..');
const SRC = {
  open: path.join(ROOT, 'assets/states/v2/aligned/state/state-idle.png'),
  closed: path.join(ROOT, '.tmp/ai-raw/Edit_this_image__Keep_the_char_2026-10-28T06-24-06.png'),
  talk: path.join(ROOT, '.tmp/ai-raw/Edit_this_image__Keep_the_char_2026-10-28T06-24-23.png')
};
const OUT = path.join(ROOT, '.tmp/layer-diag');

function prepare(file, mode) {
  const png = U.readPNG(file);
  if (mode === 'green') U.keyoutGreen(png);
  else U.keyoutBlack(png);
  // 从画面中心附近找主体，排除右下角水印这类离群元素
  const { png: iso, bbox } = U.isolateMain(png, Math.round(png.width / 2), Math.round(png.height * 0.5));
  return { png: iso, bbox };
}

const A = prepare(SRC.open, 'black');
const B = prepare(SRC.closed, 'green');
const C = prepare(SRC.talk, 'green');

console.log('=== 主体包围盒 ===');
for (const [k, v] of Object.entries({ open: A, closed: B, talk: C })) {
  console.log(k, JSON.stringify(v.bbox));
}

// 三张统一画布：取三者 bbox 的并集再各留 6px 边距
const all = [A.bbox, B.bbox, C.bbox];
const x0 = Math.min(...all.map((b) => b.x0)) - 6;
const y0 = Math.min(...all.map((b) => b.y0)) - 6;
const x1 = Math.max(...all.map((b) => b.x1)) + 6;
const y1 = Math.max(...all.map((b) => b.y1)) + 6;
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
console.log('\n=== 统一画布 ===', `x${x0} y${y0} ${cw}x${ch}`);

const O = U.crop(A.png, x0, y0, cw, ch);
const Bc = U.crop(B.png, x0, y0, cw, ch);
const Cc = U.crop(C.png, x0, y0, cw, ch);

/* 对齐：以 open 的 alpha 轮廓为基准，搜索最佳平移，使轮廓重合度最高 */
function bestShift(ref, tgt, range = 10) {
  let best = { dx: 0, dy: 0, score: 1e18 };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      let s = 0;
      for (let y = 0; y < ref.height; y += 3) {
        const ty = y + dy;
        if (ty < 0 || ty >= tgt.height) continue;
        for (let x = 0; x < ref.width; x += 3) {
          const tx = x + dx;
          if (tx < 0 || tx >= tgt.width) continue;
          const a = ref.data[(y * ref.width + x) * 4 + 3];
          const b = tgt.data[(ty * tgt.width + tx) * 4 + 3];
          s += Math.abs(a - b);
        }
      }
      if (s < best.score) best = { dx, dy, score: s };
    }
  }
  return best;
}

const sB = bestShift(O, Bc);
const sC = bestShift(O, Cc);
console.log('\n=== 对齐偏移 ===', 'closed', JSON.stringify(sB), 'talk', JSON.stringify(sC));

const Ba = U.shift(Bc, sB.dx, sB.dy);
const Ca = U.shift(Cc, sC.dx, sC.dy);

/* 定位眼睛：用连通块聚类，把高强度差异块从全图纹理噪声里分离出来 */
const dmEye = U.diffMap(O, Ba);
const eyeBlobs = U.blobBoxes(dmEye, 95, 150).slice(0, 4);
console.log('\n=== 眼睛候选块（按面积）===');
eyeBlobs.forEach((b, i) => console.log(`  #${i} x${b.x0}-${b.x1} y${b.y0}-${b.y1} ${b.w}x${b.h} area=${b.area}`));

// 取最强两块作为左右眼，再合成眼睛总包围盒
const pair = eyeBlobs.slice(0, 2).sort((a, b) => a.x0 - b.x0);
const eyeBox = pair.length === 2
  ? {
      x0: Math.min(pair[0].x0, pair[1].x0), y0: Math.min(pair[0].y0, pair[1].y0),
      x1: Math.max(pair[0].x0, pair[1].x0) + 0, y1: Math.max(pair[0].y1, pair[1].y1),
      w: 0, h: 0
    }
  : null;
if (eyeBox) {
  eyeBox.x1 = Math.max(pair[0].x1, pair[1].x1);
  eyeBox.w = eyeBox.x1 - eyeBox.x0 + 1;
  eyeBox.h = eyeBox.y1 - eyeBox.y0 + 1;
}
console.log('=== 眼睛总包围盒 ===', JSON.stringify(eyeBox));
console.log('  左眼:', JSON.stringify(pair[0]), '右眼:', JSON.stringify(pair[1]));

/* 定位嘴巴：在眼睛下方、脸部宽度内找差异块 */
const dmMouth = U.diffMap(O, Ca);
const faceCx = eyeBox ? Math.round((eyeBox.x0 + eyeBox.x1) / 2) : Math.round(cw / 2);
const mouthSearch = {
  x0: faceCx - (eyeBox ? eyeBox.w : 120),
  y0: eyeBox ? eyeBox.y1 + 2 : Math.round(ch * 0.3),
  x1: faceCx + (eyeBox ? eyeBox.w : 120),
  y1: (eyeBox ? eyeBox.y1 : Math.round(ch * 0.3)) + 100
};
const mouthBlobs = U.blobBoxes(dmMouth, 60, 50, mouthSearch).slice(0, 3);
console.log('\n=== 嘴巴候选块 ===');
mouthBlobs.forEach((b, i) => console.log(`  #${i} x${b.x0}-${b.x1} y${b.y0}-${b.y1} ${b.w}x${b.h} area=${b.area}`));
const mouthBox = mouthBlobs[0] || null;
console.log('=== 嘴巴包围盒 ===', JSON.stringify(mouthBox));

/* 找脖子：眼睛下方到下巴下方，轮廓最窄的一行 */
const searchY0 = eyeBox ? eyeBox.y1 + 8 : Math.round(ch * 0.32);
const searchY1 = searchY0 + 130;
let neckY = -1, neckW = 1e9;
const spanLog = [];
for (let y = searchY0; y <= searchY1; y++) {
  const sp = U.rowSpan(O, y);
  if (!sp) continue;
  spanLog.push({ y, w: sp.width });
  if (sp.width < neckW) { neckW = sp.width; neckY = y; }
}
console.log('\n=== 脖子候选 ===', `y=${neckY} 宽度=${neckW}`, `搜索区 y${searchY0}-${searchY1}`);
console.log('宽度曲线（每4行）:', spanLog.filter((_, i) => i % 4 === 0).map((s) => `${s.y}:${s.w}`).join(' '));

/* 输出标注图 */
U.writePNG(path.join(OUT, 'open.png'), O);
U.writePNG(path.join(OUT, 'closed.png'), Ba);
U.writePNG(path.join(OUT, 'talk.png'), Ca);

const guide = U.flatten(O, [255, 255, 255]);
if (eyeBox) U.drawBox(guide, eyeBox, [255, 0, 0]);
if (mouthBox) U.drawBox(guide, mouthBox, [0, 128, 255]);
U.drawGuideLines(guide, [{ axis: 'y', at: neckY, thick: true }], [0, 180, 0]);
U.writePNG(path.join(OUT, 'guide.png'), guide);

// 差异热力图，直观看 AI 改了哪里
const heat = U.blank(cw, ch);
for (let p = 0; p < cw * ch; p++) {
  const v = Math.min(255, dmEye.data[p] * 3);
  const i = p * 4;
  heat.data[i] = v; heat.data[i + 1] = 0; heat.data[i + 2] = 0; heat.data[i + 3] = 255;
}
U.writePNG(path.join(OUT, 'diff-eye.png'), heat);

const heat2 = U.blank(cw, ch);
for (let p = 0; p < cw * ch; p++) {
  const v = Math.min(255, dmMouth.data[p] * 3);
  const i = p * 4;
  heat2.data[i] = 0; heat2.data[i + 1] = 0; heat2.data[i + 2] = v; heat2.data[i + 3] = 255;
}
U.writePNG(path.join(OUT, 'diff-mouth.png'), heat2);

console.log('\n标注图已输出到', OUT);
