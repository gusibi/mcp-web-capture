/**
 * 后台脚本
 * 负责在浏览器后台运行，管理WebSocket连接和处理消息
 */

// 导入模块
importScripts('./lib/websocket.js', './lib/capture.js', './lib/extractor.js');

// 初始化模块实例
const websocketManager = new WebSocketManager();
const captureManager = new CaptureManager();
const contentExtractor = new ContentExtractor();

// 连接状态
let connectionStatus = {
    status: 'disconnected', // 添加status属性，初始值为'disconnected'
    connected: false,
    serverUrl: null,
    lastConnected: null,
    lastError: null
};

// 初始化后台脚本
function init() {
    console.log('background.js->初始化开始');
    // 监听来自弹出窗口和选项页面的消息
    chrome.runtime.onMessage.addListener(handleMessage);
    console.log('background.js->已注册chrome.runtime.onMessage监听器');

    // 监听WebSocket连接状态变化
    websocketManager.on('status_change', handleConnectionStatusChange);
    console.log('background.js->已注册WebSocket status_change事件监听器');

    // 监听WebSocket消息
    websocketManager.on('message', handleWebSocketMessage);
    console.log('background.js->已注册WebSocket message事件监听器');

    // 加载设置并自动连接（如果启用）
    loadSettingsAndConnect();
    console.log('background.js->初始化完成');
}

// 加载设置并自动连接
function loadSettingsAndConnect() {
    chrome.storage.sync.get(['serverUrl', 'apiKey', 'autoConnect'], (result) => {
        if (result.autoConnect && result.serverUrl) {
            // 自动连接
            connectToServer();
        }
    });
}

// 处理消息
function handleMessage(message, sender, sendResponse) {
    console.log('handleMessage-->收到消息:', message);

    switch (message.action) {
        case 'connect':
            connectToServer()
                .then(status => sendResponse(status))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // 异步响应

        case 'disconnect':
            disconnectFromServer()
                .then(status => sendResponse(status))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // 异步响应

        case 'getStatus':
            console.log('状态检查请求:', message);
            const response = {
                success: true,
                status: connectionStatus
            };
            console.log('状态检查响应:', response);
            sendResponse(response);
            return true; // 异步响应

        case 'captureTab':
            captureCurrentTab(message.options)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // 异步响应

        case 'extractContent':
            extractTabContent(message.options)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // 异步响应

        case 'settings_updated':
            // 设置已更新，重新加载
            loadSettingsAndConnect();
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ success: false, error: '未知操作' });
    }
}

// 连接到服务器
async function connectToServer() {
    try {
        await websocketManager.connect();
        return { success: true };
    } catch (error) {
        console.error('连接服务器失败:', error);
        return { success: false, error: error.message };
    }
}

// 断开服务器连接
async function disconnectFromServer() {
    try {
        await websocketManager.disconnect();
        return { success: true };
    } catch (error) {
        console.error('断开连接失败:', error);
        return { success: false, error: error.message };
    }
}

// 处理WebSocket连接状态变化
function handleConnectionStatusChange(status) {
    // 确保status对象包含所需属性
    if (!status) status = {};

    connectionStatus = {
        status: status.status || (status.connected ? 'connected' : 'disconnected'), // 确保status属性存在
        connected: status.connected || status.status === 'connected',
        serverUrl: status.serverUrl || websocketManager.serverUrl,
        lastConnected: (status.connected || status.status === 'connected') ? new Date().toISOString() : connectionStatus.lastConnected,
        lastError: status.error || status.errorMessage || null
    };

    // 通知弹出窗口连接状态变化
    try {
        chrome.runtime.sendMessage({
            action: 'connectionStatusChanged',
            status: connectionStatus
        }).catch(() => {
            // 弹出窗口可能未打开，忽略错误
            console.log('无法发送状态更新，弹出窗口可能未打开');
        });
    } catch (error) {
        console.error('发送状态更新消息失败:', error);
    }
}

