"""WebSocket连接装饰器模块

提供WebSocket连接相关的装饰器函数，用于统一处理连接验证等逻辑
"""

from functools import wraps
from fastapi import WebSocket
from typing import Optional, Callable, Any
from config import settings
from logger import get_logger

logger = get_logger(__name__)

def validate_connect_id(func: Callable) -> Callable:
    """验证WebSocket连接的connect_id装饰器
    
    用于验证WebSocket连接请求中的connect_id是否有效
    
    参数:
        func: 被装饰的WebSocket处理函数
        
    返回:
        装饰后的函数
    """
    @wraps(func)
    async def wrapper(websocket: WebSocket, conn_id: Optional[str] = None, *args: Any, **kwargs: Any):
        # 验证connect_id是否匹配
        if conn_id != settings.connect_id:
            await websocket.close(code=4001, reason="Invalid connect_id")
            logger.warning(f"WebSocket连接被拒绝：无效的connect_id [{conn_id}]")
            return
            
        # 调用原始处理函数
        return await func(websocket, conn_id, *args, **kwargs)
        
    return wrapper