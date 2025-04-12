#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
MCP 工具 - MCP 协议处理
负责处理 MCP 协议的消息格式和指令处理
"""

import json
import logging
import uuid
from datetime import datetime

# 导入处理器
from handlers.capture_handler import CaptureHandler
from handlers.extract_handler import ExtractHandler
from utils.security import validate_api_key

logger = logging.getLogger('mcp_protocol')


class MCPProtocol:
    """MCP 协议处理类，负责处理 MCP 协议的消息格式和指令处理"""

    def __init__(self, server):
        """初始化 MCP 协议处理器

        Args:
            server (MCPServer): MCP 服务器实例
        """
        self.server = server
        self.handlers = {
            'capture': CaptureHandler(server),
            'extract': ExtractHandler(server)
        }

    async def handle_message(self, client_id, message):
        """处理客户端消息

        Args:
            client_id (str): 客户端 ID
            message (dict): 消息内容
        """
        message_type = message.get('type')
        
        if not message_type:
            await self.send_error(client_id, "消息缺少 'type' 字段")
            return

        # 根据消息类型处理
        if message_type == 'command':
            await self.handle_command(client_id, message)
        elif message_type == 'response':
            await self.handle_response(client_id, message)
        elif message_type == 'ping':
            await self.handle_ping(client_id, message)
        else:
            await self.send_error(client_id, f"未知的消息类型: {message_type}")

    async def handle_command(self, client_id, message):
        """处理命令消息

        Args:
            client_id (str): 客户端 ID
            message (dict): 命令消息
        """
        command = message.get('command')
        command_id = message.get('id') or str(uuid.uuid4())
        
        if not command:
            await self.send_error(client_id, "命令消息缺少 'command' 字段", command_id)
            return

        logger.info(f"收到客户端 {client_id} 的命令: {command} (ID: {command_id})")

        # 检查命令处理器是否存在
        if command not in self.handlers:
            await self.send_error(
                client_id, 
                f"未知的命令: {command}", 
                command_id
            )
            return

        # 创建任务并添加到队列
        task = {
            'id': command_id,
            'client_id': client_id,
            'command': command,
            'params': message.get('params', {}),
            'created_at': datetime.now().isoformat(),
            'handler': self.handlers[command]
        }

        # 将任务添加到客户端的任务列表
        if client_id in self.server.clients:
            self.server.clients[client_id]['tasks'].append(command_id)

        # 添加到任务队列
        await self.server.task_queue.add_task(task)

        # 发送确认消息
        await self.send_message(client_id, {
            'type': 'command_received',
            'id': command_id,
            'command': command,
            'message': f"命令 {command} 已接收，正在处理"
        })

    async def handle_response(self, client_id, message):
        """处理响应消息

        Args:
            client_id (str): 客户端 ID
            message (dict): 响应消息
        """
        response_id = message.get('id')
        command = message.get('command')
        
        if not response_id or not command:
            await self.send_error(client_id, "响应消息缺少必要字段")
            return

        logger.info(f"收到客户端 {client_id} 的响应: {command} (ID: {response_id})")

        # 通知相应的处理器
        if command in self.handlers:
            await self.handlers[command].handle_response(client_id, message)

    async def handle_ping(self, client_id, message):
        """处理 ping 消息

        Args:
            client_id (str): 客户端 ID
            message (dict): ping 消息
        """
        # 回复 pong 消息
        await self.send_message(client_id, {
            'type': 'pong',
            'timestamp': datetime.now().isoformat(),
            'server_status': self.server.get_server_status()
        })

    async def send_message(self, client_id, message):
        """向客户端发送消息

        Args:
            client_id (str): 客户端 ID
            message (dict): 消息内容
        """
        if client_id not in self.server.clients:
            logger.warning(f"尝试向不存在的客户端 {client_id} 发送消息")
            return

        websocket = self.server.clients[client_id]['websocket']
        try:
            await websocket.send(json.dumps(message))
        except Exception as e:
            logger.error(f"向客户端 {client_id} 发送消息失败: {e}")

    async def send_error(self, client_id, message, command_id=None):
        """向客户端发送错误消息

        Args:
            client_id (str): 客户端 ID
            message (str): 错误消息
            command_id (str, optional): 相关命令 ID
        """
        error_message = {
            'type': 'error',
            'message': message,
            'timestamp': datetime.now().isoformat()
        }

        if command_id:
            error_message['id'] = command_id

        await self.send_message(client_id, error_message)

    def validate_api_key(self, api_key):
        """验证 API 密钥

        Args:
            api_key (str): 要验证的 API 密钥

        Returns:
            bool: 验证是否通过
        """
        return validate_api_key(api_key, self.server.api_key)