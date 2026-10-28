// 素材体检：尺寸 / 真实格式 / 四角底色 / 是否洋红底 / 可解码性
// 用法：node tools/survey.js <目录>
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const dir = process.argv[2];
if (!dir) { console.error('用法: node tools/survey.js <目录>'); process.exit(1); }

const NAMES = {
  '89504e47': 'PNG',
  'ffd8ff': 'JPEG',
  '52494646': 'WEBP?', // RIFF
  '47494638': 'GIF',
};

function decode(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.slice(0, 4).toString('hex');
  const kind = NAMES[magic] || magic;
  if (magic.startsWith('ffd8ff')) {
    const im = jpeg.decode(buf, { useTArray: true });
    return { w: im.width, h: im.height, d: im.data, kind: 'JPEG', bytes: buf.length };
  }
  if (magic === '89504e47') {
    const im = PNG.sync.read(buf);
    return { w: im.width, h: im.height, d: im.data, kind: 'PNG', bytes: buf.length };
  }
  throw new Error('格式 ' + kind + '（' + buf.slice(0, 12).toString('hex') + '）');
}

const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const rows = [];
for (const f of files) {
  const full = path.join(dir, f);
  try {
    const im = decode(full);
    const P = (x, y) => { const p = (y * im.w + x) * 4; return [im.d[p], im.d[p + 1], im.d[p + 2]]; };
    const corners = [P(3, 3), P(im.w - 4, 3), P(3, im.h - 4), P(im.w - 4, im.h - 4)];
    // 洋红判定：min(r,b)-g 大
    const magScore = c => Math.min(c[0], c[2]) - c[1];
    const allMagenta = corners.every(c => magScore(c) > 100);
    rows.push({
      f, kind: im.kind, w: im.w, h: im.h,
      corner: corners[0].join(','),
      magenta: allMagenta ? '洋红' : '非洋红',
      err: '',
    });
  } catch (e) {
    rows.push({ f, kind: '?', w: 0, h: 0, corner: '-', magenta: '-', err: e.message });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('文件', 26) + pad('格式', 6) + pad('尺寸', 11) + pad('底色', 16) + '判定');
console.log('-'.repeat(72));
for (const r of rows) {
  console.log(pad(r.f, 26) + pad(r.kind, 6) + pad(r.w ? r.w + '×' + r.h : '-', 11) + pad(r.corner, 16) + (r.err ? 'ERR ' + r.err : r.magenta));
}
console.log('\n共 ' + rows.length + ' 个文件，可解码 ' + rows.filter(r => !r.err).length + '，失败 ' + rows.filter(r => r.err).length);
