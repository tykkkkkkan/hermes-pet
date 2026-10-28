# hermes-pet

Hermes 的桌宠：Windows 本地 Electron 透明置顶窗口 + Hermes 插件桥接。
它不是第二个 AI —— 它是 Hermes 的「脸」，播报的每一句都要能追溯到真实的接口返回或数据库记录。

![预览](docs/preview.png)

## 当前状态

版本 `0.1.0`。立绘为 2D 分层（状态立绘 + 表情分层），不是真 3D。

| 验证项 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `node --test test/*.test.js` | 17/17 通过 |
| 实机冒烟 | `npm run smoke` | 8/8 通过 |
| 插件校验 | `npm run plugin:validate` | `ok: true` |
| 插件注册 | `hermes plugins doctor . --ci` | 注册 6 个工具 |

冒烟测试会真的启动 Electron、用 CDP 进窗口逐项验收、截图留证后自动关闭。

## 快速开始

```powershell
npm install
npm start
```

`npm start` 需要保持运行。桌宠关闭后，插件调用会返回「桌宠没有运行」——这是设计，不会偷偷拉起 Electron。

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

## Hermes 插件接入

插件通过本机 `127.0.0.1` 桥接桌宠，不复制 Hermes 的任务看板。桌宠启动时自动写桥接文件：

```text
%LOCALAPPDATA%\hermes\hermes-pet-bridge.json
```

该文件由桌宠托管（含 port 与 token），不需要手工编辑。

提供的 6 个工具：

```text
hermes_pet_status
hermes_pet_say
hermes_pet_set_status
hermes_pet_interact
hermes_pet_show
hermes_pet_open_chat
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

## 已知未做

按 `docs/对标差距.md` 的分类，以下能力尚未实现或明确押后：

- 语音输出 TTS、本地 ASR（当前只有浏览器 SpeechRecognition 入口）
- 屏幕截图与视觉理解、UI Automation
- 流程库、事件溯源存储、人设字段级锁
- 任务失败播报目前只覆盖 `blocked`，其他失败态未分类
- 跨日记忆「隔天主动提起」待实测；四区热区坐标待实点复核

## 提交约定

```
<type>: <一句话说清改了什么>

type ∈ feat | fix | docs | style | refactor | test | chore
```

- 一条提交只做一件事，标题 50 字内，不加句号。
- 素材、截图、生成物不进仓库（`assets/` 下的正式立绘除外）。
- 改行为要同时给出验证方式（命令或截图路径）。
