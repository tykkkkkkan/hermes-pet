/* 使用已通过 align-pose.js 的参数，把整图姿态统一裁到分层画布。 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { transform, measure, meta, buildReference } = require('./align-pose');

const ROOT = path.resolve(__dirname, '..');
const sourceDir = path.join(ROOT, 'assets/states/v2/aligned/state');
const outputDir = path.join(ROOT, 'assets/pet-layers/pose');
const files = {
  'pose-back': 'pose-back.png', 'pose-side': 'pose-side.png', 'pose-wave': 'pose-wave.png',
  'pose-point': 'pose-point.png', 'pose-annoyed': 'state-annoyed.png',
  'pose-trust': 'pose-trust.png', 'pose-walk': 'walk-contact.png'
};
const result = measure(PNG.sync.read(fs.readFileSync(path.join(sourceDir, 'state-idle.png'))),
  buildReference(), meta.scale, meta.offsetX, meta.offsetY);
if (result.meanRgb >= 3) throw new Error(`标定误差 ${result.meanRgb} >= 3，停止归一化`);
fs.mkdirSync(outputDir, { recursive: true });
for (const [name, file] of Object.entries(files)) {
  const source = PNG.sync.read(fs.readFileSync(path.join(sourceDir, file)));
  const output = transform(source, meta.scale, meta.offsetX, meta.offsetY);
  fs.writeFileSync(path.join(outputDir, `${name}.png`), PNG.sync.write(output));
  console.log(`${name}.png 448x841`);
}
console.log(`完成 ${Object.keys(files).length} 张，标定误差 ${result.meanRgb.toFixed(3)} < 3`);
