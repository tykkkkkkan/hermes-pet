/**
 * 生成 E 类 12 个特效符号 + D/G 类 UI 件（纯 SVG，矢量）
 *
 * 为什么要自己画而不是让 AI 生：
 *   AI 出图会带渐变、描边粗细不一、投影、甚至把编号画进画面里，
 *   而符号要叠在立绘旁边，风格必须统一；且符号要能任意缩放不糊。
 *
 * 配色取自立绘本身：深紫描边 + 白/浅紫/淡蓝/粉紫填充
 * 输出：assets/fx/svg/*.svg  assets/ui/svg/*.svg
 */
const fs = require('fs');
const path = require('path');

const C = {
  line: '#2E1F47',   // 深紫描边（与角色描边同色）
  deep: '#4A3570',
  white: '#FFFFFF',
  lav: '#C3B0E4',
  lav2: '#A98FD6',
  blue: '#A8D4EE',
  pink: '#E8A8D0',
  gold: '#FFE9A8',
  gray: '#D8D2E6',
  ok: '#7BD9A5',
  bad: '#F2839B',
};

const S = 256; // 符号画布
const SW = 11; // 统一描边宽度

const svg = (inner, size = S) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
  inner +
  `</svg>`;

/** 通用描边属性 */
const stroke = (w = SW) =>
  `stroke="${C.line}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

// ────────────────────────────────────────────────────────────
// E 类 · 12 个符号
// ────────────────────────────────────────────────────────────
const FX = {};

// E1 汗滴：上尖下圆的水滴，淡蓝填充
FX['fx-sweat'] = svg(`
  <path d="M128 50 C128 50 190 128 190 166 A62 62 0 0 1 66 166 C66 128 128 50 128 50 Z"
        fill="${C.blue}" ${stroke()} />
  <ellipse cx="103" cy="152" rx="11" ry="19" fill="${C.white}" opacity="0.8"
           transform="rotate(-22 103 152)" />
  <ellipse cx="103" cy="152" rx="5" ry="9" fill="${C.white}" opacity="0.9"
           transform="rotate(-22 103 152)" />
`);

// E2 爱心：饱满的心形 + 左上高光
FX['fx-heart'] = svg(`
  <path d="M128 212 C56 162 40 116 60 90 C80 64 116 70 128 98 C140 70 176 64 196 90 C216 116 200 162 128 212 Z"
        fill="${C.pink}" ${stroke()} />
  <ellipse cx="97" cy="112" rx="14" ry="21" fill="${C.white}" opacity="0.6"
           transform="rotate(-30 97 112)" />
  <ellipse cx="139" cy="90" rx="9" ry="5" fill="${C.white}" opacity="0.4" />
`);

// E3 星星：五角星，浅黄填充 + 中心亮点
(() => {
  const cx = 128, cy = 134, R = 92, r = 38, n = 5;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (-Math.PI / 2) + (i * Math.PI) / n;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)} ${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  FX['fx-star'] = svg(`
    <polygon points="${pts.join(' ')}" fill="${C.gold}" ${stroke()} />
    <circle cx="116" cy="112" r="9" fill="${C.white}" opacity="0.55" />
  `);
})();

// E4 感叹号：粗竖条 + 圆点
FX['fx-exclaim'] = svg(`
  <path d="M128 52 C142 52 150 62 149 76 L141 156 C140 166 135 172 128 172 C121 172 116 166 115 156 L107 76 C106 62 114 52 128 52 Z"
        fill="${C.white}" ${stroke()} />
  <circle cx="128" cy="200" r="20" fill="${C.white}" ${stroke()} />
  <path d="M118 66 L114 146" stroke="${C.lav}" stroke-width="8" stroke-linecap="round" opacity="0.8" />
`);

// E5 问号：描边式大问号 + 圆点
FX['fx-question'] = svg(`
  <path d="M92 100 C92 70 108 52 130 52 C154 52 170 68 170 92 C170 114 156 126 140 138 C131 145 129 152 129 164"
        fill="none" stroke="${C.line}" stroke-width="34" stroke-linecap="round" />
  <path d="M92 100 C92 70 108 52 130 52 C154 52 170 68 170 92 C170 114 156 126 140 138 C131 145 129 152 129 164"
        fill="none" stroke="${C.white}" stroke-width="18" stroke-linecap="round" />
  <circle cx="129" cy="199" r="20" fill="${C.white}" ${stroke()} />
