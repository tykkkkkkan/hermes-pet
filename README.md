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
| 表现 | 10 套状态立绘 + 6 张表情分层；v2 素材带凹陷遮蔽、暗部边缘光与投影；状态切换有过渡 |
| 状态 | 心情与好感衰减、按日归档会话（近 14 天摘录）、六状态映射（待命/思考/执行/成功/失败/休眠） |
| 互动 | 头/脸/身/脚四区热区、右键菜单、拖文件建任务、状态胶囊、系统通知 |
| 集成 | 读取 Hermes 的 gateway 状态、任务看板、会话历史与技能目录；对外提供 6 个插件工具 |

立绘是 **2D 分层**（状态层 + 表情层 + 特效层），不是真 3D。

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

## 目录结构

```
main.js                 主进程：窗口、托盘、穿透、桥接、状态机
preload.js              contextBridge 暴露给渲染层的受限 API
renderer/               pet.html/pet.js 桌宠窗，chat.html/chat.js 聊天窗
hermes-bridge.js        读取 Hermes gateway 状态、任务、会话、技能
pet-emotion.js          心情与好感衰减
pet-regions.js          四区热区命中（头/脸/身/脚）
pet-runtime.js          六状态映射
memory.js               按日归档会话，取近 14 天摘录
persona.json            人格与称呼配置（程序直接读）
hermes_pet_plugin.py    Hermes 插件：6 个工具的桥接客户端
plugin.yaml             插件清单（standalone）
skills/hermes-pet/      插件自带的 SKILL.md
assets/states/v2/       状态立绘、表情、特效（aligned 为对齐后的正式版）
test/                   unit + e2e 冒烟
docs/                   规格书、对标差距、素材规格、实施指令
```

## 路线图

- [x] 六态视觉与状态播报打通
- [x] 四区互动、心情与好感
- [x] 拖文件派单、聊天窗、记忆归档
- [x] 插件化，对外提供 6 个工具
- [ ] 真实任务驱动的成功/失败播报全链路验证
- [ ] 语音输入转写走本地 ASR（当前仅浏览器 SpeechRecognition 入口）
- [ ] 仪表盘形态：任务列表与 Agent 状态面板

## 已知未做

- 语音输出 TTS（明确不做）、本地 ASR 未接
- 屏幕理解与 UI Automation：不做，重复实现等于第二套权限模型
- 任务失败播报目前只覆盖 `blocked`，其他失败态未分类
- 跨日记忆「隔天主动提起」待实测；四区热区坐标待实点复核

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
- 改行为要同时给出验证方式（命令或截图路径）。

## 许可

[MIT](LICENSE) © 2026 汤伊轲
