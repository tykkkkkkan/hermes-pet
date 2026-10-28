"""Hermes Pet plugin registration and local authenticated bridge client."""

from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


_BRIDGE_FILE = Path(os.environ.get("LOCALAPPDATA", "")) / "hermes" / "hermes-pet-bridge.json"
_LOCK = threading.Lock()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _error(message: str) -> str:
    return _json({"success": False, "error": message})


def _bridge_request(method: str, route: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        with _LOCK:
            record = json.loads(_BRIDGE_FILE.read_text(encoding="utf-8"))
        port = int(record["port"])
        token = str(record["token"])
    except Exception:
        raise RuntimeError("Hermes 桌宠没有运行，请先启动 hermes-pet")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}",
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=None if payload is None else _json(payload).encode("utf-8"),
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read().decode("utf-8"))
        except Exception:
            data = {"error": str(exc)}
        raise RuntimeError(data.get("error") or f"桌宠桥接返回 HTTP {exc.code}")
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"桌宠桥接不可用：{exc}")
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "桌宠桥接请求失败")
    return data


def _tool(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


STATUS = _tool(
    "hermes_pet_status",
    "读取 Hermes 专属桌宠的当前状态、任务队列、心情和称呼。桌宠未启动时返回明确错误。",
    {},
)
SAY = _tool(
    "hermes_pet_say",
    "让 Hermes 桌宠主动播报一段话。适合任务完成、失败、提醒休息或需要桌宠出声时使用。",
    {"text": {"type": "string", "description": "要播报的内容。"},
     "notify": {"type": "boolean", "description": "是否同时触发系统通知。默认 false。"},
     "task_result": {"type": "boolean", "description": "是否属于任务结果播报。默认 false。"}},
    ["text"],
)
SET_STATUS = _tool(
    "hermes_pet_set_status",
    "切换桌宠的状态动画。只允许 idle、thinking、working、success、error、sleep。",
    {"status": {"type": "string", "enum": ["idle", "thinking", "working", "success", "error", "sleep"]},
     "status_text": {"type": "string", "description": "可选的状态文字。"}},
    ["status"],
)
INTERACT = _tool(
    "hermes_pet_interact",
    "触发桌宠指定热区的互动反应。区域可选 head、face、body、feet。",
    {"zone": {"type": "string", "enum": ["head", "face", "body", "feet"]}},
    ["zone"],
)
SHOW = _tool("hermes_pet_show", "显示 Hermes 桌宠窗口。", {})
OPEN_CHAT = _tool("hermes_pet_open_chat", "打开 Hermes 桌宠聊天窗口。", {})


def _call(route: str, args: dict[str, Any], **_: Any) -> str:
    try:
        return _json({"success": True, **_bridge_request("POST", route, args).get("state", {})})
    except Exception as exc:
        return _error(str(exc))


def _status(args: dict[str, Any], **kwargs: Any) -> str:
    try:
        return _json({"success": True, **_bridge_request("GET", "/state").get("state", {})})
    except Exception as exc:
        return _error(str(exc))


def _say(args: dict[str, Any], **kwargs: Any) -> str:
    return _call("/say", {"text": str(args.get("text") or ""), "notify": bool(args.get("notify")),
                           "taskResult": bool(args.get("task_result"))}, **kwargs)


def _set_status(args: dict[str, Any], **kwargs: Any) -> str:
    return _call("/status", {"status": args.get("status"), "statusText": args.get("status_text", "")}, **kwargs)


def _interact(args: dict[str, Any], **kwargs: Any) -> str:
    return _call("/interact", {"zone": args.get("zone")}, **kwargs)


def _show(args: dict[str, Any], **kwargs: Any) -> str:
    return _call("/show", {}, **kwargs)


def _open_chat(args: dict[str, Any], **kwargs: Any) -> str:
    return _call("/open-chat", {}, **kwargs)


def register(ctx: Any) -> None:
    tools = (
        ("hermes_pet_status", STATUS, _status),
        ("hermes_pet_say", SAY, _say),
        ("hermes_pet_set_status", SET_STATUS, _set_status),
        ("hermes_pet_interact", INTERACT, _interact),
        ("hermes_pet_show", SHOW, _show),
        ("hermes_pet_open_chat", OPEN_CHAT, _open_chat),
    )
    for name, schema, handler in tools:
        ctx.register_tool(name=name, toolset="hermes_pet", schema=schema, handler=handler)