`);

// E6 音符：八分音符 —— 扁圆符头 + 粗符干 + 右上飘带
FX['fx-note'] = svg(`
  <ellipse cx="104" cy="176" rx="37" ry="28" fill="${C.lav}" ${stroke()}
           transform="rotate(-20 104 176)" />
  <ellipse cx="92" cy="166" rx="13" ry="9" fill="${C.white}" opacity="0.65"
           transform="rotate(-20 92 166)" />
  <path d="M138 168 L138 66" fill="none" stroke="${C.line}" stroke-width="26" stroke-linecap="round" />
  <path d="M138 68 C138 60 144 56 152 58 C172 62 186 76 190 94 C192 104 184 108 177 100
           C168 88 156 78 142 74" fill="none" stroke="${C.line}" stroke-width="20"
        stroke-linecap="round" stroke-linejoin="round" />
  <path d="M131 160 L131 76" fill="none" stroke="${C.lav2}" stroke-width="7" stroke-linecap="round" opacity="0.8" />
`);

// E7 省略号：三个等距圆点
FX['fx-ellipsis'] = svg(`
  <circle cx="66" cy="128" r="21" fill="${C.gray}" ${stroke(9)} />
  <circle cx="128" cy="128" r="21" fill="${C.gray}" ${stroke(9)} />
  <circle cx="190" cy="128" r="21" fill="${C.gray}" ${stroke(9)} />
  <circle cx="60" cy="120" r="7" fill="${C.white}" opacity="0.8" />
  <circle cx="122" cy="120" r="7" fill="${C.white}" opacity="0.8" />
  <circle cx="184" cy="120" r="7" fill="${C.white}" opacity="0.8" />
`);

// E8–E11 羽毛 4 帧：同一片羽毛整体旋转，循环起落完全吻合
// 羽毛不能画成"叶子轮廓 + 横线"，那是鱼骨。做法是羽轴 + 两侧斜出的羽枝，
// 先用更粗的深紫铺一遍当描边，再盖白色细羽枝，边缘自然成锯齿，才有羽毛感。
const featherBody = (deg) => {
  // [羽轴上y, 枝尖x, 枝尖y] —— 越靠根部越短、越向下压
  const pairs = [
    [64, 88, 38], [92, 78, 64], [122, 74, 94],
    [152, 84, 128], [180, 98, 162], [202, 114, 192],
  ];
  const barbs = (w, color) =>
    `<g stroke="${color}" stroke-width="${w}" stroke-linecap="round">` +
    pairs
      .map(
        ([y, x, ty]) =>
          `<path d="M128 ${y} L${x} ${ty}" /><path d="M128 ${y} L${256 - x} ${ty}" />`
      )
      .join('') +
    `</g>`;
  return `
  <g transform="rotate(${deg} 128 128)">
    ${barbs(24, C.line)}
    ${barbs(17, C.white)}
    <path d="M128 24 L128 228" stroke="${C.line}" stroke-width="13" stroke-linecap="round" />
    <path d="M128 34 L128 218" stroke="${C.lav}" stroke-width="4" stroke-linecap="round" opacity="0.55" />
  </g>`;
};
[0, -20, -40, -60].forEach((deg, i) => {
  FX[`fx-feather-${i + 1}`] = svg(featherBody(deg));
});

// E12 星尘：三颗四角星 + 散点
(() => {
  const spark = (x, y, s, op = 1) => `
    <path d="M${x} ${y - s} Q${x + s * 0.22} ${y - s * 0.22} ${x + s} ${y}
             Q${x + s * 0.22} ${y + s * 0.22} ${x} ${y + s}
             Q${x - s * 0.22} ${y + s * 0.22} ${x - s} ${y}
             Q${x - s * 0.22} ${y - s * 0.22} ${x} ${y - s} Z"
          fill="${C.white}" stroke="${C.line}" stroke-width="6" stroke-linejoin="round" opacity="${op}" />`;
  FX['fx-dust'] = svg(
    spark(128, 108, 78) +
    spark(58, 62, 34) +
    spark(198, 176, 40) +
    `<circle cx="66" cy="196" r="9" fill="${C.lav}" opacity="0.9" />
     <circle cx="196" cy="66" r="7" fill="${C.lav}" opacity="0.9" />
     <circle cx="176" cy="52" r="4" fill="${C.white}" opacity="0.9" />`
  );
})();

// ────────────────────────────────────────────────────────────
// D 类 · 气泡框（无尾巴纯圆角矩形，9-slice 好切；尾巴单独一个文件）
// ────────────────────────────────────────────────────────────
const BUBBLE_W = 480, BUBBLE_H = 160, R = 28;
const bubble = (fill, border) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BUBBLE_W}" height="${BUBBLE_H}" viewBox="0 0 ${BUBBLE_W} ${BUBBLE_H}">
  <rect x="4" y="4" width="${BUBBLE_W - 8}" height="${BUBBLE_H - 8}" rx="${R}" ry="${R}"
        fill="${fill}" stroke="${border}" stroke-width="4" />
</svg>`;

