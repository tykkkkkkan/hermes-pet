// 按内容重新归档：_抠好/ 里的中文名 → assets/states/v2/ 英文规范名
// 用法：node tools/rename-map.js
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/TYKKKKKK/Desktop/图片/_抠好';
const DST = path.join(__dirname, '..', 'assets', 'states', 'v2');

// [原文件名, 新文件名, 类别, 说明]
const MAP = [
  // ── 造型 / 状态 —— 进桌宠主循环，需要对齐 ──
  ['A8 标准站姿.png',   'state-idle.png',        'state', '常驻：抱书 + 托平板，睁眼微笑'],
  ['B8 闭眼平静.png',   'state-idle-blink.png',  'state', '眨眼帧：同姿势闭眼'],
  ['B3 困打哈欠.png',   'state-sleepy.png',      'state', '困：书贴脸打哈欠'],
  ['B6 叉腰生气.png',   'state-annoyed.png',     'state', '不满：双手叉腰瞪视'],
  ['B7 委屈流泪.png',   'state-error.png',       'state', '失败：双手垂、含泪'],
  ['B9 欢呼跳跃.png',   'state-success.png',     'state', '成功：双手高举、单脚跳'],
  ['B10 走路微笑.png',  'walk-contact.png',      'state', '走路迈步帧'],
  ['A4 举手打招呼.png', 'pose-wave.png',         'state', '挥手'],
  ['A5 指向前方.png',   'pose-point.png',        'state', '指向前方'],
  ['A6 侧面站姿.png',   'pose-side.png',         'state', '正侧面朝右'],
  ['A7 背面站姿.png',   'pose-back.png',         'state', '背面'],
  ['B2 开心举书.png',   'pose-trust.png',        'state', '举书前递（交给我吧）'],

  // ── 新画风组（B19–B22，2026-10-28 出图）—— 比例/发型/翅膀与上组不同，单列 state2 ──
  ['B22 标准微笑站姿.png', 'state2-idle.png',      'state2', '常驻（新画风）：抱书站姿、闭嘴微笑'],
  ['B19 低头看书.png',    'state2-thinking.png',  'state2', '思考：低头看书'],
  ['B20 横屏打字.png',    'state2-working.png',   'state2', '干活：横屏操作'],
  ['B21 递书询问.png',    'state2-waiting.png',   'state2', '等你：举书询问'],

  // ── 表情变体 —— 同一站姿，只换脸 ──
  ['B1 平常站姿.png',   'face-calm.png',         'face', '平常：睁眼平视、抿嘴笑'],
  ['B4 惊讶指平板.png', 'face-surprised.png',    'face', '惊讶：睁大眼、看平板'],
  ['B5 严肃指平板.png', 'face-serious.png',      'face', '严肃：眼半垂、嘴平'],
  ['B11 闭眼大笑.png',  'face-laugh.png',        'face', '大笑：闭眼张嘴'],
  ['B12 打哈欠汗滴.png','face-yawn.png',         'face', '打哈欠 + 汗滴'],
  ['B13 严肃皱眉.png',  'face-frown.png',        'face', '皱眉、心事重'],
  ['B14 生气皱眉.png',  'face-angry.png',        'face', '怒眉、嘴角下垂'],
  ['B15 半月眼无奈.png','face-speechless.png',   'face', '无语：半月眼'],
  ['B16 得意挑眉.png',  'face-smug.png',         'face', '得意：挑眉斜视'],
  ['B17 流泪大哭.png',  'face-cry.png',          'face', '委屈：含泪、泪痕'],
  ['B18 惊讶张嘴.png',  'face-shock.png',        'face', '震惊：O 型嘴'],
  ['B0 站姿害羞.png',   'face-shy.png',          'face', '害羞：脸红、抿嘴'],

  // ── 配图 —— 构图独立，不对齐 ──
  ['C1 搞定.png',       'shot-done.png',         'shot', '搞定（手写标题）'],
  ['C2 歇一下.png',     'shot-rest.png',         'shot', '歇一下'],
  ['C3 赶工.png',       'shot-work.png',         'shot', '赶工'],
  ['C4 交给我吧.png',   'shot-trust.png',        'shot', '交给我吧'],
  ['C5 我来调度.png',   'shot-dispatch.png',     'shot', '我来调度'],
  ['C6 记忆存好了.png', 'shot-memory.png',       'shot', '记忆存好了'],
  ['C7 摸鱼.png',       'shot-fish.png',         'shot', '摸鱼'],
  ['C8 饿了.png',       'shot-hungry.png',       'shot', '饿了'],
  ['C9 加班.png',       'shot-overtime.png',     'shot', '加班'],
  ['C10 拜拜.png',      'shot-bye.png',          'shot', '拜拜'],
];

// 重复项（B9 face-shock ≈ B18 惊讶张嘴、B10 face-shy ≈ B0 站姿害羞）
// 2026-10-28 已从素材目录删除，这里不再归档，也不再建 dup/ 目录

for (const sub of ['state', 'state2', 'face', 'shot']) {
  fs.mkdirSync(path.join(DST, sub), { recursive: true });
}

const report = [];
let miss = 0;
for (const [src, dst, cat, note] of MAP) {
  const s = path.join(SRC, src);
  if (!fs.existsSync(s)) { report.push('缺失: ' + src); miss++; continue; }
  fs.copyFileSync(s, path.join(DST, cat, dst));
  report.push(`✓ ${cat}/${dst}  ←  ${src}   ${note}`);
}

// 指向表，供程序读
const index = { generatedAt: new Date().toISOString(), groups: {} };
for (const [, dst, cat, note] of MAP) {
  (index.groups[cat] = index.groups[cat] || []).push({ file: dst, note });
}
fs.writeFileSync(path.join(DST, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

console.log(report.join('\n'));
console.log(`\n共归档 ${MAP.length - miss} 张，缺失 ${miss} 张`);
