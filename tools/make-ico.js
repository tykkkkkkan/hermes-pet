/**
 * 多尺寸 PNG → 单个 .ico（Windows Vista+ 支持的 PNG 压缩格式）
 *
 * 结构：
 *   ICONDIR         6 字节
 *   ICONDIRENTRY  16 字节 × n
 *   PNG 数据        依次拼接
 *
 * 注意：宽或高为 256 时，该字段必须写 0，否则 Windows 不认。
 * 用法：node tools/make-ico.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'ui', 'png');
const OUT = path.join(__dirname, '..', 'assets', 'ui', 'hermes-pet.ico');

function pngSize(buf) {
  // IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const SIZES = [16, 32, 48, 64, 128, 256];
const items = [];
for (const s of SIZES) {
  const p = path.join(SRC, `app-icon@${s}.png`);
  if (!fs.existsSync(p)) {
    console.warn('缺: ' + p);
    continue;
  }
  const data = fs.readFileSync(p);
  const { w, h } = pngSize(data);
  items.push({ s, data, w, h });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // reserved
header.writeUInt16LE(1, 2);          // type = icon
header.writeUInt16LE(items.length, 4);

const entries = Buffer.alloc(16 * items.length);
let offset = 6 + 16 * items.length;
items.forEach((it, i) => {
  const o = i * 16;
  entries.writeUInt8(it.w >= 256 ? 0 : it.w, o);      // width
  entries.writeUInt8(it.h >= 256 ? 0 : it.h, o + 1);  // height
  entries.writeUInt8(0, o + 2);                       // palette
  entries.writeUInt8(0, o + 3);                       // reserved
  entries.writeUInt16LE(1, o + 4);                    // planes
  entries.writeUInt16LE(32, o + 6);                   // bpp
  entries.writeUInt32LE(it.data.length, o + 8);       // size
  entries.writeUInt32LE(offset, o + 12);              // offset
  offset += it.data.length;
});

fs.writeFileSync(OUT, Buffer.concat([header, entries, ...items.map((it) => it.data)]));
console.log(`ico ${items.length} 档 (${SIZES.join('/')}) -> ${OUT}`);
console.log(`大小 ${(fs.statSync(OUT).size / 1024).toFixed(1)}KB`);