const UI = {
  'bubble-normal': bubble('#FFFFFF', C.line),
  'bubble-success': bubble('#F2FBF5', C.ok),
  'bubble-error': bubble('#FEF3F5', C.bad),
};

// 尾巴：朝下的小三角，可水平对齐后拼到气泡底边
UI['bubble-tail'] = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="26" viewBox="0 0 48 26">
  <path d="M2 2 L46 2 L26 24 Z" fill="#FFFFFF" stroke="${C.line}" stroke-width="4" stroke-linejoin="round" />
</svg>`;

// ────────────────────────────────────────────────────────────
// D2 托盘图标 · 6 状态（紫底 + 白符号，16px 下仍可辨）
// ────────────────────────────────────────────────────────────
const TRAY = 64;
const trayBase = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TRAY}" height="${TRAY}" viewBox="0 0 ${TRAY} ${TRAY}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6B4E9B" /><stop offset="1" stop-color="#3B2A5A" />
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#g)" stroke="${C.line}" stroke-width="3" />
  ${inner}
</svg>`;

const W = C.white;
Object.assign(UI, {
  // idle：中间一个白点 + 两侧短竖线（16px 下比弧线清楚，不糊）
  'tray-idle': trayBase(`
    <circle cx="32" cy="32" r="12" fill="${W}" />
    <path d="M14 24 L14 40" stroke="${W}" stroke-width="6" stroke-linecap="round" opacity="0.8" />
    <path d="M50 24 L50 40" stroke="${W}" stroke-width="6" stroke-linecap="round" opacity="0.8" />`),
  // thinking：三个点
  'tray-thinking': trayBase(`
    <circle cx="20" cy="32" r="5.5" fill="${W}" /><circle cx="32" cy="32" r="5.5" fill="${W}" opacity="0.75" />
    <circle cx="44" cy="32" r="5.5" fill="${W}" opacity="0.5" />`),
  // working：简化齿轮
  'tray-working': trayBase(`
    <circle cx="32" cy="32" r="15" fill="none" stroke="${W}" stroke-width="5" />
    <g stroke="${W}" stroke-width="5" stroke-linecap="round">
      <path d="M32 12 L32 18" /><path d="M32 46 L32 52" /><path d="M12 32 L18 32" /><path d="M46 32 L52 32" />
      <path d="M18 18 L22 22" /><path d="M42 42 L46 46" /><path d="M46 18 L42 22" /><path d="M22 42 L18 46" />
    </g>`),
  // waiting：红点（要你看）
  'tray-waiting': trayBase(`
    <circle cx="28" cy="34" r="12" fill="${W}" />
    <circle cx="47" cy="17" r="10" fill="${C.bad}" stroke="${C.line}" stroke-width="3" />`),
  // success：对勾
  'tray-success': trayBase(`
    <path d="M18 33 L28 44 L47 21" fill="none" stroke="${W}" stroke-width="8"
          stroke-linecap="round" stroke-linejoin="round" />`),
  // error：感叹号
  'tray-error': trayBase(`
    <path d="M32 15 L32 36" stroke="${W}" stroke-width="8" stroke-linecap="round" />
    <circle cx="32" cy="48" r="5" fill="${W}" />`),
});

