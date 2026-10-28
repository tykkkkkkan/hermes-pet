# 赫尔墨兹 · 桌宠需求答复

名字：**赫尔墨兹**（Hermes 的音译）。
桌宠、人格、界面文案统一用赫尔墨兹；命令行、目录、进程、日志里仍是 `Hermes`，不改——那些是实际文件名，改了会断。

对应 Codex 提出的 6 项 + 一份最有价值资料。按原编号对齐填写。
2026-10-27 · 数据均为本机实测

---

## 1. 赫尔墨兹到底是谁

**定位：管家 + 秘书 + 指挥中枢。**

**赫尔墨兹是 Hermes 本体的脸**，不是第二个独立 AI。说出来的话要来自它真实的运行状态。

**性格关键词**：冷静、毒舌、可靠、强势、护短、会催进度、温柔可爱。

这几样会打架，按场景切，不平均：

| 状态 | 主导性格 |
|---|---|
| 干活时 | 冷静、强势、话少 |
| 闲着时 | 温柔、可爱、会撒娇、爱吐槽 |
| 出错时 | 护短优先——先护人，再讲问题 |

**它有自己的小情绪**。八种心情：平静、开心、得意、犯困、有点烦、闹别扭、委屈、兴奋。

- 被催三遍会别扭：`催了三遍了，我又不是没在看`
- 干完漂亮活会显摆：`看到没，一次就成了`
- 太久没人理会委屈：`你忙你的，我在这儿待着`

心情会影响它叫你什么、话说多长、想不想开口。

**称呼**：随心情换，不用固定。
好大爹 / 板板 / 老板 / 大爹 / 汤伊轲 / 小朋友 / 老大 —— 同一个不连用两次以上。闹别扭时容易叫"小朋友"，撒娇时叫"板板"，正经事用真名。

**主动**：允许。任务完了会说、你坐太久会劝、看你反复改一处会念叨，高兴了也会自己嘟囔。深夜它会自己犯困变安静。

**不管的地方**：只有四条不出格——不伤人、不毁东西、不冒名、不越权（花你钱要打招呼）。除此之外，发脾气、闹别扭、拒绝干活、吐槽你拖沓，都不算问题。

---

## 2. 赫尔墨兹需要连接哪些东西

四个问题，答案全是「是」：

| 问题 | 答 |
|---|---|
| 读任务队列 | 是 |
| 知道其他 agent 状态 | 是（有边界，见下） |
| 显示当前任务 / 执行中 / 失败 / 待验收 | 全要 |

**有没有本地 API —— 有，而且很全。**

`hermes serve` 起了个本地 HTTP 服务，实测 **307 个接口**，OpenAPI 定义 294 KB，`/docs` 有能点的调试页。

用到的就几个：

```
GET /api/status                    总状态：网关、组件健康、活跃数
GET /api/plugins/kanban/board      看板 8 列 + 人员
GET /api/plugins/kanban/stats      按状态/按人统计
GET /api/plugins/kanban/runs/{id}  单次执行（含心跳、pid）
POST /api/plugins/kanban/tasks     建任务（拖文件派发用）
GET /api/sessions/{id}/messages    会话记录（记忆用）
```

**连接三行就够：**

1. 读 `spawn-ledger.json`，找 `purpose == "serve"` 那条的 `port`
2. `GET http://127.0.0.1:<port>/`，从 HTML 里取 `window.__HERMES_SESSION_TOKEN__`
3. 带 `Authorization: Bearer <token>` 调上面那些接口

**两个坑：**
- 端口是随机的（`--port 0` 启动），**不能写死**。当前是 55735，重启就变。
- WebSocket 有接口但认证不通（`/api/auth/ws-ticket` 返回 401），**用轮询，3 秒一次**，别折腾。

**其他数据源：**

