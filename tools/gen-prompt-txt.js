// 从 docs/豆包生图指令-全集.md 提取纯净 txt（便于记事本里整段复制）
// 用法：node tools/gen-prompt-txt.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'docs', '豆包生图指令-全集.md');
const OUT_1 = path.join(__dirname, '..', 'docs', '豆包生图指令-全集.txt');
const OUT_2 = 'C:/Users/TYKKKKKK/Desktop/给豆包-生图指令全集.txt';

const md = fs.readFileSync(SRC, 'utf8');
const out = [];
const p = s => out.push(s);

p('赫尔墨兹 · 豆包生图指令全集（全批重出 · 47 条）');
p('='.repeat(52));
p('');
p('这一批全部重做，旧素材作废。旧版是灰黑调，新画风是深紫调，混用不统一。');
p('');
p('操作四步：');
p('  1. 上传参考图：桌面\\图片\\站姿-洋红底.png');
p('  2. 比例选 1:1，一次生成 4 张，挑最像的那张');
p('  3. 复制下面【】标题之后的那一整段，粘到豆包');
p('  4. 出图原样保存，按标题里的英文名命名，不要自己抠底 / 裁剪 / 压缩');
p('');
p('两条铁律：');
p('  · 参考图从头到尾只用那一张站姿，不要拿刚生成的图去当下一张的参考');
p('  · 一次一条，一条指令只出一张图');
p('');
p('='.repeat(52));
p('');

// 匹配：### A1　标题　`file.png`　P0  /  空行 / *用在：…* / 空行 / ```代码块```
const re = /^### ([ABC]\d+|E\d+)\u3000(.+?)\u3000\u0060([^\u0060]+)\u0060[^\n]*\n\n\*([^\n]*)\*\s*\n\n\u0060\u0060\u0060\n([\s\S]*?)\n\u0060\u0060\u0060/gm;
let m;
let n = 0;
while ((m = re.exec(md))) {
  n++;
  p(`【${m[1]}　${m[3]}　${m[2]}】`);
  p(m[4].trim());
  p('');
  p(m[5]);
  p('');
  p('-'.repeat(52));
  p('');
}

p('出完一批发我一批，我跑对齐 + 立体化，再并排对比给你看。');

const txt = out.join('\r\n');
fs.writeFileSync(OUT_1, txt, 'utf8');
try {
  fs.writeFileSync(OUT_2, txt, 'utf8');
} catch (e) {
  console.log('桌面写入失败：' + e.message);
}
console.log(`txt 条数 ${n}　字数 ${txt.length}`);
