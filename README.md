# Hermes Pet · 赫尔墨兹

> Hermes 的桌面化身。透明置顶的二次元执事小人，实时同步 AI Agent 的任务状态，完成或失败会主动开口。

它不是第二个 AI —— 它只是 Hermes 的「脸」。**播报的每一句都要能追溯到一次真实的接口返回或数据库记录**，说不清出处的话就不说。

![预览](docs/preview.png)

## 它是什么

Hermes 是一个跑在本机的 AI Agent。Hermes Pet 给这个 Agent 一副能看见的身体：

- 窗口透明置顶、无边框，只在小人轮廓范围内接收鼠标，其余区域点一下就穿透到桌面。
- 挂机时呼吸、眨眼、轻微晃动；接活时切到「执行中」；跑完切「成功」并弹一句真实的完成播报。
- 你摸它头、戳它脸、拉它身子、点它脚，四个部位四种反应，台词随心情和好感变化。
- 需要说话的时候，`Ctrl + Shift + H` 唤起聊天窗，拖文件进去就能派一单活给 Hermes。

## 功能现状（v0.1.0）

| 层 | 已实现 |
|---|---|
| 窗口 | 透明置顶、按轮廓切换鼠标穿透、拖拽、位置记忆、托盘、独立聊天窗、全局快捷键 |
| 表现 | 自研分层 puppet（头/眼/嘴/身四层），六态驱动 + 转头透视 + 平面压扁 + 呼吸挤压 + 脚底投影；闭快睁慢的眨眼调度、视线跟随、说话口型 |
| 状态 | 心情与好感衰减、按日归档会话（近 14 天摘录）、六状态映射（待命/思考/执行/成功/失败/休眠） |
| 互动 | 头/脸/身/脚四区热区、悬停摸头、右键菜单、拖文件建任务、状态胶囊、系统通知 |
| 对话窗 | 空态引导、markdown 渲染（代码块/列表/粗体）、打字气泡、按日分组、逐条复制与朗读、面板浮层化不再遮挡角色 |
| 集成 | 读取 Hermes 的 gateway 状态、任务看板、会话历史与技能目录；对外提供 6 个插件工具 |

角色是**分层 2D + 立体化运动**，不是 3D 网格模型。立体感来自透视、遮挡与投影三条线索，具体做法见下文「2.5D 分层渲染」。

## 环境要求

| 项 | 要求 |
|---|---|
| 系统 | Windows 10/11 |
| Node.js | ≥ 18（开发实测 22.22.2） |
| Electron | ^45.0.0（随 `npm install` 安装） |
| Hermes | 0.20.6 及以上（仅插件桥接与状态同步需要） |

## 快速开始

```powershell
npm install
npm start
```

`npm start` 需要保持运行。桌宠关掉之后，插件调用会直接返回「桌宠没有运行」——这是设计：不偷偷拉起一个新窗口。

## 验证

| 验证项 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `node --test test/*.test.js` | 17/17 通过 |
| 实机冒烟 | `npm run smoke` | 8/8 通过 |
| 插件校验 | `npm run plugin:validate` | `ok: true` |
| 插件注册 | `hermes plugins doctor . --ci` | 注册 6 个工具 |

冒烟测试会真的启动 Electron，用 CDP 进入窗口逐项验收（窗口尺寸、preload API、立绘加载、四区热区、状态字段、互动气泡），截图留证后自动关闭。

## 接入 Hermes

**当前状态：✅ 已接入。** 插件已安装并启用（`enabled · git · 0.1.0 · hermes-pet`），6 个工具端到端实测全通，真实任务驱动的成功/失败播报也已验证通过。

插件通过本机 `127.0.0.1` 桥接桌宠，不复制 Hermes 的任务看板。桌宠启动时自动写桥接文件：

```text
%LOCALAPPDATA%\hermes\hermes-pet-bridge.json
```

文件含端口与 token，由桌宠托管，不需要手工编辑。

提供的 6 个工具：

```text
hermes_pet_status       读取桌宠状态
hermes_pet_say          让桌宠说一句
hermes_pet_set_status   切换六态
hermes_pet_interact     触发四区互动
hermes_pet_show         显示窗口
hermes_pet_open_chat    打开聊天窗
```

