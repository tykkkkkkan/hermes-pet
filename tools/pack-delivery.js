/**
 * 打包成品素材 → 桌面交付目录
 *
 * 目的：产出一个可以整体交给 Codex / Hermes 直接落地的素材包，
 * 每个文件都有规范名、统一基准、明确的用途说明。
 *
 * 用法：node tools/pack-delivery.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const A = (p) => path.join(ROOT, p);
const OUT = 'C:/Users/TYKKKKKK/Desktop/赫尔墨兹素材-完整包';

// ── 清空重建 ────────────────────────────────────────────
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });

const mk = (p) => fs.mkdirSync(path.join(OUT, p), { recursive: true });
['01-状态立绘/新画风', '01-状态立绘/旧画风', '02-表情', '03-配图', '04-特效符号/png', '04-特效符号/svg', '05-UI件/png', '05-UI件/svg', '06-未完成'].forEach(mk);

const copy = (src, dstRel) => {
  const s = A(src);
  if (!fs.existsSync(s)) {
    console.warn('缺: ' + src);
    return false;
  }
  fs.copyFileSync(s, path.join(OUT, dstRel));
  return true;
};

const sizeOf = (p) => {
  try {
    const im = PNG.sync.read(fs.readFileSync(p));
    return { w: im.width, h: im.height };
  } catch {
    return null;
  }
};

// ── 状态立绘 · 新画风（本批四张，比例 3.5 头身）────────
const STATE2 = {
  'state2-idle.png': { note: '常驻。单手托书在身侧、左手垂下，闭嘴微笑', pri: 'P0' },
  'state2-thinking.png': { note: '思考。低头看书、书贴胸、平板垂下', pri: 'P0' },
  'state2-working.png': { note: '干活。平板横托胸前、双手放在平板上', pri: 'P0' },
  'state2-waiting.png': { note: '等你。⚠ 姿势与 idle 高度重复，见 06-未完成', pri: 'P1' },
};

// ── 状态立绘 · 旧画风（3.2 头身，与上一组不通用）───────
const STATE = {
  'state-idle.png': '常驻。抱书 + 托平板，睁眼微笑',
  'state-idle-blink.png': '眨眼帧，与 idle 同姿势闭眼',
  'state-sleepy.png': '困。书贴脸打哈欠',
  'state-annoyed.png': '不满。双手叉腰',
  'state-error.png': '失败。双手垂、含泪',
  'state-success.png': '成功。双手高举、跳起',
  'pose-wave.png': '挥手',
  'pose-point.png': '指向右侧',
  'pose-side.png': '正侧面朝右（转向过渡）',
  'pose-back.png': '背面（转向过渡）',
  'pose-trust.png': '举书前递',
  'walk-contact.png': '走路迈步帧',
};

// ── 表情 ────────────────────────────────────────────────
const FACE = {
  'face-calm.png': '平常：睁眼平视、抿嘴笑',
  'face-laugh.png': '大笑：闭眼张嘴',
  'face-yawn.png': '打哈欠 + 汗滴',
  'face-surprised.png': '惊讶：睁大眼',
  'face-serious.png': '严肃：眼半垂、嘴平',
  'face-frown.png': '皱眉、心事重',
  'face-angry.png': '生气：怒眉、嘴角下垂',
  'face-speechless.png': '无语：半月眼',
  'face-smug.png': '得意：挑眉斜视',
  'face-cry.png': '委屈：含泪、泪痕',
  'face-shock.png': '震惊：O 型嘴',
  'face-shy.png': '害羞：脸红、抿嘴',
};

// ── 配图 ────────────────────────────────────────────────
const SHOT = {
  'shot-done.png': '搞定（手写标题）',
  'shot-rest.png': '歇一下',
  'shot-work.png': '赶工',
  'shot-trust.png': '交给我吧',
  'shot-dispatch.png': '我来调度',
  'shot-memory.png': '记忆存好了',
  'shot-fish.png': '摸鱼',
  'shot-hungry.png': '饿了',
  'shot-overtime.png': '加班',
  'shot-bye.png': '拜拜',
};

// ── 特效符号 ────────────────────────────────────────────
const FX = {
  'fx-sweat': '汗滴 · error / 尴尬',
  'fx-heart': '爱心 · 好感 / 撒娇',
  'fx-star': '星星 · 完成 / 夸奖',
  'fx-exclaim': '感叹号 · 提醒',
  'fx-question': '问号 · 疑惑',
  'fx-note': '音符 · 开心 / 摸鱼',
  'fx-ellipsis': '省略号 · 无语 / 待机太久',
  'fx-feather-1': '羽毛飘落 第1帧（旋转 0°）',
  'fx-feather-2': '羽毛飘落 第2帧（旋转 -20°）',
  'fx-feather-3': '羽毛飘落 第3帧（旋转 -40°）',
  'fx-feather-4': '羽毛飘落 第4帧（旋转 -60°）',
  'fx-dust': '星尘粒子',
};

// ── UI 件 ───────────────────────────────────────────────
const TRAY = {
  idle: '白点 + 两侧竖线',
  thinking: '三个点',
  working: '齿轮',
  waiting: '白点 + 红色提醒点',
  success: '对勾',
  error: '感叹号',
};

// ── 执行复制 ────────────────────────────────────────────
const manifest = {
  name: '赫尔墨兹桌宠素材包',
  version: '2.0',
  generatedAt: new Date().toISOString(),
  base: {
    canvas: 1024,
    charHeight: '80%',
    footY: '95%',
    axisX: '50%',
    note: '状态立绘与表情均已对齐到同一基准，切换时不会跳动。',
  },
  groups: {},
};

const G = manifest.groups;

G.state2 = [];
for (const [f, m] of Object.entries(STATE2)) {
  if (copy(`assets/states/v2/aligned/state2/${f}`, `01-状态立绘/新画风/${f}`)) {
    const s = sizeOf(path.join(OUT, `01-状态立绘/新画风/${f}`));
    G.state2.push({ file: f, path: `01-状态立绘/新画风/${f}`, use: m.note, pri: m.pri, px: s });
  }
}

G.state = [];
for (const [f, note] of Object.entries(STATE)) {
  if (copy(`assets/states/v2/aligned/state/${f}`, `01-状态立绘/旧画风/${f}`)) {
    const s = sizeOf(path.join(OUT, `01-状态立绘/旧画风/${f}`));
    G.state.push({ file: f, path: `01-状态立绘/旧画风/${f}`, use: note, pri: 'P0', px: s });
  }
}

G.face = [];
for (const [f, note] of Object.entries(FACE)) {
  if (copy(`assets/states/v2/aligned/face/${f}`, `02-表情/${f}`)) {
    const s = sizeOf(path.join(OUT, `02-表情/${f}`));
    G.face.push({ file: f, path: `02-表情/${f}`, use: note, px: s });
  }
}

G.shot = [];
for (const [f, note] of Object.entries(SHOT)) {
  if (copy(`assets/states/v2/shot/${f}`, `03-配图/${f}`)) {
    const s = sizeOf(path.join(OUT, `03-配图/${f}`));
    G.shot.push({ file: f, path: `03-配图/${f}`, use: note, px: s });
  }
}

G.fx = [];
for (const [name, note] of Object.entries(FX)) {
  const okPng = copy(`assets/fx/png/${name}.png`, `04-特效符号/png/${name}.png`);
  copy(`assets/fx/png/${name}@128.png`, `04-特效符号/png/${name}@128.png`);
  copy(`assets/fx/svg/${name}.svg`, `04-特效符号/svg/${name}.svg`);
  if (okPng) G.fx.push({ file: name + '.png', path: `04-特效符号/png/${name}.png`, use: note, px: { w: 256, h: 256 } });
}

// UI 件
for (const f of ['bubble-normal', 'bubble-success', 'bubble-error', 'bubble-tail']) {
  copy(`assets/ui/png/${f}.png`, `05-UI件/png/${f}.png`);
  copy(`assets/ui/svg/${f}.svg`, `05-UI件/svg/${f}.svg`);
}
for (const st of Object.keys(TRAY)) {
  for (const s of [64, 32, 16]) copy(`assets/ui/png/tray-${st}@${s}.png`, `05-UI件/png/tray-${st}@${s}.png`);
  copy(`assets/ui/svg/tray-${st}.svg`, `05-UI件/svg/tray-${st}.svg`);
}
for (const s of [512, 256, 128, 64, 48, 32, 16]) copy(`assets/ui/png/app-icon@${s}.png`, `05-UI件/png/app-icon@${s}.png`);
copy('assets/ui/svg/app-icon.svg', '05-UI件/svg/app-icon.svg');
copy('assets/ui/hermes-pet.ico', '05-UI件/hermes-pet.ico');

G.ui = {
  bubble: {
    files: ['bubble-normal.png', 'bubble-success.png', 'bubble-error.png', 'bubble-tail.png'],
    size: { w: 480, h: 160 },
    tail: { file: 'bubble-tail.png', w: 48, h: 26 },
    nineSlice: {
      border: { top: 32, right: 32, bottom: 32, left: 32 },
      note: '圆角半径 28 + 描边 4，所以四边各 32 够切；中间区域纯色可任意拉伸。尾巴是独立文件，横向对齐后叠在底边。',
    },
  },
  tray: { states: TRAY, sizes: [16, 32, 64], pick: 'Windows 托盘实际显示 16，任务栏大图标用 32；建议运行时按 DPI 选。' },
  icon: { ico: 'hermes-pet.ico', png: [512, 256, 128, 64, 48, 32, 16], note: 'ico 内已打包 6 档（16/32/48/64/128/256）' },
};

// 未完成清单
fs.writeFileSync(
  path.join(OUT, '06-未完成/待补清单.txt'),
  [
    'Hermes 桌宠 · 仍缺的角色立绘（2 张）',
    '='.repeat(46),
    '',
    '【1】waiting · 等你',
    '  现有 state2-waiting 与 state2-idle 的姿势几乎完全一样，',
    '  只有表情和书的角度差一点，切换时看不出状态变化。',
    '  → 需要重出，指令见 00-给Codex和Hermes.md 附录 A。',
    '',
    '【2】walk-pass · 走路并拢帧',
    '  走路目前只有 walk-contact（迈步）一帧，做循环会瘸腿。',
    '  需要一张「双脚并拢、身体略微抬起」的补间帧。',
    '  → 需要重出，指令见 00-给Codex和Hermes.md 附录 B。',
    '',
    '如果暂时不补，可用降级方案（不影响开发先跑起来）：',
    '  · waiting → 用 state2-idle + 头上飘 fx-exclaim / 气泡提示代替',
    '  · 走路   → walk-contact 与 state2-idle 交替，配合 3px 上下浮动即可',
    '',
    '另外两组素材的画风不是同一代，不要混用：',
    '  · 新画风（state2-*）：约 3.5 头身、长发、小羽翼靠上',
    '  · 旧画风（state-* / pose-* / face-*）：约 3.2 头身、蓬松短发',
    '  同一次显示里只取一套。要统一，建议以新画风为准，逐步重出旧画风那 12 张。',
  ].join('\r\n'),
  'utf8'
);

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

// 统计
let total = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else total++;
  }
};
walk(OUT);
console.log(`打包完成 -> ${OUT}`);
console.log(`文件数 ${total}，体积 ${(require('child_process').execSync(`du -sk "${OUT}"`).toString().split('\t')[0] / 1024).toFixed(1)}MB`);
