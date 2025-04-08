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
    connected: false,
    serverUrl: null,
    lastConnected: null,
    lastError: null
};

// 初始化后台脚本
function init() {
    // 监听来自弹出窗口和选项页面的消息
    chrome.runtime.onMessage.addListener(handleMessage);

    // 监听WebSocket连接状态变化
    websocketManager.on('status_change', handleConnectionStatusChange);

    // 监听WebSocket消息
    websocketManager.on('message', handleWebSocketMessage);

    // 加载设置并自动连接（如果启用）
    loadSettingsAndConnect();
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
    console.log('收到消息:', message);

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
            break;

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
    console.log('收到WebSocket消息:', message);

    try {
        // 根据消息格式处理
        let data;

        if (message && message.data) {
            // 如果消息是对象且包含data属性
            if (typeof message.data === 'string') {
                // 如果data是字符串，尝试解析JSON
                data = JSON.parse(message.data);
            } else if (typeof message.data === 'object') {
                // 如果data已经是对象，直接使用
                data = message.data;
            }
        } else if (typeof message === 'object') {
            // 消息本身可能就是数据
            data = message;
        }

        // 确保data是有效的
        if (!data || typeof data !== 'object') {
            console.warn('收到无效消息格式:', message);
            return;
        }

        // 处理不同类型的指令
        switch (data.command) {
            case 'capture':
                await handleCaptureCommand(data);
                break;

            case 'extract':
                await handleExtractCommand(data);
                break;

            case 'navigate':
                await handleNavigateCommand(data);
                break;

            default:
                console.warn('未知指令:', data.command);
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