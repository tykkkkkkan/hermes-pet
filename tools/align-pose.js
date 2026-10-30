/* 标定 1024x1024 姿态图到 448x841 分层画布的映射。
 * 误差门槛是硬约束：未通过逐像素校验时不允许批量生成姿态图。 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => PNG.sync.read(fs.readFileSync(file));
const blank = (w, h) => new PNG({ width: w, height: h });
function overlay(dst, src) {
  for (let i = 0; i < dst.data.length; i += 4) {
    const sa = src.data[i + 3] / 255, da = dst.data[i + 3] / 255, oa = sa + da * (1 - sa);
    if (!oa) { dst.data[i + 3] = 0; continue; }
    dst.data[i] = Math.round((src.data[i] * sa + dst.data[i] * da * (1 - sa)) / oa);
    dst.data[i + 1] = Math.round((src.data[i + 1] * sa + dst.data[i + 1] * da * (1 - sa)) / oa);
    dst.data[i + 2] = Math.round((src.data[i + 2] * sa + dst.data[i + 2] * da * (1 - sa)) / oa);
    dst.data[i + 3] = Math.round(oa * 255);
  }
}
function putEyes(target, eyes) {
  for (let y = 0; y < eyes.height; y++) for (let x = 0; x < eyes.width; x++) {
    const si = (y * eyes.width + x) * 4, tx = x + 145, ty = y + 152;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    const di = (ty * target.width + tx) * 4;
    const sa = eyes.data[si + 3] / 255, da = target.data[di + 3] / 255, oa = sa + da * (1 - sa);
    if (!oa) continue;
    target.data[di] = Math.round((eyes.data[si] * sa + target.data[di] * da * (1 - sa)) / oa);
    target.data[di + 1] = Math.round((eyes.data[si + 1] * sa + target.data[di + 1] * da * (1 - sa)) / oa);
    target.data[di + 2] = Math.round((eyes.data[si + 2] * sa + target.data[di + 2] * da * (1 - sa)) / oa);
    target.data[di + 3] = Math.round(oa * 255);
  }
}
function transform(source, scale, offsetX, offsetY) {
  const out = blank(448, 841);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const sx = Math.round((x - offsetX) / scale), sy = Math.round((y - offsetY) / scale);
    if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
    const si = (sy * source.width + sx) * 4, di = (y * out.width + x) * 4;
    out.data[di] = source.data[si]; out.data[di + 1] = source.data[si + 1];
    out.data[di + 2] = source.data[si + 2]; out.data[di + 3] = source.data[si + 3];
  }
  return out;
}
function measure(source, target, scale, offsetX, offsetY) {
  const aligned = transform(source, scale, offsetX, offsetY);
  let sum = 0, count = 0;
  for (let i = 0; i < target.data.length; i += 4) {
    const sa = aligned.data[i + 3], ta = target.data[i + 3];
    if (sa > 8 || ta > 8) {
      sum += Math.abs(aligned.data[i] - target.data[i]);
      sum += Math.abs(aligned.data[i + 1] - target.data[i + 1]);
      sum += Math.abs(aligned.data[i + 2] - target.data[i + 2]);
      count++;
    }
  }
  return { meanRgb: sum / Math.max(1, count * 3), comparedPixels: count };
}

function buildReference() {
  const target = read(path.join(ROOT, 'assets/pet-layers/body.png'));
  overlay(target, read(path.join(ROOT, 'assets/pet-layers/head.png')));
  putEyes(target, read(path.join(ROOT, 'assets/pet-layers/eyes.png')));
  return target;
}
const source = read(path.join(ROOT, 'assets/states/v2/aligned/state/state-idle.png'));
const target = buildReference();

// build-pet-layers.js 的统一画布原点：x=288, y=138。
const meta = { source: '1024x1024 state-idle -> 448x841 pet-layers', scale: 1, offsetX: -288, offsetY: -138, footY: 972,
  note: '以 build-pet-layers.js 的统一画布为基准；state-idle 逐像素 RGB 平均误差必须小于 3' };
const result = measure(source, target, meta.scale, meta.offsetX, meta.offsetY);
console.log(JSON.stringify({ ...meta, ...result }, null, 2));
if (result.meanRgb >= 3) {
  console.error('标定失败：平均 RGB 误差必须 < 3，拒绝继续生成 normalized pose。');
  process.exitCode = 1;
}
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'assets/pet-layers/pose-meta.json'), JSON.stringify({ ...meta, ...result }, null, 2) + '\n');
}
module.exports = { transform, measure, meta, buildReference };