安装：CLI 只接受 Git 地址、`owner/repo` 或插件目录名，**不接受裸本地路径**；本地开发用 `file://` 形式的 Git 地址即可。

```powershell
hermes plugins install "file:///D:/01-项目/hermes-pet" --enable --yes-deps
hermes plugins list --plain --no-bundled
hermes plugins doctor . --ci
```

改完代码后同步到已安装副本：

```powershell
hermes plugins install "file:///D:/01-项目/hermes-pet" --force --enable
```

## 在 Hermes 里怎么打开、怎么用

1. **启动桌宠**（保持运行）：

   ```powershell
   cd D:\01-项目\hermes-pet
   npm start
   ```

2. **确认插件已启用**：

   ```powershell
   hermes plugins list --plain --no-bundled
   # 期望看到：enabled  git  0.1.0  hermes-pet
   ```

3. **在 Hermes 对话里直接说，它会自动调用对应工具**：

   | 你说的话 | 触发的工具 |
   |---|---|
   | 看看桌宠现在什么状态 | `hermes_pet_status` |
   | 让它说句话 / 播报一句 | `hermes_pet_say` |
   | 摸摸头 / 戳一下 | `hermes_pet_interact` |
   | 切换成工作中 / 成功 / 失败 | `hermes_pet_set_status` |
   | 把桌宠喊出来 / 打开它的聊天窗 | `hermes_pet_show` / `hermes_pet_open_chat` |

4. **被动联动（不用开口）**：Hermes 有任务在跑时，桌宠自动切「待命 → 执行中 → 思考 → 成功/失败」，完成或失败会弹气泡 + 系统通知。

> 反过来桌宠也能发起：把文件拖到它身上、或在聊天窗里说话，都是把任务派给 Hermes 执行。

## 工作方式

```
┌────────────────┐   每 3 秒轮询    ┌──────────────────┐
│  Hermes 服务   │ ◄────────────── │ hermes-bridge.js │
│  /api/status   │                 │  (主进程侧)       │
│  /kanban/board │ ──────────────► │  状态归一化       │
└────────────────┘                 └────────┬─────────┘
                                            │ 任务跳变
┌────────────────┐   HTTP + token   ┌───────▼─────────┐
│ Hermes 插件    │ ───────────────► │   桌宠状态机     │
│ 6 个工具        │ ◄─────────────── │ 窗口 / 气泡 / 通知│
└────────────────┘   127.0.0.1      └─────────────────┘
```

两个方向都不写库：插件不碰 SQLite，桌宠不复制看板，全部走 Hermes 已经开放的 HTTP 接口。

> 唯一的例外是**对话**。Hermes 把「发一条消息」只开在 WebSocket 的 JSON-RPC 上（`prompt.submit`），
> REST 侧只有读（`/api/sessions/{id}/messages`）。照着 REST 猜一个 POST 端点会一直 405。
> 所以桌宠自己常驻一条 socket，细节和踩坑见 `hermes-chat.js` 顶部注释。

## 目录结构

```
main.js                 主进程：窗口、托盘、穿透、桥接、状态机
preload.js              contextBridge 暴露给渲染层的受限 API
renderer/               pet.html/pet.js 桌宠窗，chat.html/chat.js 聊天窗
                        pet-puppet.js 2.5D 分层渲染（当前使用）
                        pet-live2d.js Live2D 渲染层（备用，未启用）
hermes-bridge.js        读取 Hermes gateway 状态、任务、会话、技能
hermes-chat.js          对话通道：常驻 WebSocket + prompt.submit（REST 没有写入口）
pet-emotion.js          心情与好感衰减
pet-regions.js          四区热区命中（头/脸/身/脚）
pet-runtime.js          六状态映射
memory.js               按日归档会话，取近 14 天摘录
persona.json            人格与称呼配置（程序直接读）
hermes_pet_plugin.py    Hermes 插件：6 个工具的桥接客户端
plugin.yaml             插件清单（standalone）
skills/hermes-pet/      插件自带的 SKILL.md
assets/states/v2/       状态立绘、表情、特效（aligned 为对齐后的正式版）
assets/pet-layers/      2.5D 分层素材：body/head/eyes/mouth + meta.json
assets/ui/              头像、气泡三态 9-slice 与对应尾巴、图标
tools/                  拆层与验收工具：imgutil / analyze-layers / build-pet-layers /
                        preview-pet（三视角）/ preview-bubble（气泡三态）/ grab-screen（截桌面）
test/                   unit + e2e 冒烟
docs/                   规格书、对标差距、素材规格、实施指令
```