// 处理接收到的WebSocket消息
async function handleWebSocketMessage(message) {
    console.log('handleWebSocketMessage -> 消息类型:', typeof message, '消息结构:', Object.keys(message));
    console.log('handleWebSocketMessage -> 完整消息内容:', JSON.stringify(message));

    try {
        // 根据消息格式处理
        let data;

        if (message && message.data) {
            console.log('handleWebSocketMessage -> 消息包含data属性:', typeof message.data);
            console.log('handleWebSocketMessage -> data内容:', JSON.stringify(message.data));

            // 检查是否是从websocket.js传递过来的包装消息
            if (message.data && message.data.command && message.originalEvent) {
                console.log('handleWebSocketMessage -> 检测到websocket.js包装的command消息');
                data = message.data; // 直接使用包装中的data字段
            }
            // 如果消息是对象且包含data属性
            else if (typeof message.data === 'string') {
                // 如果data是字符串，尝试解析JSON
                console.log('handleWebSocketMessage -> data是字符串，尝试解析JSON');
                try {
                    data = JSON.parse(message.data);
                } catch (error) {
                    console.error('解析JSON失败:', error);
                    data = message.data; // 如果解析失败，使用原始字符串
                }
            } else if (typeof message.data === 'object') {
                // 如果data已经是对象，直接使用
                console.log('handleWebSocketMessage -> data是对象，直接使用');
                data = message.data;
            }
        } else if (typeof message === 'object') {
            // 消息本身可能就是数据
            console.log('handleWebSocketMessage -> 消息本身作为数据使用');
            data = message;
        }

        // 确保data是有效的
        if (!data || typeof data !== 'object') {
            console.warn('收到无效消息格式:', message);
            return;
        }

        console.log('handleWebSocketMessage -> 处理后的data:', data);

        // 检查消息来源是否为ws_command
        if (data.source === 'ws_command') {
            console.log('收到来自websocket_send_command的消息:', data);
            // 处理来自websocket_send_command的消息
            if (data.action === 'open' && data.url) {
                await handleCaptureCommand(data);
                return;
            } else if (data.action === 'screenshot' || data.command === 'screenshot') {
                console.log('处理screenshot命令:', data);
                await handleCaptureCommand({
                    ...data,
                    id: data.message_id, // 确保ID字段一致
                    command: 'capture' // 使用现有的capture处理逻辑
                });
                return;
            }
            // 返回默认消息回服务器
            console.log('handleWebSocketMessage -> 返回默认消息回服务器---->>>>>');
            websocketManager.sendMessage({
                type: 'response',
                id: data.message_id,
                success: true,
                error: false,
                content: data // 将原始消息内容一并返回
            });
            return;
        }

        // 处理标准指令格式的消息
        const command = data.command;
        console.log('handleWebSocketMessage -> 检查command字段:', command);
        if (command) {
            console.log('handleWebSocketMessage -> 处理command:', command);
            switch (command) {
                case 'capture':
                    console.log('handleWebSocketMessage -> 执行capture命令');
                    await handleCaptureCommand(data);
                    break;

                case 'extract':
                    console.log('handleWebSocketMessage -> 执行extract命令');
                    await handleExtractCommand(data);
                    break;

                case 'navigate':
                    console.log('handleWebSocketMessage -> 执行navigate命令');
                    await handleNavigateCommand(data);
                    break;

                case 'open':
                    console.log('handleWebSocketMessage -> 执行open命令');
                    await handleOpenCommand(data);
                    break;

                default:
                    console.warn('未知指令:', command);
            }
        } else {
            console.warn('消息中没有command字段:', data);
        }
    } catch (error) {
        console.error('处理WebSocket消息失败:', error);
    }
}

// 处理截图指令
async function handleCaptureCommand(data) {
    try {
        // 如果指定了URL，先导航到该URL
        if (data.url) {
            await navigateToUrl(data.url);
        }

        // 执行截图
        const captureOptions = {
            fullPage: data.fullPage !== false,
            area: data.area || null
        };

        const captureResult = await captureCurrentTab(captureOptions);

        // 发送结果回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id,
            command: 'capture',
            success: true,
            result: captureResult
        });
    } catch (error) {
        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id,
            command: 'capture',
            success: false,
            error: error.message
        });
    }
}

// 处理内容提取指令
async function handleExtractCommand(data) {
    try {
        // 如果指定了URL，先导航到该URL
        if (data.url) {
            await navigateToUrl(data.url);
        }

        // 执行内容提取
        const extractOptions = {
            extractImages: data.extractImages !== false,
            extractLinks: data.extractLinks !== false,
            customSelectors: data.selectors || null
        };

        const extractResult = await extractTabContent(extractOptions);

        // 发送结果回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id,
            command: 'extract',
            success: true,
            result: extractResult
        });
    } catch (error) {
        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id,
            command: 'extract',
            success: false,
            error: error.message
        });
    }
}

// 处理导航指令
async function handleNavigateCommand(data) {
    try {
        if (!data.url) {
            throw new Error('URL不能为空');
        }

        await navigateToUrl(data.url);

        // 发送结果回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id,
            command: 'navigate',
            success: true,
            url: data.url
        });
    } catch (error) {
        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id,
            command: 'navigate',
            success: false,
            error: error.message
        });
    }
}

// 处理打开URL指令 (来自websocket_send_command)
async function handleOpenCommand(data) {
    try {
        if (!data.url) {
            throw new Error('URL不能为空');
        }

        await navigateToUrl(data.url);

        // 发送结果回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id || 'open_' + Date.now(), // 确保有ID，即使原始消息没有提供
            command: 'open',
            success: true,
            url: data.url
        });
    } catch (error) {
        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            id: data.id || 'open_' + Date.now(),
            command: 'open',
            success: false,
            error: error.message
        });
    }
}

// 导航到指定URL
async function navigateToUrl(url) {
    return new Promise((resolve, reject) => {
        try {
            // 创建新标签页或更新当前标签页
            chrome.tabs.create({ url }, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                // 等待页面加载完成
                const tabId = tab.id;
                const listener = (tabId, changeInfo) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve(tab);
                    }
                };

                chrome.tabs.onUpdated.addListener(listener);

                // 设置超时，防止无限等待
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(tab); // 即使未完全加载也继续执行
                }, 30000); // 30秒超时
            });
        } catch (error) {
            reject(error);
        }
    });
}

// 截图当前标签页
async function captureCurrentTab(options = {}) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error('无法获取当前标签页');
        }

        const imageData = await captureManager.captureTab(options);

        // 获取图片格式和质量设置
        const { imageFormat, imageQuality } = await new Promise(resolve => {
            chrome.storage.sync.get(['imageFormat', 'imageQuality'], (result) => {
                resolve({
                    imageFormat: result.imageFormat || 'png',
                    imageQuality: result.imageQuality || 90
                });
            });
        });

        return {
            url: tab.url,
            title: tab.title,
            timestamp: new Date().toISOString(),
            imageData,
            format: imageFormat,
            quality: imageQuality
        };
    } catch (error) {
        console.error('截图失败:', error);
        throw error;
    }
}

// 提取当前标签页内容
async function extractTabContent(options = {}) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error('无法获取当前标签页');
        }

        const content = await contentExtractor.extractContent(tab.id, options);

        return {
            url: tab.url,
            title: tab.title,
            timestamp: new Date().toISOString(),
            content
        };
    } catch (error) {
        console.error('内容提取失败:', error);
        throw error;
    }
}

// 初始化
init();