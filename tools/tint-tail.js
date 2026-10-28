#!/usr/bin/env node
/**
 * 把素材包的 9-slice 气泡导入项目，并按三种描边色重出尾巴。
 *
 * 素材规格（见素材包 00-给Codex和Hermes.md 4.5）：
 *   bubble-normal / success / error 均为 480×160，圆角 28、描边 4，切 32
 *   bubble-tail 48×26，朝下三角，描边与气泡同色，因此每个状态要各出一份
 *
 * 用法：node tools/tint-tail.js <素材包根目录>
 */
const fs = require('fs');
const path = require('path');
const imgutil = require('./lib/imgutil');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.argv[2] ||
  'C:/Users/TYKKKKKK/Desktop/赫尔墨兹素材-完整包/05-UI件/png';
const OUT = path.join(ROOT, 'assets', 'ui');

const EDGE = { normal: [46, 31, 71], success: [123, 217, 165], error: [242, 131, 155] };

const near = (a, b, tol) => Math.abs(a - b) <= tol;

for (const [name, color] of Object.entries(EDGE)) {
  const file = path.join(SRC, `bubble-${name}.png`);
  const bubble = imgutil.readPNG(file);
  imgutil.writePNG(path.join(OUT, `bubble-${name}.png`), bubble);

  // 尾巴：只换描边，保留白色填充与实际 alpha
  const tail = imgutil.readPNG(path.join(SRC, 'bubble-tail.png'));
  let painted = 0;
  for (let i = 0; i < tail.data.length; i += 4) {
    const r = tail.data[i], g = tail.data[i + 1], b = tail.data[i + 2], a = tail.data[i + 3];
    if (a === 0) continue;
    if (r > 232 && g > 232 && b > 232) continue; // 白色填充不动
    // 深紫描边 → 目标色，保留原有明暗关系
    const mix = near(r, 46, 26) && near(g, 31, 26) && near(b, 71, 30) ? 1 : 0.65;
    tail.data[i] = Math.round(r * (1 - mix) + color[0] * mix);
    tail.data[i + 1] = Math.round(g * (1 - mix) + color[1] * mix);
    tail.data[i + 2] = Math.round(b * (1 - mix) + color[2] * mix);
    painted += 1;
  }
  imgutil.writePNG(path.join(OUT, `bubble-tail-${name}.png`), tail);
  console.log(`bubble-${name}.png  ${bubble.width}×${bubble.height}`);
  console.log(`bubble-tail-${name}.png  重绘像素 ${painted}`);
}
