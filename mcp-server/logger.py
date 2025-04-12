"""MCP 工具 - 日志配置模块

提供统一的日志配置和初始化功能：
- 日志格式定义
- 颜色输出配置
- 日志级别设置
- 统一的日志获取接口
"""

import logging
import sys
from uvicorn.logging import DefaultFormatter, ColourizedFormatter
from fastapi.logger import logger as fastapi_logger

# 配置日志格式
log_format = "%(levelprefix)s %(asctime)s | %(message)s"
log_config = {
    "handlers": [logging.StreamHandler(sys.stdout)],
    "format": log_format,
    "datefmt": "%Y-%m-%d %H:%M:%S",
    "level": logging.INFO
}

# 配置彩色输出
log_config["handlers"][0].setFormatter(
    ColourizedFormatter(
        fmt=log_format,
        datefmt="%Y-%m-%d %H:%M:%S",
        use_colors=True
    )
)

# 初始化基础日志配置
logging.basicConfig(**log_config)

# 配置FastAPI日志，使用uvicorn的日志配置
fastapi_logger.handlers = logging.getLogger("uvicorn").handlers

# 确保所有模块使用相同的日志配置
for _, logger_instance in logging.getLogger().manager.loggerDict.items():
    if isinstance(logger_instance, logging.Logger):
        logger_instance.handlers = fastapi_logger.handlers

def get_logger(name: str) -> logging.Logger:
    """获取指定名称的日志记录器
    
    Args:
        name: 日志记录器名称，通常使用__name__
        
    Returns:
        配置好的日志记录器实例
    """
    return logging.getLogger(name)