## 2.5D 分层渲染（已落地）

目标是让桌宠「会扭头、会呼吸、能被戳」。最终**没有走 Live2D 骨骼路线**，而是自研了一套分层 puppet。

### 为什么不是 Live2D

Live2D 要求素材是**分层 PSD**（头发/脸/眼/身各自独立、边缘过画），再用 Cubism Editor 绑骨骼导出 `.moc3`。而项目现有素材是 AI 生成的**单层整图**，喂进去只会被当成一整块皮拉扯。出分层 PSD 是美术工程，AI 无法一次性产出严格对齐的多图层。

于是换了个思路：**AI 只负责生成同姿势的表情差分，图层由程序差分算出。**

### 拆层原理

| 图层 | 来源 | 作用 |
|---|---|---|
| `body.png` | 原立绘完整图 | 底层。头部转开时露出的是原图真实像素，天然填缝，不会出现补绘条纹 |
| `head.png` | 原立绘头部，眼窝替换成闭眼版的眼皮 | 绕脖子轴心独立旋转；眨眼时眼睛层收拢即露出眼皮 |
| `eyes.png` | 睁眼与闭眼的差异像素 | 眯眼压缩、视线偏移、眨眼 |
| `mouth.png` | 睁眼与张嘴的差异像素 | 说话开合 |

三个关键点：

- **眼睛层与头部层逐像素对齐**——它是从同一张图差分出来的，不存在「AI 分别画几张对不上」的问题
- **闭眼不靠贴图切换**——`head` 的眼窝本来就是闭眼眼皮，眼睛层一收就自然闭合
- **扭头不留缝**——`body` 保留完整原图，头部转开后露出的是原画内容

### 素材与构建

```powershell
npm run build:layers
```

前置：`assets/states/v2/aligned/state/state-idle.png`（睁眼闭嘴基准）+ 两张 AI 同姿势差分图（闭眼、张嘴）放在 `.tmp/ai-raw/`。差分图不入库。

产出 `assets/pet-layers/`：4 张图层 + `meta.json`（画布尺寸、颈部切缝 `y=258`、旋转轴心、眼睛与嘴巴矩形）。

### 渲染

`renderer/pet-puppet.js` 用 PixiJS 组织四层，头、眼、嘴、身各自独立变换：

- 头部容器的 `pivot` 设在脖子根部，旋转时才像「扭头」而不是「整体平移」
- 眼睛锚点在**下沿**：眯眼时上眼睑向下压、下沿不动，符合真实半闭眼
- 眼睛主要靠纵向压缩表现开合，只在接近完全闭合时才收 alpha——直接淡出会让半睁的眼睛发灰透明
- 嘴巴锚点靠上唇，说话时按正弦节奏开合，不依赖 TTS
- 呼吸以脚底为基准缩放，看起来像重心起伏而不是整体膨胀

对外接口（`isReady` / `setState` / `setLook` / `speak` / `onInteract`）与原 Live2D 层完全一致，`pet.js` 无需改动。任何一步失败都静默回退静态立绘，`body[data-live2d]` 标记当前模式。

### 立体化：从「平面的会动」到「有体积」

对标结论是「大肥鱼的立体感是假的」（平面 PNG + CSS 形变）。真立体感得靠三条物理线索，所以补了这些：

| 手段 | 做法 | 效果 |
|---|---|---|
| 脚底投影 | `assets/pet-layers/shadow.png`（椭圆双层衰减），随呼吸起伏、起跳时缩小变淡 | 角色被「按」到桌面上，不再飘 |
| 落地空间 | `fit()` 里在脚底留 9–14px 屏幕空间 | 影子有地方落，不被窗口裁掉 |
| 转头透视 | 头部沿 X 轴压扁 `1 - |lookX|·0.085` + 斜切 `-lookX·0.072` | 平面的脸开始有体积 |
| 对立式 | 身体横向位移与视线相反（`-lookX·1.5`），并轻微反向旋转 | 像真的在转身，而不是整体平移 |
| 挤压守恒 | 纵向拉伸时横向同步压缩 | 呼吸像重心起伏，不是整体膨胀 |

