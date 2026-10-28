/* 生成脚底投影贴图。
 *
 * 2D 立绘之所以"飘"，最直接的原因是它跟桌面之间没有接触关系。
 * 铺一张软边椭圆投影在脚下，并让它随跳跃/呼吸变化，就能把角色"按"到桌面上。
 *
 * 做法：两层叠加。外层大而淡（环境遮蔽），内层小而浓（接触硬影），
 * 都用椭圆归一化距离做幂次衰减，边缘自然过渡到全透明。
 *
 * 用法：node tools/make-shadow.js
 */
const path = require('path');
const { blank, writePNG } = require('./lib/imgutil');

const W = 512;
const H = 160;
const OUT = path.join(__dirname, '..', 'assets', 'pet-layers', 'shadow.png');

const CX = W / 2;
const CY = H / 2;

/* 冷紫灰而不是纯黑：纯黑在深色壁纸上会糊成一团脏斑 */
const COLOR = [58, 44, 92];

function falloff(d, power, peak) {
  const k = Math.max(0, 1 - d);
  return Math.pow(k, power) * peak;
}

const png = blank(W, H);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - CX) / (W / 2);
    const ny = (y + 0.5 - CY) / (H / 2);

    const outer = falloff(Math.sqrt(nx * nx + ny * ny), 1.9, 0.36);
    const inner = falloff(Math.sqrt(nx * nx * 1.7 + ny * ny * 2.3), 1.15, 0.58);
    const alpha = Math.min(1, outer + inner);

    const o = (y * W + x) * 4;
    png.data[o] = COLOR[0];
    png.data[o + 1] = COLOR[1];
    png.data[o + 2] = COLOR[2];
    png.data[o + 3] = Math.round(alpha * 255);
  }
}

writePNG(OUT, png);
console.log(`投影 ${W}x${H} → ${OUT}`);