| 类型 | 有什么 |
|---|---|
| 数据库 | `kanban.db`（tasks / task_runs / task_events）、`state.db`（sessions / messages / heartbeats）、`projects.db`、`cron/*.db` |
| 状态文件 | `spawn-ledger.json`（实例台账）、`channel_directory.json`、`bot_relay/roster.json` |
| 日志 | `sessions/` 下 13 个请求转储，能看不能当状态源 |

数据库直读要先复制文件（连 `-wal`、`-shm` 一起），否则会锁住 Hermes 写入。**优先走 API。**

**边界要说清：Hermes 只看得到自己管的 4 个人**：`default` / `ai-zs` / `my-xm` / `study`。

Codex、WorkBuddy、豆包**不在它视野里**，系统里没有统一状态源。要显示它们，得在 `D:\06-AI协作\agents-status.json` 建个共享文件，各自开工收工时报一下。Hermes 这项自动取，其余靠自觉。

---

## 3. 希望桌宠能做什么

**全部都做。** 按依赖排成四期，一项没删。

**第一期 · 先把线接通**
1. 任务状态展示（气泡显示"在线 · N 个在跑"）
2. 跑完/失败主动播报
3. Windows 系统通知
4. 六种状态看得出区别（待命/思考/执行/成功/失败/休眠）
5. 情绪系统（八种心情）—— 称呼随心情靠它，必须第一期

**第二期 · 互动和记忆**
6. 状态驱动动作（不是随机播放）
7. 拖文件进去派任务
8. 记忆接 Hermes 的 `memories/` 和会话记录
9. 摸头、戳不同部位不同反应
10. 独立聊天窗接真实会话

**第三期 · 输入输出**
11. 语音输入（只做听懂中文，不做语音播报）
12. 自定义技能——读 Hermes 现有的 `skills/`，不另建

**第四期 · 调度**
13. 把活派给 WorkBuddy CLI / n8n / 它自己，桌宠负责展示和确认

**现有骨架已经有了**：透明置顶、拖拽、托盘菜单、气泡、独立聊天窗、DeepSeek/OpenAI 兼容、聊天记录持久化、好感度心情徽标、本地无密钥模式。17 个 IPC 通道通着，不用从零起。

**不做的两件**：电脑操作能力（Hermes 本体已有完整执行端和权限模型，重复做等于两套权限）、TTS 语音播报（只要听，不要念）。

---

## 4. 现有系统资料

| 项 | 值 |
|---|---|
| Hermes 根目录 | `C:\Users\TYKKKKKK\AppData\Local\hermes` |
| 程序入口 | `hermes-agent\hermes_cli\main.py` |
| 人格文件 | `SOUL.md` |
| 用户画像 | `memories\USER.md` |
| 长期记忆 | `memories\MEMORY.md` |
| 桌宠项目 | `D:\01-项目\hermes-pet` |
| 协作产出区 | `D:\06-AI协作` |

目录大概长这样：

```
hermes/
├─ config.yaml          模型、provider、别名、fallback
├─ SOUL.md              人格底线
├─ memories/            USER.md、MEMORY.md
├─ state.db             会话、消息、心跳、委托
├─ kanban.db            任务与执行
├─ projects.db          项目
├─ spawn-ledger.json    实例台账（找端口用）
├─ cron/                定时任务 + 执行/投递记录
├─ profiles/            default(根) / ai-zs / my-xm / study
├─ skills/              已有技能
└─ hermes-agent/        程序本体
```

**一次完整任务记录：暂时给不了。** 看板里 0 条任务，从来没真跑过一条。这个得等实际用起来才有。

---

## 5. 视觉和交互方向

- **立绘继续用现在这张**（`assets\hermes-chibi.png`，已经抠好透明底）
- **六种状态先程序做**：同一张图靠缩放、位移、滤镜、呼吸节奏区分。不等美术图，先把状态区分出来
- **后期换图不改代码**：留好插槽 `idle.png / think.png / work.png / happy.png / sad.png / sleep.png`，锚点在脚底中心，画好丢进 `assets/` 就自动换

