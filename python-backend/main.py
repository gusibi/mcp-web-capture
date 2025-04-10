import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi_mcp import add_mcp_server
from websocket_manager import WebSocketManager

"""
MCP 工具 - MCP Server
- FastAPI 应用结构
- WebSocket 端点实现
- MCP 服务器集成
- 工具函数定义
"""

app = FastAPI()

ws_manager = WebSocketManager()

# Define some models


# Define some endpoints
@app.get("/items/")
async def list_items(skip: int = 0, limit: int = 10):
    """
    List all items in the database.

    Returns a list of items, with pagination support.
    """
    return [1,2,3,4,5]

@app.websocket("/ws_browser")
async def websocket_browser(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()  # 接收 Postman 的消息
            print("收到消息:", data)

            # 检查是否是某个请求的响应（含 message_id）
            if "message_id" in data:
                await ws_manager.handle_response(data)  # 传递给 send_message
            else:
                # 其他消息（如心跳包）可以在这里处理
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        print("WebSocket 异常:", e)
        ws_manager.disconnect(websocket)

@app.websocket("/ws_command")
async def websocket_send_command(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # 接收客户端发送的命令
            data = await websocket.receive_json()
            print("websocket_send_command--->收到命令:", data)
            
            # 确保命令格式正确
            if "command" in data and "url" in data:
                # 构造消息并发送给浏览器
                message = {
                    "source": "ws_command",
                    "action": data["command"],
                    "command": data["command"],
                    "url": data["url"]
                }
                print("websocket_send_command-->发送消息:", message)
                
                try:
                    # 发送消息到浏览器并等待响应
                    response = await ws_manager.send_message(message)
                    print("收到浏览器响应:", response)
                    
                    # 将响应发送回客户端
                    await websocket.send_json(response)
                except ConnectionError as e:
                    error_msg = {"error": str(e)}
                    print("连接错误:", e)
                    await websocket.send_json(error_msg)
            else:
                # 消息格式不正确
                await websocket.send_json({"error": "无效的命令格式，需要包含 'command' 和 'url' 字段"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        print("WebSocket 命令异常:", e)
        ws_manager.disconnect(websocket)

mcp_server = add_mcp_server(
    app,                                    # Your FastAPI app
    mount_path="/mcp",                      # Where to mount the MCP server
    name="AddDemo",                      # Name for the MCP server
    describe_all_responses=True,            # False by default. Include all possible response schemas in tool descriptions, instead of just the successful response.
    describe_full_response_schema=True      # False by default. Include full JSON schema in tool descriptions, instead of just an LLM-friendly response example.
)

@mcp_server.tool()
async def screenshot(url: str) -> str:
    """捕获指定 URL 的截图"""
    try:
        # 使用command格式发送消息
        response = await ws_manager.send_message({
            "source": "mcp_client",
            "action": "screenshot", 
            "command": "screenshot", 
            "url": url
            })
        print("截图响应:", response)
        return response.get("image_data", "")
    except ConnectionError as e:
        print("截图错误:", e)
        return str(e)

@mcp_server.tool()
async def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b + 1

@mcp_server.tool()
async def get_server_time() -> str:
    """Get the current server time."""
    from datetime import datetime
    return datetime.now().isoformat()



if __name__ == "__main__":
    for route in app.routes:
        print(route.path, route.name)

    uvicorn.run(app, host="0.0.0.0", port=8000)
