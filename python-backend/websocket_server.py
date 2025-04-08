#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
MCP 工具 - WebSocket 服务器实现
负责处理 WebSocket 连接和消息传递
"""

import asyncio
import logging
import json
import uuid
import time
from websockets.server import serve, WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger('websocket_server')


class WebSocketServer:
    """WebSocket 服务器类，处理客户端连接和消息传递"""

    def __init__(self, host, port, protocol_handler):
        """初始化 WebSocket 服务器

        Args:
            host (str): 服务器主机名
            port (int): 服务器端口
            protocol_handler (MCPProtocol): 协议处理器
        """
        self.host = host
        self.port = port
        self.protocol_handler = protocol_handler
        self.server = None
        self.start_time = None

    async def start(self):
        """启动 WebSocket 服务器"""
        self.start_time = time.time()
        self.server = await serve(
            self.handle_connection,
            self.host,
            self.port
        )
        logger.info(f"WebSocket 服务器已启动，监听地址: {self.host}:{self.port}")

    async def stop(self):
        """停止 WebSocket 服务器"""
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            self.server = None
            logger.info("WebSocket 服务器已停止")

    async def handle_connection(self, websocket, path):
        """处理新的 WebSocket 连接

        Args:
            websocket (WebSocketServerProtocol): WebSocket 连接
            path (str): 请求路径
        """
        client_id = str(uuid.uuid4())
        try:
            # 等待客户端认证
            authenticated = await self.authenticate_client(websocket, client_id)
            if not authenticated:
                return

            # 注册客户端
            self.protocol_handler.server.register_client(client_id, websocket)

            # 处理消息
            await self.handle_messages(websocket, client_id)

        except ConnectionClosed:
            logger.info(f"客户端 {client_id} 连接已关闭")
        except Exception as e:
            logger.error(f"处理客户端 {client_id} 连接时出错: {e}", exc_info=True)
        finally:
            # 注销客户端
            self.protocol_handler.server.unregister_client(client_id)

    async def authenticate_client(self, websocket, client_id):
        """认证客户端

        Args:
            websocket (WebSocketServerProtocol): WebSocket 连接
            client_id (str): 客户端 ID

        Returns:
            bool: 认证是否成功
        """
        try:
            # 等待认证消息
            auth_timeout = 30  # 30秒认证超时
            auth_message_json = await asyncio.wait_for(
                websocket.recv(),
                timeout=auth_timeout
            )

            # 解析认证消息
            auth_message = json.loads(auth_message_json)
            if auth_message.get('type') != 'auth':
                await self.send_error(websocket, "认证失败：无效的消息类型")
                return False

            # 验证 API 密钥
            api_key = auth_message.get('apiKey')
            if not self.protocol_handler.validate_api_key(api_key):
                await self.send_error(websocket, "认证失败：无效的 API 密钥")
                return False

            # 发送认证成功消息
            await websocket.send(json.dumps({
                'type': 'auth_response',
                'success': True,
                'clientId': client_id,
                'message': "认证成功"
            }))

            logger.info(f"客户端 {client_id} 认证成功")
            return True

        except asyncio.TimeoutError:
            await self.send_error(websocket, "认证超时")
            logger.warning(f"客户端 {client_id} 认证超时")
            return False
        except json.JSONDecodeError:
            await self.send_error(websocket, "认证失败：无效的 JSON 格式")
            logger.warning(f"客户端 {client_id} 发送了无效的 JSON")
            return False
        except Exception as e:
            await self.send_error(websocket, f"认证过程中出错: {str(e)}")
            logger.error(f"客户端 {client_id} 认证过程中出错: {e}", exc_info=True)
            return False

    async def send_error(self, websocket, message):
        """发送错误消息

        Args:
            websocket (WebSocketServerProtocol): WebSocket 连接
            message (str): 错误消息
        """
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': message
            }))
        except Exception as e:
            logger.error(f"发送错误消息失败: {e}")

    async def handle_messages(self, websocket, client_id):
        """处理来自客户端的消息

        Args:
            websocket (WebSocketServerProtocol): WebSocket 连接
            client_id (str): 客户端 ID
        """
        async for message in websocket:
            try:
                # 更新客户端最后活动时间
                if client_id in self.protocol_handler.server.clients:
                    self.protocol_handler.server.clients[client_id]['last_activity'] = \
                        asyncio.get_event_loop().time()

                # 解析消息
                data = json.loads(message)
                
                # 处理消息
                await self.protocol_handler.handle_message(client_id, data)
                
            except json.JSONDecodeError:
                logger.warning(f"客户端 {client_id} 发送了无效的 JSON: {message}")
                await self.send_error(websocket, "无效的 JSON 格式")
            except Exception as e:
                logger.error(f"处理客户端 {client_id} 消息时出错: {e}", exc_info=True)
                await self.send_error(websocket, f"处理消息时出错: {str(e)}")

    async def broadcast_message(self, message):
        """向所有连接的客户端广播消息

        Args:
            message (dict): 要广播的消息
        """
        if not self.protocol_handler.server.clients:
            return

        message_json = json.dumps(message)
        tasks = []

        for client_id, client_info in self.protocol_handler.server.clients.items():
            websocket = client_info['websocket']
            tasks.append(self.send_message_to_client(websocket, message_json))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_message_to_client(self, websocket, message_json):
        """向指定客户端发送消息

        Args:
            websocket (WebSocketServerProtocol): 客户端 WebSocket 连接
            message_json (str): JSON 格式的消息
        """
        try:
            await websocket.send(message_json)
        except Exception as e:
            logger.error(f"发送消息失败: {e}")

    def get_uptime(self):
        """获取服务器运行时间（秒）

        Returns:
            float: 运行时间
        """
        if self.start_time is None:
            return 0
        return time.time() - self.start_time