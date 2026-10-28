# Hermes Pet

Hermes 桌宠是本机 Electron 伙伴。它负责显示 Hermes 任务状态、播报任务结果、展示状态动画、接受热区互动和打开聊天窗口。

## 工具使用

- 需要了解桌宠是否运行、当前心情、称呼和 Hermes 任务队列时，调用 `hermes_pet_status`。
- 任务完成或失败时，优先调用 `hermes_pet_say`，任务结果需要系统通知时传 `notify=true`、`task_result=true`。
- 任务开始处理时调用 `hermes_pet_set_status` 设置 `working`；等待模型时设置 `thinking`；完成设置 `success`；失败设置 `error`；恢复待命设置 `idle`。
- 需要桌宠回应触摸时调用 `hermes_pet_interact`，区域使用 `head`、`face`、`body` 或 `feet`。
- 用户要求查看桌宠时调用 `hermes_pet_show`；需要进入桌宠对话时调用 `hermes_pet_open_chat`。

## 边界

- 桌宠未启动时，工具会返回错误，不会偷偷启动 Electron。
- 任务创建、状态流转和真实执行仍使用 Hermes 原生看板，不在插件里复制一套任务系统。
- 插件只访问 `127.0.0.1` 的桌宠桥接端口，桥接令牌从 Hermes 用户目录下的运行时文件读取。