// ────────────────────────────────────────────────────────────
// D3 应用图标（512，留白 10%，Windows 会自己再加边距）
// ────────────────────────────────────────────────────────────
UI['app-icon'] = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6B4E9B" /><stop offset="1" stop-color="#2E1F47" />
    </linearGradient>
  </defs>
  <rect x="26" y="26" width="460" height="460" rx="104" fill="url(#bg)" />
  <!-- 背后羽翼 -->
  <path d="M196 240 C158 228 132 202 126 172 C158 176 188 194 202 216 Z"
        fill="${C.white}" stroke="${C.line}" stroke-width="9" stroke-linejoin="round" />
  <path d="M316 240 C354 228 380 202 386 172 C354 176 324 194 310 216 Z"
        fill="${C.white}" stroke="${C.line}" stroke-width="9" stroke-linejoin="round" />
  <!-- 后发 -->
  <ellipse cx="256" cy="300" rx="102" ry="104" fill="${C.lav}" stroke="${C.line}" stroke-width="9" />
  <!-- 两侧垂下的发束（先画，会被脸盖住内侧，只露外侧，看着才像头发不像光环） -->
  <ellipse cx="176" cy="352" rx="27" ry="50" fill="${C.lav}" stroke="${C.line}" stroke-width="8" />
  <ellipse cx="336" cy="352" rx="27" ry="50" fill="${C.lav}" stroke="${C.line}" stroke-width="8" />
  <!-- 脸 -->
  <ellipse cx="256" cy="300" rx="86" ry="78" fill="#FBEEF3" stroke="${C.line}" stroke-width="9" />
  <!-- 刘海（露在帽檐下方） -->
  <path d="M172 264 C184 228 216 210 256 210 C296 210 328 228 340 264
           C326 248 296 240 256 240 C216 240 186 248 172 264 Z"
        fill="${C.lav}" stroke="${C.line}" stroke-width="8" stroke-linejoin="round" />
  <!-- 贝雷帽 -->
  <path d="M148 208 C148 166 196 142 256 142 C316 142 364 166 364 208
           C364 226 336 234 256 234 C176 234 148 226 148 208 Z"
        fill="#3B2A5A" stroke="${C.line}" stroke-width="9" stroke-linejoin="round" />
  <!-- 帽徽 -->
  <circle cx="316" cy="192" r="17" fill="#6B4E9B" stroke="${C.line}" stroke-width="6" />
  <!-- 眼睛 -->
  <ellipse cx="224" cy="300" rx="14" ry="19" fill="#6B4E9B" />
  <ellipse cx="288" cy="300" rx="14" ry="19" fill="#6B4E9B" />
  <circle cx="220" cy="293" r="5.5" fill="${C.white}" />
  <circle cx="284" cy="293" r="5.5" fill="${C.white}" />
  <!-- 嘴 -->
  <path d="M246 330 Q256 340 266 330" fill="none" stroke="${C.line}" stroke-width="7" stroke-linecap="round" />
  <!-- 腮红 -->
  <ellipse cx="202" cy="320" rx="16" ry="10" fill="${C.pink}" opacity="0.7" />
  <ellipse cx="310" cy="320" rx="16" ry="10" fill="${C.pink}" opacity="0.7" />
</svg>`;

// ────────────────────────────────────────────────────────────
// 落盘
// ────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..', 'assets');
const DIR_FX = path.join(ROOT, 'fx', 'svg');
const DIR_UI = path.join(ROOT, 'ui', 'svg');
fs.mkdirSync(DIR_FX, { recursive: true });
fs.mkdirSync(DIR_UI, { recursive: true });

for (const [k, v] of Object.entries(FX)) fs.writeFileSync(path.join(DIR_FX, k + '.svg'), v, 'utf8');
for (const [k, v] of Object.entries(UI)) fs.writeFileSync(path.join(DIR_UI, k + '.svg'), v, 'utf8');

console.log(`符号 ${Object.keys(FX).length} 个 -> ${DIR_FX}`);
console.log(`UI 件 ${Object.keys(UI).length} 个 -> ${DIR_UI}`);
