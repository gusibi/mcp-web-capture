# MCP Web Automation Toolkit

MCP is a distributed web content harvesting system consisting of a Chrome extension and Python backend service, designed for automated web content collection and processing.

## 项目背景
MCP工具旨在解决大规模网页内容采集的自动化需求，特别适用于数据分析、内容聚合和自动化工作流程场景。通过浏览器扩展与后端服务的协同工作，实现了高效可靠的网页内容获取解决方案。

## 快速开始
### 前置要求
- Python 3.+
- Chrome浏览器

### 安装指南
1. 克隆仓库
```bash
git clone https://github.com/your-repo/browser-tools-mcp.git
```
2. 安装Python依赖
```bash
cd mcp-server
pip install -r requirements.txt
```
3. 加载浏览器扩展
- 打开Chrome浏览器，访问 chrome://extensions
- 启用"开发者模式"
- 点击"加载已解压的扩展程序"，选择chrome-extension目录

## 使用说明
### 启动后端服务
```bash
cd mcp-server
python main.py
```

### 配置浏览器扩展
1. 点击浏览器工具栏中的MCP图标
2. 在设置页面配置WebSocket服务器地址
3. 设置安全密钥（需与后端配置一致）

## 贡献指南
我们欢迎各种形式的贡献，包括但不限于：
- 报告问题
- 提交功能请求
- 代码贡献

请遵循以下步骤：
1. Fork本项目
2. 创建您的功能分支
3. 提交您的修改
4. 推送分支并创建Pull Request


## TOOD

- [ ] 提取规则配置

## 许可证
本项目采用MIT许可证。

## Components

### 1. Chrome Browser Extension
**Core Features:**
- **WebSocket Connection Management**
  - Persistent WebSocket connection with remote service
  - Real-time command and target URL reception
  - Visual connection status display

- **Web Content Processing**
  - Automated URL navigation
  - Full-page or selective area screenshots
  - Intelligent content extraction (similar to Web Clipper)
  - Result transmission via WebSocket

- **Configuration Management**
  - User-friendly settings interface
  - WebSocket server address configuration
  - Security key setup
  - Local image storage path configuration
  - Custom content extraction rules

### 2. Python Backend Service
**Core Features:**
- **Communication Protocol**
  - WebSocket server implementation (multi-client support)
  - Custom MCP protocol for request/response handling

- **Command Management**
  - `capture` command: Takes URL, returns screenshot file path
  - `extract` command: Takes URL, returns structured content
  - Task queue and status tracking

- **Data Processing**
  - Image storage management
  - Content parsing and formatting
  - Extensible plugin system for custom processing

- **Security**
  - Client authentication
  - Data transmission encryption
  - Access control and rate limiting

This project provides an efficient, reliable solution for web content collection, ideal for data analysis, content aggregation, and workflow automation.


# MCP 工具项目描述优化

## MCP 工具项目
MCP 工具是一个网页内容采集系统，由 Chrome 浏览器扩展和 Python 后端服务组成，用于自动化网页内容获取和处理。

### 组件一：Chrome 浏览器扩展
**核心功能：**
1. **WebSocket 连接管理**
   - 与远程服务建立持久性 WebSocket 连接
   - 实时接收远程服务发送的指令和目标 URL
   - 连接状态可视化显示
2. **网页内容处理**
   - 根据指令自动打开指定 URL
   - 网页截图功能（全页面或指定区域）
   - 智能内容提取（类似 Web Clipper，自动识别主要内容区域）
   - 将处理结果通过 WebSocket 发送回远程服务
3. **配置管理**
   - 用户友好的设置界面
   - WebSocket 服务器地址配置
   - 安全密钥设置
   - 本地图片存储路径配置
   - 内容提取规则自定义选项
### 组件二：Python 后端服务
**核心功能：**
1. **通信协议**
    - WebSocket 服务器实现，支持多客户端连接
    - 自定义 MCP 协议处理请求和响应
2. **指令管理**
    - `capture` 指令：接收 URL 参数，返回网页截图的文件路径
    - `extract` 指令：接收 URL 参数，返回结构化的网页内容
    - 任务队列管理和状态追踪
3. **数据处理**
    - 图片存储和管理
    - 内容解析和格式化
    - 可扩展的插件系统，支持自定义内容处理逻辑
4. **安全机制**
    - 客户端认证和授权
    - 数据传输加密
    - 访问控制和限流

- 此项目旨在提供一个高效、可靠的网页内容采集解决方案，适用于数据分析、内容聚合和自动化工作流程。