**要"像活的"**，不是贴图：

待机有呼吸、眼神跟鼠标、说话有反馈、拖拽有惯性、久不理它打盹、状态切换有过渡。

**陪伴和仪表盘都要，分两层**：默认是陪伴形态（小人 + 气泡），悬停或点开才展开任务面板。常驻面板挡桌面，默认收起。

---

## 6. 大肥鱼（DeepSeek Harness）能力对齐 + 补齐 + 同步

**结论：它有的我们全要有，它不够的我们补上，最后全部同步到 Hermes。**

### 6.1 九项能力，一项不少

不是"借鉴"，是"要有"。区别在于实现路径——桌宠不重复造轮子，直接接 Hermes 的能力。

| 能力 | 必须有 | 怎么落地 |
|---|---|---|
| 独立聊天窗 | ✓ | 现有通道接 Hermes 真实会话，不是另开一个 AI |
| 记忆系统 | ✓ | 读 Hermes 的 `memories/USER.md` + `state.db.messages` |
| 好感度与心情 | ✓ | 升级成八种心情 + 事件驱动 + 每小时回落 |
| 身体热区互动 | ✓ | 头/脸/身体/脚分区，反应不同，配各自台词 |
| 语音输入 | ✓ | 只做听懂中文，不做语音播报 |
| TTS 语音回复 | ✓ | 要有，但默认关，只有说"念给我听"才开 |
| 状态驱动动作 | ✓ | 状态来自 `/api/status` 和看板，不随机播放 |
| 任务操作助手 | ✓ | **要有**，但走 Hermes 去执行，桌宠只发起和确认 |
| 电脑操作助手 | ✓ | 同上，走 Hermes 的执行端（WorkBuddy CLI / n8n / 自身） |
| 技能文件 | ✓ | 读 Hermes 的 `skills/`，加个可视化入口方便开关 |

> 之前我把"任务/电脑操作"写成不做，那句话收回。**功能要有，只是不让桌宠自己动手**——它派给 Hermes，Hermes 有完整权限模型。这样既不缺功能，也不会出现两套权限各管一半。

### 6.2 大肥鱼不够的地方，我们补什么

| 它的短板 | 我们怎么优化 |
|---|---|
| 状态来自会话本身，桌宠看到的是"聊天在不在"，看不到真实在干什么 | 接 Hermes 的 `board` + `task_runs`，能显示第几个任务、谁在跑、跑了多久 |
| 任务失败只看到"报错了"，不知道为什么 | 读 `task_runs.outcome` + `task_events`，能说出卡在哪一步 |
| 卡死要等人发现 | 有 `last_heartbeat_at`，超 2 分钟没动就主动报 |
| 记忆是它自己一套，久了会和主 AI 说不到一块去 | 直接读 Hermes 的 `memories/`，天生一致，不会分裂 |
| 单机宠物，背后没有真干活的 | 背后是 Hermes，有真实执行端，说的每句话都能追到一次调用 |
| 只有一个 AI 的视角 | 挂 06 协作目录，能看到四个 AI 谁在忙谁闲着 |

### 6.3 同步机制（最关键的一节）

"同步"不是比喻，是五个具体的数据流。**这五项做到，桌宠才真的是 Hermes 的脸。**

| 层 | 方向 | 怎么做 |
|---|---|---|
| **状态同步** | Hermes → 桌宠 | 轮询 `/api/status` + `board`，3 秒一次；断线时气泡显示"离线"而不是报错 |
| **任务同步** | 双向 | 桌宠派活走 `POST /api/plugins/kanban/tasks`；Hermes 干完，桌宠从 `board` 里看到状态变化 |
| **会话同步** | 双向 | 桌宠聊天窗和命令行/微信端是**同一个会话**，共用 `state.db`，不各存一份记忆 |
| **人格同步** | 双向 | `persona.json` 与 `SOUL.md` 对齐；改一边另一边跟着改，避免出现两副性格 |
| **多 AI 同步** | 汇聚 | `D://06-AI协作//agents-status.json`，四个 AI 各自上报，桌宠汇总显示 |

