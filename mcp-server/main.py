from typing import Dict, Optional
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi_mcp import add_mcp_server
from datetime import datetime

from websocket_manager import WebSocketManager
from config import settings
from logger import get_logger
from decorators import validate_connect_id

logger = get_logger(__name__)

"""
MCP 工具服务器 - 主模块

本模块实现了MCP工具的服务器端功能，包括：
- FastAPI 应用结构：提供Web API和WebSocket端点
- WebSocket 通信实现：处理浏览器和命令客户端的连接
- MCP 服务器集成：集成fastapi_mcp库，提供MCP协议支持
- 工具函数实现：提供截图等功能的API端点
"""

# 创建FastAPI应用实例
app = FastAPI(
    title="MCP工具服务器",
    description="提供网页内容采集和处理功能的服务器",
    version="1.0.0"
)

# 创建WebSocket连接管理器实例
ws_manager = WebSocketManager()


def get_browser_conn_id(conn_id: str) -> str:
    """
    获取与指定conn_id对应的浏览器连接ID
    
    通过添加前缀'ws_browser:'来区分浏览器连接和其他类型的连接
    
    参数:
        conn_id: 原始连接ID
        
    返回:
        格式化后的浏览器连接ID
    """
    return f"ws_browser:{conn_id}"

@app.websocket("/ws_browser")
@validate_connect_id
async def websocket_browser(websocket: WebSocket, conn_id: Optional[str] = None):
    """
    浏览器WebSocket连接端点
    
    处理来自浏览器扩展的WebSocket连接，接收浏览器发送的消息并处理响应
    
    参数:
        websocket: WebSocket连接对象
        conn_id: 可选的连接ID，如果未提供则自动生成
    """
        
    # 格式化浏览器连接ID并建立连接
    conn_id = get_browser_conn_id(conn_id)
    conn_id = await ws_manager.connect(websocket, conn_id)
    logger.info(f"浏览器WebSocket连接已建立 [{conn_id}]")
    
    try:
        while True:
            # 接收浏览器发送的消息
            data = await websocket.receive_json()
            
            # 根据消息类型进行处理
            if "message_id" in data:
                # 如果是响应消息，则传递给响应处理器
                logger.info(f"浏览器 [{conn_id}] 发送响应: message_id={data['message_id']}")
                await ws_manager.handle_response(data)
            else:
                # 处理其他类型的消息（如心跳包等）
                logger.debug(f"浏览器 [{conn_id}] 发送其他消息: {data}")
    except WebSocketDisconnect:
        # 处理WebSocket断开连接
        logger.info(f"浏览器 [{conn_id}] 断开连接")
        ws_manager.disconnect(conn_id)
    except Exception as e:
        # 处理其他异常
        logger.error(f"浏览器WebSocket连接 [{conn_id}] 发生异常: {str(e)}", exc_info=True)
        ws_manager.disconnect(conn_id)