验收：`node tools/preview-pet.js` 输出「正面 / 向右看 / 向左看」三视角对比图。

自检：`PET_STATE_TEST=success PET_SHOT=1 npm start` 会强制切到某状态并截图，核对参数驱动是否生效。

### Live2D 路线（保留，未启用）

Phase 0 的技术验证仍然可用：`PET_LIVE2D_TEST=1 npm start` 会开一个独立验证窗，用官方示例模型 Hiyori 跑通 PixiJS + Cubism Core 4.2 渲染。相关代码在 `renderer/live2d-test.*` 与 `renderer/pet-live2d.js`。

留着的意义：将来若真出了分层 PSD 并绑好骨骼，把 `index.html` 的脚本换回 `pet-live2d.js` 即可，其余不动。

```text
PixiJS              6.5.10（pixi-live2d-display 0.4 只支持 v6）
pixi-live2d-display 0.4.0（Cubism 4 运行时）
Cubism Core         4.2.4（csmGetVersion=0x04020004，官方 CDN 的 5.1 会让 Moc 解析返回空）
```

示例模型 Hiyori 来自 Live2D 官方 CubismWebSamples，按 Free Material License 使用，仅用于技术验证，不随角色一起分发。

## 路线图

- [x] 六态视觉与状态播报打通
- [x] 四区互动、心情与好感
- [x] 拖文件派单、聊天窗、记忆归档
- [x] 插件化，对外提供 6 个工具
- [x] 真实任务驱动的成功/失败播报全链路验证
- [x] Live2D 渲染技术验证（Phase 0：PixiJS + Cubism Core 4.2 跑通）
- [x] 2.5D 分层渲染：AI 表情差分 → 程序拆层 → PixiJS 分层驱动（扭头/眨眼/口型/视线）
- [x] 情绪表情接入（12 张表情贴片，六态 + 8 种情绪映射，状态优先级高于情绪）
- [x] 语音输入转写走本地 ASR（sherpa-onnx WASM + 首次启动下载模型，中文识别实测平均 94.3%）
- [x] 仪表盘形态：任务列表与 Agent 状态面板（四组任务、空态、总数与滚动）

## 已知未做

- 语音输出 TTS（明确不做）
- 分层素材的接缝问题（`face-calm.png` 是整图，叠在已有脸的 body 上有硬边），已诊断未修
- 只有 Huihui / Kangkang / Yaoyao 三个本机音色，晓伊/晓晓需要装 Windows OneCore 中文语音包
- 屏幕理解与 UI Automation：不做，重复实现等于第二套权限模型
- 跨日记忆「隔天主动提起」待实测
- 审批白名单只有总开关，没有「只对这类操作提醒」的细粒度规则
- 记忆面板只读，不能在桌宠侧修改 Hermes 的记忆
- **真 3D 模型**：现在是分层 2D + 立体化运动。要做真 3D 得先有 GLB/VRM 资产（AI 图生 3D 对二次元角色容易形变，手工建模是几十小时的活），属于独立任务
- Hermes 启动时自动拉起桌宠：未做，只有系统登录级的开机自启

四个历史阶段各自落到什么状态、这个桌宠的能力边界在哪，见 [docs/四阶段复盘与能力边界.md](./docs/四阶段复盘与能力边界.md)。

## 常见问题

**桌宠窗口挡住了鼠标操作？**
只有小人轮廓内接收点击，其余区域自动穿透；也可以在右键菜单里切换整窗穿透。

**插件调用返回「桌宠没有运行」？**
`npm start` 没有在跑。插件不会自己拉起 Electron，这是刻意的边界。

**改了代码，Hermes 里还是旧行为？**
插件装的是副本，需要 `hermes plugins install "file:///..." --force --enable` 同步一次。

## 提交约定

```
<type>: <一句话说清改了什么>

type ∈ feat | fix | docs | style | refactor | test | chore
```

- 一条提交只做一件事，标题 50 字内，不加句号。
- 素材、截图、生成物不进仓库（`assets/` 下的正式立绘除外）。
- 例外：`docs/` 下的验收截图可以入库，用来复核实机效果；单张控制在 400KB 以内，同一次验收不超过 3 张。
- 改行为要同时给出验证方式（命令或截图路径）。

## 许可

[MIT](LICENSE) © 2026 汤伊轲
