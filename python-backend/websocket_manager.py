"""
MCP 工具 - WebSocketManager
- 连接管理机制
- 基于消息 ID 的请求-响应模式
- 异步通信实现
- 错误处理和资源清理
"""

from typing import Set, Dict
from fastapi import WebSocket
import asyncio

class WebSocketManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.pending_responses: Dict[str, asyncio.Future] = {}  # 存储待响应的 Future

    async def connect(self, websocket: WebSocket):
        print("正在接受 WebSocket 连接...")  # 调试
        await websocket.accept()
        print("WebSocket 连接已接受")  # 调试
        self.active_connections.add(websocket)
        print(f"当前连接数: {len(self.active_connections)}")  # 调试

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        # Cancel any pending requests for this connection
        for future in self.pending_responses.values():
            if not future.done():
                future.cancel()

    async def send_message(self, message: dict) -> dict:
        print("当前活跃连接:", self.active_connections)  # 调试
        if not self.active_connections:
            raise ConnectionError("没有活动的 WebSocket 连接")

        websocket = next(iter(self.active_connections))
        message_id = str(id(message))  # 生成唯一 ID 标识本次请求
        message["message_id"] = message_id  # 加入消息 ID

        # 创建一个 Future 用于等待响应
        future = asyncio.get_event_loop().create_future()
        self.pending_responses[message_id] = future

        try:
            print("正在发送消息:", message)  # 调试图
            await websocket.send_json(message)  # 发送请求
            response = await asyncio.wait_for(future, timeout=30.0)  # 等待响应（超时 30s）
            return response
        except asyncio.TimeoutError:
            raise ConnectionError("等待 WebSocket 响应超时: message_id:", message_id)
        finally:
            self.pending_responses.pop(message_id, None)  # 清理 Future

    async def handle_response(self, data: dict):
        """处理 Postman 返回的响应"""
        message_id = data.get("message_id")
        print("开始响应-----:", data, self.pending_responses)
        if message_id in self.pending_responses:
            future = self.pending_responses[message_id]
            if not future.done():
                future.set_result(data)  # 通知 `send_message` 已收到响应