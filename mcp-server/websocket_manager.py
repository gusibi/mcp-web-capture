"""
MCP 工具 - WebSocketManager
- 连接管理机制
- 基于消息 ID 的请求-响应模式
- 异步通信实现
- 错误处理和资源清理
"""

from typing import Set, Dict, Optional
import uuid
import asyncio

from fastapi import WebSocket
from config import settings

from logger import get_logger

logger = get_logger(__name__)

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # {conn_id: websocket}
        self.pending_responses: Dict[str, asyncio.Future] = {}  # 存储待响应的 Future

    async def connect(self, websocket: WebSocket, conn_id: Optional[str] = None) -> str:
        logger.debug("正在接受 WebSocket 连接...")
        await websocket.accept()
        conn_id = conn_id or str(uuid.uuid4())  # 如果没有提供 conn_id，则生成一个
        self.active_connections[conn_id] = websocket
        logger.info(f"新连接建立，conn_id: {conn_id}")
        logger.debug(f"当前连接数: {len(self.active_connections)}")
        return conn_id

    def disconnect(self, conn_id: str):
        logger.debug(f"正在断开 WebSocket 连接..., 当前连接数: {len(self.active_connections)}")
        if conn_id in self.active_connections:
            self.active_connections.pop(conn_id)
            logger.info(f"连接断开，conn_id: {conn_id}")
        logger.debug(f"已断开 WebSocket 连接，当前连接数: {len(self.active_connections)}")

    async def send_message(
        self, 
        message: dict, 
        target_conn_id: Optional[str] = None
    ) -> dict:
        """
        发送消息到指定连接（默认发送到第一个可用连接）
        - target_conn_id: 可指定目标连接的 conn_id
        """
        if not self.active_connections:
            raise ConnectionError("没有活动的 WebSocket 连接")
        logger.debug(f"正在发送消息, target_conn_id: {target_conn_id}, message: {message}")

        # 如果没有指定 conn_id，默认选择第一个连接
        websocket = (
            self.active_connections.get(target_conn_id)
            if target_conn_id
            else next(iter(self.active_connections.values()))
        )

        if not websocket:
            raise ConnectionError(f"未找到目标连接: {target_conn_id}")

        if not message.get("message_id", ""):
            # 如果消息中未包含 message_id, 则生产一个
            message_id = str(uuid.uuid4())
            message["message_id"] = message_id  # 加入唯一消息 ID
        else:
            message_id = message["message_id"]

        logger.debug(f"new message: {message}")
        future = asyncio.get_event_loop().create_future()
        self.pending_responses[message_id] = future

        try:
            await websocket.send_json(message)
            response = await asyncio.wait_for(future, timeout=settings.websocket_timeout)
            return response
        except asyncio.TimeoutError:
            raise ConnectionError("等待响应超时")
        finally:
            self.pending_responses.pop(message_id, None)

    async def handle_response(self, data: dict):
        """处理 Postman 返回的响应"""
        message_id = data.get("message_id")
        logger.debug(f"开始响应: {data}, pending_responses: {self.pending_responses}")
        if message_id in self.pending_responses:
            future = self.pending_responses[message_id]
            if not future.done():
                future.set_result(data)  # 通知 `send_message` 已收到响应