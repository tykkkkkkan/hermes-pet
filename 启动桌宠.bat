@echo off
rem 手动启动 Hermes 桌宠（双击即可）。已配置开机自启，这里只是兜底入口。
cd /d "%~dp0"
rem 有些工具会把 ELECTRON_RUN_AS_NODE 设成 1，那样 electron.exe 会变成纯 node 进程、窗口不出现
set ELECTRON_RUN_AS_NODE=
start "" ".\node_modules\electron\dist\electron.exe" .
