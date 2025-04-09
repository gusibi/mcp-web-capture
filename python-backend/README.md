# MCP 工具 - Python 后端服务

## 项目概述

关键要点

- 研究表明，MCP 服务器可以同时支持 SSE 和 WebSocket，适合 Cline 和浏览器插件的连接需求。
    
- 服务器需要定义工具（如截图），通过 WebSocket 将指令转发给浏览器插件，并处理响应。
    
- 这种设计可行，但需要自定义逻辑来桥接不同传输协议。
    

---

设计 MCP 服务器以支持 Cline 和浏览器插件的通信

概述

您可以设计一个 MCP 服务器，让 Cline 通过 SSE（或 Streamable HTTP）协议发送指令（如截取 URL 图片），而浏览器插件通过 WebSocket 协议接收这些指令，执行操作（如打开 URL 截图），并将结果返回给服务器，最后服务器再通过 SSE 响应给 Cline。这种设计是可行的，因为 MCP 协议支持多种传输方式，且现代框架如 FastAPI 可以同时处理 SSE 和 WebSocket。

实现步骤

- 服务器端点：
    
    - 为 Cline 设置 SSE 端点，接收其工具调用请求。
        
    - 为浏览器插件设置 WebSocket 端点，处理指令发送和结果接收。
        
- 工具定义：
    
    - 在 MCP 服务器中定义一个工具（如 screenshot），接受 URL 参数。
        
    - 当 Cline 调用此工具时，服务器通过 WebSocket 将指令发送给浏览器插件。
        
- 通信流程：
    
    - Cline 发送 URL 和指令，服务器接收后通过 WebSocket 转发给浏览器插件。
        
    - 浏览器插件执行截图操作，将图片通过 WebSocket 返回给服务器。
        
    - 服务器将图片作为工具调用的结果通过 SSE 发送回 Cline。
        
- 状态管理：
    
    - 服务器需要维护 WebSocket 连接，确保能正确转发指令和接收响应，可能需要使用异步编程（如 asyncio）处理。
        

意外细节

一个有趣的发现是，虽然 MCP 官方主要支持 stdio 和 Streamable HTTP，但社区已实现 WebSocket 支持（如 Cloudflare 的远程 MCP 服务器），这为您的需求提供了更多灵活性。

---

---

详细报告

本文详细探讨了如何设计一个 MCP（Model Context Protocol）服务器，以支持 Cline 通过 SSE（或 Streamable HTTP）协议发送指令，同时浏览器插件通过 WebSocket 协议接收指令并执行操作（如截取 URL 图片），最后将结果返回给 Cline。基于 2025 年 4 月 9 日的最新信息，本报告从背景、技术实现、注意事项等方面进行分析，并提供具体示例。

背景与协议概述

MCP 是一种标准化协议，用于让 AI 模型与外部工具和服务交互，支持多种传输方式，包括 stdio、HTTP with Server-Sent Events (SSE)、Streamable HTTP（2025-03-26 版本的最新标准）以及自定义传输。WebSocket 虽然不是标准传输，但由于协议的传输无关性（transport-agnostic），可以实现支持。

Cline 是一个支持 MCP 的 VS Code 扩展，通常通过 SSE 或 Streamable HTTP 连接到 MCP 服务器。浏览器插件则更适合通过 WebSocket 实现实时双向通信，例如接收指令并返回截图结果。

从搜索结果来看，MCP 框架支持多种传输机制（如 [Transports – Model Context Protocol Specification](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/)），并且社区讨论（如 Reddit 上的帖子）表明 WebSocket 在云环境中更稳定，适合实时交互。

技术实现

实现 MCP 服务器支持 Cline 和浏览器插件的通信需要以下步骤：

1. 框架选择

- 推荐使用 FastAPI，因为它支持 SSE（通过 sse-starlette 扩展）和 WebSocket，同时兼容 MCP SDK。
    
- 其他框架如 Flask（通过 Flask-SocketIO 支持 WebSocket）也可行，但 FastAPI 的异步特性更适合实时通信。
    

2. SSE 端点（Cline 连接）

- 使用 Streamable HTTP 传输（MCP 2025-03-26 标准）或旧的 SSE 传输。
    
- 示例代码：
    
    python
    
    ```python
    from fastapi import FastAPI
    from sse_starlette.sse import EventSourceResponse
    
    app = FastAPI()
    
    @app.get("/events")
    async def events():
        def event_generator():
            for i in range(10):
                yield {"type": "message", "data": f"Event {i}"}
                await asyncio.sleep(1)
        return EventSourceResponse(event_generator())
    ```
    
