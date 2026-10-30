# 指令 22 · 头身分离的真因：过画带是半透明的

> 上一轮的过画没解决问题，用户看图还是「头是分离的」。我把 `head.png` 逐行扫了一遍，原因很明确：**过画带的 96% 是半透明，而它下面那 19 行是空的。**
> 这份还包含一次全面复查的结果。

---

## 一、P0：脖子那 19 行只有半透明的头顶着

### 数据

`head.png` 在过画带 y=258..293 的 alpha 分布：

```text
alpha = 255（全实）   157 px     1.8%
alpha 193-254        2095 px
alpha 129-192        2050 px
alpha 65-128         2118 px
alpha 9-64           2546 px
合计                 8966 px
```

**全实只占 1.8%，96% 是渐隐的半透明。**

逐行看更清楚：

```text
行      head 显示 / 全实     body 显示 / 全实
y=250   263 / 207            238 / 207
y=258   257 / 157            187 / 157
y=262   261 / 0              0 / 0        ← head 全半透明，body 完全空
y=270   264 / 0              0 / 0        ← 同上
y=280   237 / 0              0 / 0        ← 同上
y=290   272 / 0              259 / 246    ← head 半透明盖在 body 实心上
y=295   0 / 0                286 / 272
```

**y=262 到 y=280 这 19 行，下面一个像素都没有，只有一层 alpha 30%~70% 的头顶着。** 静止的时候看就是「脖子是虚的、头飘着」。

y=290 那段更糟：head 的半透明（全实 0）盖在 body 的实心（全实 246）上，形成一条叠影带。

### 根因

上一轮我让你把过画带的 alpha 从 1 线性淡到 0：

```js
const fade = 1 - (y - NECK_CUT_Y) / HEAD_OVERPAINT;   // 1 → 0
```

**这个 `fade` 是错的方向。** 过画的目的是「旋转时填缝」，正常情况下它应该和底下完全重合、看不出来；渐隐反而让它在静止时就露出一条半透明的带子。

而且 `body.png` 的补绘只到 232~258，**258 以下就断了**，正好和 head 的渐隐带撞在一起——一个渐隐、一个空缺，中间 19 行就是双重残缺。

### 修法：两边都不渐隐，且补齐到同一高度

**改 1：`head.png` 的过画带不渐隐**

删掉 `fade` 那套，过画带直接用原图的 alpha：

```js
const HEAD_OVERPAINT = 35;
for (let y = NECK_CUT_Y; y < Math.min(H, NECK_CUT_Y + HEAD_OVERPAINT); y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (O.data[i * 4 + 3] <= 8) continue;
    headMask[i] = 1;
    // 不做 alpha 渐变。过画带是给旋转兜底的，静止时必须和底下完全重合，
    // 一旦渐隐就是一条看得见的半透明带子。
  }
}
```

**改 2：`body.png` 的补绘范围从 232 扩到 293**

和 head 的过画带高度一致，两层在 232~293 这段完全重叠、同源像素，静止时看不出来；旋转时 body 那份留在原地兜底。

```js
const BODY_PAD_TOP = 232;                  // 保持不变
const NECK_CUT_Y = 258;
const HEAD_OVERPAINT = 35;                 // 和 head 对齐

const bodyMask = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const y = Math.floor(p / W);
  if (!headMask[p]) bodyMask[p] = 1;
  else if (y >= BODY_PAD_TOP) bodyMask[p] = 1;          // 232~293 头部像素也留在 body
}
```

**注意：`y >= BODY_PAD_TOP` 这个条件是「从 232 一直到图底」都保留头部像素**，不只是 258 以上。这样 258~293 也被 body 保留，和 head 完全重合。

**改 3：确认不会出双头**

232~293 是**下巴以下的脖子、衣领**，不是脸。所以 body 保留这段不会在头转开时露出第二张脸——之前注释里说的「双头虚影」是保留**整块头部（含脸）**才有的问题。

改完之后这一段 body 从 232 往下全是原图内容（本来就该有的脖子和衣领），只是以前被 `headMask` 挖掉了。

### 验收（必须给数字）

改完重新量，**这三行是硬指标**：

```text
y=262   head 全实 > 150   body 全实 > 100
y=270   head 全实 > 150   body 全实 > 100
y=280   head 全实 > 150   body 全实 > 100
```

现在的值是 `head 全实 = 0 / body 全实 = 0`，改完两个都要上百。

另外贴一张**脖子区域放大 4 倍**的截图，范围 `y ∈ [230, 300]`（上一轮拍的 `cutY ± 30` 是 228~288，勉强够，但这次要看的是 258 以下那 19 行的实心程度，**请把范围改成 `y ∈ [240, 310]`**）。

---

## 二、smoke 是 flaky 的，不是 30/30

我连跑三次 `npm run smoke -- --isolated`：

```text
第 1 次  ✖ 十五个动作产生位移   moved: false（全红）
第 2 次  ✖ 十五个动作产生位移   moved: true 但仍红
第 3 次  ✔ 通过
```

同一条用例三种结果。你报的 30/30 大概是碰上通过的那次。