@app.websocket("/ws_command")
@validate_connect_id
async def websocket_send_command(websocket: WebSocket, conn_id: Optional[str] = None):
    """
    命令WebSocket连接端点
    
    处理来自命令客户端的WebSocket连接，接收命令并转发给浏览器执行
    
    参数:
        websocket: WebSocket连接对象
        conn_id: 可选的连接ID，如果未提供则自动生成
    """
    # 建立WebSocket连接
    conn_id = await ws_manager.connect(websocket, conn_id)
    logger.info(f"命令WebSocket连接已建立 [{conn_id}]")
    
    try:
        while True:
            # 接收客户端发送的命令
            data = await websocket.receive_json()
            logger.info(f"命令客户端 [{conn_id}] 发送命令: {data.get('command', '未知命令')}, URL: {data.get('url', '')}")
            
            # 验证命令格式
            if "command" in data and "url" in data:
                # 构造消息并发送给浏览器
                message = {
                    "source": data.get("source","ws_command"),
                    "action": data.get("action", data.get("command")),  # 兼容不同格式
                    "command": data["command"],
                    "url": data["url"],
                    "fullPage": data.get("fullPage", False),
                    "message_id": data.get("message_id", "")
                }
                
                try:
                    # 发送消息到浏览器并等待响应
                    browser_conn_id = get_browser_conn_id(conn_id)
                    logger.info(f"转发命令到浏览器 [{browser_conn_id}]: message_id={message['message_id']}")
                    response = await ws_manager.send_message(message, target_conn_id=browser_conn_id)
                    
                    # 将响应发送回客户端
                    logger.info(f"收到浏览器响应并转发回命令客户端 [{conn_id}]")
                    await websocket.send_json(response)
                except ConnectionError as e:
                    # 处理连接错误
                    error_msg = {"error": str(e), "status": "error"}
                    logger.error(f"命令执行失败: {str(e)}")
                    await websocket.send_json(error_msg)
            else:
                # 处理格式错误的命令
                error_msg = {"error": "无效的命令格式，需要包含 'command' 和 'url' 字段", "status": "error"}
                logger.warning(f"收到格式错误的命令: {data}")
                await websocket.send_json(error_msg)
    except WebSocketDisconnect:
        # 处理WebSocket断开连接
        logger.info(f"命令客户端 [{conn_id}] 断开连接")
        ws_manager.disconnect(conn_id)
    except Exception as e:
        # 处理其他异常
        logger.error(f"命令WebSocket连接 [{conn_id}] 发生异常: {str(e)}")
        ws_manager.disconnect(conn_id)

# 配置并添加MCP服务器
mcp_server = add_mcp_server(
    app,                                # FastAPI应用实例
    mount_path="/mcp",                  # MCP服务器挂载路径
    name="BrowserTools",                # MCP服务器名称
    describe_all_responses=True,        # 在工具描述中包含所有可能的响应模式
    describe_full_response_schema=True  # 在工具描述中包含完整的JSON模式
)

@mcp_server.tool()
async def screenshot(url: str) -> str:
    """
    捕获指定URL的网页截图
    
    通过浏览器扩展捕获指定URL的网页截图，并返回Base64编码的图片数据
    
    参数:
        url: 要截图的网页URL
        
    返回:
        Base64编码的图片数据字符串
    """
    # 获取浏览器连接ID
    conn_id = get_browser_conn_id(settings.connect_id)
    if not conn_id:
        logger.error("未配置浏览器连接ID，无法执行截图操作")
        return "未获取到浏览器连接ID，请检查配置"
        
    try:
        # 构造截图命令并发送到浏览器
        logger.info(f"执行网页截图: {url}")
        response = await ws_manager.send_message({
            "source": "mcp_client",
            "action": "screenshot", 
            "command": "screenshot", 
            "url": url
        }, target_conn_id=conn_id)
        
        # 检查响应中是否包含图片数据
        if "image_data" in response:
            logger.info(f"成功获取网页截图: {url}")
            return response.get("image_data")
        else:
            logger.warning(f"截图响应中未包含图片数据: {response}")
            return ""
    except ConnectionError as e:
        logger.error(f"截图操作失败: {str(e)}")
        return f"截图失败: {str(e)}"

@mcp_server.tool()
async def add(a: int, b: int) -> int:
    """
    计算两个数字的和
    
    参数:
        a: 第一个数字
        b: 第二个数字
        
    返回:
        两个数字的和
    """
    result = a + b
    logger.debug(f"计算: {a} + {b} = {result}")
    return result

@mcp_server.tool()
async def get_server_time() -> str:
    """
    获取服务器当前时间
    
    返回:
        ISO格式的服务器当前时间字符串
    """
    current_time = datetime.now().isoformat()
    logger.debug(f"获取服务器时间: {current_time}")
    return current_time



if __name__ == "__main__":
    # 打印所有注册的路由信息（仅在调试模式下）
    if settings.debug:
        for route in app.routes:
            logger.debug(f"注册路由: {route.path} - {route.name}")

    # 启动服务器
    logger.info(f"启动MCP工具服务器 - 监听: {settings.host}:{settings.port}")
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info"
    )