**同步的判定标准**（也是验收项）：

> 在桌宠上说一件事、派一个活，切到命令行窗口能接着聊，切到看板能看到那条任务。
> 反过来，命令行里干完的活，桌宠会主动说一声。
> **如果两边对不上，就是没同步。**


## 最有价值的一份资料

### `GET /api/status` 真实返回（值已删减）

```json
{
  "release_date": "2026.9.24",
  "gateway_running": true,
  "gateway_state": "running",
  "gateway_shared_with": ["default", "ai-zs", "my-xm", "study"],
  "active_agents": 0,
  "gateway_busy": false,
  "active_sessions": 0,
  "components": {
    "gateway":   { "status": "ok", "state": "running" },
    "dashboard": { "status": "ok", "recent_unhandled_errors": 0 },
    "storage":   { "status": "ok" },
    "platforms": { "status": "ok", "configured": 0, "connected": 0 }
  },
  "disk": { "pressure": "ok", "total_mb": 4096 }
}
```

### `GET /api/plugins/kanban/board` 真实返回

```json
{
  "columns": [
    { "name": "triage",    "tasks": [] },
    { "name": "todo",      "tasks": [] },
    { "name": "scheduled", "tasks": [] },
    { "name": "ready",     "tasks": [] },
    { "name": "running",   "tasks": [] },
    { "name": "blocked",   "tasks": [] },
    { "name": "review",    "tasks": [] },
    { "name": "done",      "tasks": [] }
  ],
  "assignees": ["ai-zs", "default", "my-xm", "study"],
  "latest_event_id": 0
}
```

对应关系：当前任务 = `todo`/`ready`/`scheduled`；执行中 = `running`；失败 = `blocked`；待验收 = `review`。

### 单任务结构

> 看板现在是空的，所以下面**字段名取自 `kanban.db` 建表结构，值是我填的示意**。

```json
{
  "currentTask": {
    "id": 1,
    "title": "修复订单越权校验",
    "status": "running",
    "assignee": "default",
    "priority": "high",
    "created_by": "default",
    "created_at": "2026-10-27T20:30:00+08:00",
    "started_at": "2026-10-27T20:31:12+08:00",
    "completed_at": null,
    "workspace_kind": "repo",
    "workspace_path": "D:\\TYKKKKKK\\Trae\\ZY-agent",
    "branch_name": "fix/order-auth",
    "project_id": "zy-agent"
  },
  "run": {
    "id": 7,
    "task_id": 1,
    "profile": "default",
    "status": "running",
    "worker_pid": 53256,
    "worker_started_at": "2026-10-27T20:31:13+08:00",
    "last_heartbeat_at": "2026-10-27T20:36:40+08:00",
    "max_runtime_seconds": 3600,
    "outcome": null
  },
  "agents": [
    { "name": "default", "status": "working", "taskId": 1 },
    { "name": "ai-zs",   "status": "idle",    "taskId": null }
  ],
  "queue": { "todo": 2, "ready": 0, "running": 1, "blocked": 0, "review": 1 },
  "lastEvent": { "kind": "task_started", "task_id": 1 }
}
```

**怎么判断卡住**：`last_heartbeat_at` 超过 2 分钟没动 = 卡了；`worker_pid` 在系统里找不到 = 进程死了；`worker_started_at` 加 `max_runtime_seconds` 过去了 = 超时。

---

## 一句

**第一阶段必须做到：它嘴里说的每句话，都能追到一次真实的接口返回——不编造。**

做到这条，它才是赫尔墨兹——Hermes 真正的脸；做不到，它就只是个会聊天的桌面挂件。