- Cline 通过 HTTP POST 发送 JSON-RPC 消息，服务器通过 SSE 流式返回响应。
    

3. WebSocket 端点（浏览器插件连接）

- 使用 FastAPI 的 WebSocket 支持：
    
    python
    
    ```python
    from fastapi import FastAPI, WebSocket
    
    app = FastAPI()
    
    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Message received: {data}")
    ```
    
- 浏览器插件连接到 /ws 端点，接收指令（如截图 URL）并返回结果（如 base64 编码的图片）。
    

4. MCP 工具定义与桥接逻辑

- 在 MCP 服务器中定义工具，例如 screenshot：
    
    - 使用 MCP SDK（如 mcp.server.fastmcp）定义工具。
        
    - 示例：
        
        python
        
        ```python
        from mcp.server.fastmcp import FastMCP
        
        mcp = FastMCP("MyApp")
        
        @mcp.tool()
        async def screenshot(url: str):
            if ws_connection is None:
                raise ValueError("浏览器插件未连接")
            await ws_connection.send_text(json.dumps({"action": "screenshot", "url": url}))
            response = await get_response()  # 实现此函数以获取 WebSocket 响应
            return response
        ```
        
- 当 Cline 调用 screenshot 工具时，服务器通过 WebSocket 将指令发送给浏览器插件，等待响应后返回结果。
    

5. 状态管理与通信桥接

- 服务器需要维护 WebSocket 连接的状态，例如使用全局变量 ws_connection 存储当前连接。
    
- 使用异步队列（如 asyncio.Queue）管理请求和响应，确保每个工具调用都能正确匹配响应。
    
- 示例：
    
    - 当 Cline 发送工具调用请求时，生成一个唯一 ID，将请求存储到队列。
        
    - 通过 WebSocket 接收浏览器插件的响应时，根据 ID 匹配并返回给 Cline。
        

注意事项与最佳实践

- 资源管理：SSE 和 WebSocket 都保持长连接，可能会占用服务器资源。建议使用异步框架（如 FastAPI）以高效处理多个连接。
    
- 安全性：生产环境中，使用 HTTPS/WSS，确保通信加密。验证 WebSocket 连接的来源，防止 DNS 劫持攻击。
    
- 错误处理：如果浏览器插件未连接或响应超时，服务器需要返回适当的错误信息给 Cline。
    
- 性能：如果有多个浏览器插件连接，需管理多个 WebSocket 连接，可能需要负载均衡。
    

表格：SSE 和 WebSocket 在本场景中的对比

|特性|SSE（Cline）|WebSocket（浏览器插件）|
|---|---|---|
|通信方向|单向（服务器到客户端）|双向|
|协议|HTTP（Streamable HTTP 或 SSE）|WebSocket（基于 TCP）|
|典型用例|工具调用请求和响应推送|实时指令发送和结果返回|
|资源消耗|较低（单向）|较高（需管理状态）|
|安全性考虑|需要 HTTPS，验证 Origin 头|需要 WSS，验证连接来源|

意外发现

一个有趣的发现是，虽然 MCP 官方主要支持 stdio 和 Streamable HTTP，但社区已实现 WebSocket 支持（如 Cloudflare 的远程 MCP 服务器 [Build and deploy Remote Model Context Protocol (MCP) servers to Cloudflare](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)），这为您的需求提供了更多灵活性。此外，Reddit 上的讨论（如 [Lessons from Building AI Agents with MCP (SSE Sucks, WebSockets FTW)](https://www.reddit.com/r/AI_Agents/comments/1ir8rz5/lessons_from_building_ai_agents_with_mcp_sse/)）表明 WebSocket 在云环境中更稳定，适合实时交互。

相关资源与讨论

从搜索结果来看，FastAPI 的文档和社区资源提供了丰富的 SSE 和 WebSocket 实现示例。特别是 [FastAPI WebSockets](https://fastapi.tiangolo.com/) 和 [FastAPI-SSE GitHub](https://github.com/sidharthrajaram/mcp-sse) 展示了如何在同一个框架中支持两者。此外，MCP 规范文档（如 [Transports – Model Context Protocol Specification](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/)）明确了传输机制的灵活性。

结论

通过 FastAPI 和 MCP SDK，可以设计一个支持 SSE 和 WebSocket 的 MCP 服务器。服务器充当 Cline 和浏览器插件之间的中介，实现跨协议的通信。Cline 使用 SSE（或 Streamable HTTP）发送指令，MCP 服务器通过 WebSocket 将指令转发给浏览器插件，并将结果返回给 Cline。这种设计充分利用了 MCP 的灵活性和现代 Web 框架的强大功能。