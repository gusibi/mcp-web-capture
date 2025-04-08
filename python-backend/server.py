#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
MCP 工具 - Python 后端服务主入口
负责启动 WebSocket 服务器和处理客户端连接
"""

import asyncio
import logging
import argparse
import json
import os
from pathlib import Path

# 导入自定义模块
from websocket_server import WebSocketServer
from mcp_protocol import MCPProtocol
from task_queue import TaskQueue
from utils.security import generate_api_key, validate_api_key

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('mcp_server.log')
    ]
)
logger = logging.getLogger('mcp_server')


class MCPServer:
    """MCP 服务器主类，负责协调各组件"""

    def __init__(self, host='localhost', port=8765, api_key=None):
        """初始化 MCP 服务器

        Args:
            host (str): 服务器主机名
            port (int): 服务器端口
            api_key (str, optional): API 密钥，如果为 None 则自动生成
        """
        self.host = host
        self.port = port
        self.api_key = api_key or generate_api_key()
        self.clients = {}
        self.task_queue = TaskQueue()
        self.protocol = MCPProtocol(self)
        self.websocket_server = WebSocketServer(self.host, self.port, self.protocol)
        self.running = False

        # 确保输出目录存在
        self.output_dir = Path('output')
        self.output_dir.mkdir(exist_ok=True)

        logger.info(f"MCP 服务器初始化完成，监听地址: {self.host}:{self.port}")
        if not api_key:
            logger.info(f"已生成新的 API 密钥: {self.api_key}")

    async def start(self):
        """启动 MCP 服务器"""
        if self.running:
            logger.warning("服务器已在运行中")
            return

        self.running = True
        logger.info("正在启动 MCP 服务器...")

        # 启动任务队列处理器
        asyncio.create_task(self.task_queue.process_tasks())

        # 启动 WebSocket 服务器
        await self.websocket_server.start()

    async def stop(self):
        """停止 MCP 服务器"""
        if not self.running:
            logger.warning("服务器未在运行")
            return

        logger.info("正在停止 MCP 服务器...")
        self.running = False

        # 停止 WebSocket 服务器
        await self.websocket_server.stop()

        # 停止任务队列
        await self.task_queue.stop()

        logger.info("MCP 服务器已停止")

    def register_client(self, client_id, websocket):
        """注册新客户端

        Args:
            client_id (str): 客户端 ID
            websocket (WebSocketServerProtocol): WebSocket 连接
        """
        self.clients[client_id] = {
            'websocket': websocket,
            'connected_at': asyncio.get_event_loop().time(),
            'last_activity': asyncio.get_event_loop().time(),
            'tasks': []
        }
        logger.info(f"客户端 {client_id} 已连接")

    def unregister_client(self, client_id):
        """注销客户端

        Args:
            client_id (str): 客户端 ID
        """
        if client_id in self.clients:
            del self.clients[client_id]
            logger.info(f"客户端 {client_id} 已断开连接")

    def get_client_count(self):
        """获取当前连接的客户端数量

        Returns:
            int: 客户端数量
        """
        return len(self.clients)

    def get_server_status(self):
        """获取服务器状态信息

        Returns:
            dict: 服务器状态信息
        """
        return {
            'running': self.running,
            'client_count': self.get_client_count(),
            'task_queue_size': self.task_queue.get_queue_size(),
            'uptime': self.websocket_server.get_uptime() if self.running else 0
        }


def parse_arguments():
    """解析命令行参数

    Returns:
        argparse.Namespace: 解析后的参数
    """
    parser = argparse.ArgumentParser(description='MCP 工具 - Python 后端服务')
    parser.add_argument('--host', default='localhost', help='服务器主机名')
    parser.add_argument('--port', type=int, default=8765, help='服务器端口')
    parser.add_argument('--api-key', help='API 密钥，如果不提供则自动生成')
    parser.add_argument('--debug', action='store_true', help='启用调试模式')
    return parser.parse_args()


async def main():
    """主函数"""
    args = parse_arguments()

    # 设置日志级别
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.debug("已启用调试模式")

    # 创建并启动服务器
    server = MCPServer(args.host, args.port, args.api_key)
    
    try:
        await server.start()
        
        # 保持服务器运行
        while server.running:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        logger.info("接收到中断信号，正在关闭服务器...")
    except Exception as e:
        logger.error(f"服务器运行出错: {e}", exc_info=True)
    finally:
        await server.stop()


if __name__ == "__main__":
    asyncio.run(main())