另一条 `rot/lean 峰值错峰 ≥ 70ms`：你报 141.2ms，我实测 70.6ms，**刚好卡在阈值上**。

**flaky 比直接失败更麻烦**——它会偶尔变绿，掩盖真问题，而后续所有验收都靠 smoke。

### 修法

**1. 采样窗口拉长**

现在是在固定时刻取一次快照。改成从动作开始一直采到 `duration + 200ms`，每 30ms 一次，取整段的最大偏离：

```js
const samples = [];
const t0 = performance.now();
while (performance.now() - t0 < action.duration + 200) {
  samples.push({ t: performance.now() - t0, pose: window.petLive2d.getPose() });
  await new Promise(r => setTimeout(r, 30));
}
// 判据：任何一项（rot/dy/eye/mouth/lean/jump）相对基线的最大偏离 > 0.5
const base = samples[0].pose;
const maxDev = Math.max(...samples.slice(1).map(s =>
  Math.max(...['rot','dy','eye','mouth','lean','jump'].map(k => Math.abs((s.pose[k] || 0) - (base[k] || 0))))
));
```

**2. 错峰阈值降到 35ms**

错峰是真机制（曲线本来就错开），不需要卡 70ms。35ms 已经远超采样误差（30ms 间隔），又有足够余量。

**3. `smoke` 加重复执行**

```bash
npm run smoke -- --isolated --repeat=3
```

三次全过才算过。这个参数比修单条断言更能防住以后所有时间敏感问题——**只要有 --repeat，flaky 就藏不住**。

验收时要贴三次的完整结果，不许只贴一次。

---

## 三、全面复查：还缺什么

我把现有功能扫了一遍，按「有/无/半成品」列清楚：

| 项 | 状态 | 说明 |
|---|---|---|
| 行为状态机（9 态） | ✅ | 单元测试在 |
| 精力节律 | ✅ | `energyAt` 在 `behavior.js` |
| 习惯化 / 连戳链 | ✅ | `pokeCounts` + `CHAINS` |
| 骨骼动作轨道 | ✅ | 15 个动作都有 `tracks` |
| 情绪骨骼偏置 | ✅ | 在 `pet-puppet.js` |
| 跳视 / 视差错峰 | ✅ | `getViewport` / `getPose` 都暴露了 |
| 姿态层对齐 | ✅ | 标定 k=1 / ox=-288 / oy=-138，误差 1.787 |
| 记忆进 prompt | ✅ | `main.js:345` 已调 `petMemory.snapshot` |
| 情绪表情混色 | ✅ | 交叉淡化在 |
| **头身过画** | ❌ | **本轮修的，见第一节** |
| **ASR 下载进度** | ❌ | 92MB 模型下载时用户看不到任何进度 |
| **自动更新** | ❌ | 没做，每次改完要重装 |
| **走路循环** | ❌ | `pose-walk` 只登记了，缺 `walk-pass` 帧 |
| **眉毛 / 嘴型** | ❌ | 表情靠眼睛开合硬撑 |
| **smoke 稳定性** | ❌ | 见第二节 |

### 建议这轮顺手做的两条

**ASR 下载进度**（半小时的活，但影响首次体验）：

`main.js` 的 `downloadAsrModel()` 里，`response.body` 读流时累计字节数，按 `content-length` 算百分比，通过 `win.webContents.send('asr-download', { percent, received, total })` 推到渲染层，状态气泡显示「正在下载语音模型 47%」。**下不到就明确说失败原因**，现在应该是静默失败。

**走路循环的接入点先搭好**（等 `walk-pass.png` 到位就能用）：

`behavior.js` 加一个 `walking` 状态（现在 9 个，加第 10 个），触发条件是「`idle` 超过 3 分钟且桌宠在屏幕左侧」。**但先别接 `pose-walk`**——单帧走路看起来是滑动的，比不走还怪。等两帧齐了再开。

其他（自动更新、眉毛、嘴型）都需要新依赖或新素材，这轮不动。

---

## 四、不许做的

1. **过画带不要再加任何渐隐**。这条是上一轮踩的坑，渐隐 = 一条看得见的半透明带子
2. **`BODY_PAD_TOP` 不要往上挪到 200 以下**。232 已经是下巴附近，再往上会补到脸部，头转开时露馅
3. **不要为了「看起来不分离」把 `NECK_CUT_Y` 往下调**。切缝位置和旋转轴心是一套测量结果，动了整套要重新对齐
4. **`--repeat` 不要只在本地加，写进 `package.json` 的 `smoke` 脚本**，让每次跑都重复三次

---

## 五、汇报格式

```text
1. head.png / body.png 在 y=262 / 270 / 280 三行各自的「全实像素数」（六个数字）
2. 脖子区域 y∈[240,310] 放大 4 倍截图
3. rot=0 / +8 / -8 三张对比图
4. smoke 连跑三次的完整结果（三次都要贴）
5. rot/lean 错峰实测值
6. ASR 下载进度条的截图（如果做了）
7. npm test pass 数
```

第 1 条的六个数字是这轮的唯一硬指标。**没有一个上万不要报完成。**
