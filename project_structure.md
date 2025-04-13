# MCP 工具项目结构

## 项目概述
MCP 工具是一个分布式网页内容采集系统，由 Chrome 浏览器扩展和 Python 后端服务组成，用于自动化网页内容获取和处理。

## 目录结构

```
browser-tools-mcp/
├── README.md                     # 项目说明文档
├── chrome-extension/            # Chrome 浏览器扩展目录
│   ├── manifest.json            # 扩展配置文件
│   ├── background.js            # 后台脚本
│   ├── popup/                   # 弹出窗口
│   │   ├── popup.html           # 弹出窗口 HTML
│   │   ├── popup.css            # 弹出窗口样式
│   │   └── popup.js             # 弹出窗口脚本
│   ├── options/                 # 选项页面
│   │   ├── options.html         # 选项页面 HTML
│   │   ├── options.css          # 选项页面样式
│   │   └── options.js           # 选项页面脚本
│   ├── content/                 # 内容脚本
│   │   ├── content.js           # 内容处理脚本
│   │   └── content.css          # 内容样式
│   ├── lib/                     # 库文件
│   │   ├── websocket.js         # WebSocket 连接管理
│   │   ├── capture.js           # 截图功能
│   │   ├── extractor.js         # 内容提取功能
│   │   └── logger.js           # 日志记录功能
│   ├── logs/                    # 日志模块
│   │   ├── logs.html            # 日志页面
│   │   └── logs.js              # 日志处理脚本
│   ├── offscreen/               # 离屏渲染模块
│   │   ├── offscreen.html       # 离屏页面
│   │   └── offscreen.js         # 离屏脚本
│   └── icons/                   # 图标资源
│       ├── icon16.png           # 16x16 图标
│       ├── icon48.png           # 48x48 图标
│       └── icon128.png          # 128x128 图标
└── mcp-server/                 # Python 后端服务目录
    ├── requirements.txt         # 依赖包列表
    ├── config.py                # 配置文件
    ├── main.py                  # 主服务器入口
    ├── mcp_protocol.py          # MCP 协议处理
    ├── websocket_manager.py     # WebSocket 管理
    ├── logger.py                # 日志模块
    ├── decorators.py            # 装饰器
    ├── handlers/                # 请求处理器
    │   ├── __init__.py         # 初始化文件
    │   ├── capture_handler.py   # 截图处理器
    │   └── extract_handler.py   # 内容提取处理器
    └── pyproject.toml           # 项目配置
```

## 技术栈

### Chrome 浏览器扩展
- JavaScript (ES6+)
- HTML5 / CSS3
- Chrome Extension API
- WebSocket API

### Python 后端服务
- Python 3.10+
- Fastapi (Server 库)
- Fastapi-MCP (MCP 库)
- 异步 I/O (asyncio)
- 图像处理 (Pillow)
- 内容解析 (BeautifulSoup4, lxml)
- 安全 (cryptography)