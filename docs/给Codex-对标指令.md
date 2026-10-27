# 给 Codex：基于本地完整仓库重做一次对标

写于 2026-10-27 23:2x

---

## 一、先纠正上次的做法

上次你读 `YU-1021/deepseek-fish-pet` 的方式是**逐个 raw.githubusercontent 抓文件**，抓了 8 个，其中 5 个被截断：

| 文件 | 返回 tokens | 状态 |
|---|---|---|
| README.md | 3837 字符 | 完整 |
| 功能说明.md | 8931 | **截断**（只出 706 行） |
| 模块说明.md | 9334 | **截断** |
| app/main.js | 4385 | **截断**（只出 220 行） |
| app/src/store.js | 1556 | 完整 |
| app/src/mood.js | 3275 | **截断** |
| app/src/llm.js | 4266 | **截断** |
| app/renderer/chat.js | **20793** | **截断**（只出一部分） |

而这个仓库实际有 **283 个文件、14794 行 JS、57 个 src 模块**。

你看到的是其中 8 个文件、约 1/10 的内容，还都被截了尾。

---

## 二、完整仓库已经下载到本地

**路径：`D:\01-项目\_参考\deepseek-fish-pet`**

不要再发网络请求，直接读本地文件。缺的 24 个文件是 `.dll` / `.pw-browsers` / 大图，源码全在。

### 核心结构

```
app/
├─ main.js              主进程：窗口 / 托盘 / 菜单 / IPC / 鼠标穿透 / 拖拽
├─ preload.js           contextBridge
├─ persona.json         默认人设
├─ src/                 57 个模块
│  ├─ llm.js            OpenAI 兼容 /chat/completions
│  ├─ tts.js            Edge 神经音色 + 本地缓存
│  ├─ asr.js            本地 whisper.cpp（离线，无需 Key）
│  ├─ memory/           会话 / 中期 / 长期日记 / 长期要点 / 上下文压缩
│  ├─ mood.js           心情
│  ├─ persona.js        人设：可写文件 + 逐字段锁
│  ├─ petactions.js     交互动作表：热区 × 核心人格 → 动作
│  ├─ anchor.js         锚点驱动 ROI
│  ├─ surface.js        只追加的事件日志 + 可替换的投影
│  ├─ uia.js            Windows UI Automation
│  ├─ vision.js         截图 + 视觉模型
│  ├─ assistant.js      AI 助手（权限分级 + 每步确认）
│  ├─ skills.js         技能系统
│  ├─ flows.js          确定性流程库
│  └─ dsh.js            DSH 会话联动
├─ renderer/
│  ├─ index.html / renderer.js / style.css     桌宠窗
│  ├─ chat.html / chat.js / chat.css           对话大窗
│  └─ asr-recorder.js                          16k 录音 + 能量 VAD
└─ assets/               立绘 + 区域图 pet-regions.json
```

---

## 三、这次要做什么

**不要重写 hermes-pet。** 现有的 1002 行保留，做增量补齐。

### 第一步：读，然后出一张差距表

按顺序读，读完再动手：

1. `README.md` — 整体定位
2. `功能说明.md` — 行为 + 数据（这是最重要的一份）
3. `模块说明.md` — 每个模块的职责边界
4. `app/main.js` — 看窗口/IPC 的组织方式
5. `app/src/memory.js` + `app/src/memory/` — 记忆分层怎么做的
6. `app/src/persona.js` — 人设锁的机制
7. `app/src/petactions.js` — 热区 × 人格 → 动作，这是「桌宠」和「窗口」的分界线
8. `app/src/surface.js` — 事件日志投影
9. `app/src/asr.js` + `asr-recorder.js` — VAD 断句怎么做的
10. `app/src/tts.js` — 音色和缓存策略

产出：一张三列表，**只列事实，不写建议**。

| 能力 | 大肥鱼怎么做的（文件:行号） | hermes-pet 现状 |
|---|---|---|

### 第二步：只挑三条来做

我（用户）的优先级：

1. **记忆分层** —— 现在 hermes-pet 只有 `state.json` 一个文件，大肥鱼是会话/中期/长期三层。要补。
2. **热区动作** —— 摸头、戳身体有不同反应。这是桌宠的核心体感。
3. **状态驱动表情** —— 待命/思考/执行/成功/失败/休眠，靠 Hermes 真实状态驱动，不是随机动画。

其余（TTS、语音识别、UIA、视觉）**先不做**，等这三条跑通。

### 第三步：接 Hermes，不接 DSH

大肥鱼的 `dsh.js` 是读 DeepSeek Harness 的会话记录。**我们要读的是 Hermes**，接口已经摸清了：

- 端口：读 `~/AppData/Local/hermes/spawn-ledger.json` 里 `purpose: "serve"` 的 `port`
- token：`GET http://127.0.0.1:<port>/` 返回的 HTML 里抓 `window.__HERMES_SESSION_TOKEN__`
- 状态：`GET /api/status`
- 任务：`GET /api/plugins/kanban/board`

`hermes-bridge.js` 已经做了这件事，别推翻，接着往上加。

---

## 四、不要做的三件事

1. **不要抄人设立绘和文本** —— 那个项目是「吃白饭的大肥鱼」二创，蓝发鲸鱼女仆，有独立版权。只学机制，不搬素材、不搬台词。
2. **不要引入 whisper.cpp / Edge TTS 的 vendor 目录** —— 那两个是几十 MB 的二进制。等功能真做到那一步再单独装。
3. **不要改 hermes-pet 现有的窗口尺寸和视觉** —— 立绘和布局是定好的，动之前先问我。

---

## 五、验收标准

做完之后，我要能验收这三条：

1. 跟它聊过的话，第二天它还记着（记忆分层生效）
2. 点头部、点身体、点脚，反应不一样（热区生效）
3. Hermes 那边有任务在跑的时候，它自己变成「工作中」的样子，不用我切（状态驱动生效）

三条都做不到，就是没做完。

---

参考仓库：`D:\01-项目\_参考\deepseek-fish-pet`（MIT 协议，可用机制，需保留版权声明）
本项目：`D:\01-项目\hermes-pet`
