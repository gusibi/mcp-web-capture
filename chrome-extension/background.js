/**
 * 后台脚本
 * 负责在浏览器后台运行，管理WebSocket连接和处理消息
 */

// 导入模块
importScripts('./lib/websocket.js', './lib/capture.js', './lib/extractor.js', './lib/logger.js');

// 初始化日志记录器
const logger = new Logger();

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

    // 监听来自弹出窗口和选项页面的消息
    chrome.runtime.onMessage.addListener(handleMessage);


    // 监听WebSocket连接状态变化
    websocketManager.on('status_change', handleConnectionStatusChange);


    // 监听WebSocket消息
    logger.log('background', 'info', '注册WebSocket消息监听器');
    websocketManager.on('message', handleWebSocketMessage);


    // 加载设置并自动连接（如果启用）
    loadSettingsAndConnect();

}

// 加载设置并自动连接
function loadSettingsAndConnect() {
    chrome.storage.sync.get(['serverUrl', 'apiKey', 'autoConnect'], (result) => {
        // 确保WebSocketManager实例有最新的apiKey
        if (result.apiKey) {
            websocketManager.apiKey = result.apiKey;

        }

        // 确保WebSocketManager实例有最新的serverUrl
        if (result.serverUrl) {
            websocketManager.serverUrl = result.serverUrl;

        }

        if (result.autoConnect && result.serverUrl) {
            // 自动连接
            connectToServer();
        }
    });
}

// 处理消息
function handleMessage(message, sender, sendResponse) {

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
            const response = {
                success: true,
                status: connectionStatus
            };
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
            // 设置已更新，直接调用WebSocketManager的updateConfig方法
            // 这样可以确保当配置被清空时，WebSocket连接会立即断开
            websocketManager.updateConfig();
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
        // 获取实际的连接状态
        const status = websocketManager.getStatus();
        logger.log('connection', 'debug', 'connectToServer状态', { status });

        // 检查连接状态
        if (status.status === 'connected') {
            return { success: true };
        } else if (status.status === 'error') {
            return { success: false, error: '连接失败: ' + (status.errorMessage || '未知错误') };
        } else {
            // 如果状态不是connected，但也没有明确的错误
            return { success: false, error: '连接状态: ' + status.status };
        }
    } catch (error) {
        logger.error('connection', '连接服务器失败', { error: error.message });
        return { success: false, error: error.message };
    }
}

// 断开服务器连接
async function disconnectFromServer() {
    try {
        await websocketManager.disconnect();
        return { success: true };
    } catch (error) {
        logger.error('connection', '断开连接失败', { error: error.message });
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
            logger.log('background', 'debug', '弹出窗口未打开，忽略状态更新消息');
        });
    } catch (error) {
        // 静默处理发送消息失败的情况
        logger.log('background', 'error', '发送状态更新消息失败', { error: error.message });
    }
}

// 处理接收到的WebSocket消息
async function handleWebSocketMessage(message) {
    logger.log('background', 'debug', '收到WebSocket消息', { message });

    try {
        // 根据消息格式处理
        let data;
        if (message && message.data) {
            // 检查是否是从websocket.js传递过来的包装消息
            if (message.data && message.data.command && message.originalEvent) {
                data = message.data; // 直接使用包装中的data字段
            }
            // 如果消息是对象且包含data属性
            else if (typeof message.data === 'string') {
                // 如果data是字符串，尝试解析JSON
                try {
                    data = JSON.parse(message.data);
                } catch (error) {
                    logger.error('websocket', '解析JSON失败', { error: error.message });
                    data = message.data; // 如果解析失败，使用原始字符串
                }
            } else if (typeof message.data === 'object') {
                // 如果data已经是对象，直接使用
                logger.log('background', 'debug', 'handleWebSocketMessage -> data是对象，直接使用', { message });
                data = message.data;
            }
        } else if (typeof message === 'object') {
            // 消息本身可能就是数据
            logger.log('background', 'debug', 'handleWebSocketMessage -> 消息本身作为数据使用', { message });
            data = message;
        }

        // 确保data是有效的
        if (!data || typeof data !== 'object') {
            logger.warn('websocket', '收到无效消息格式', { message });
            return;
        }

        logger.log('background', 'debug', 'handleWebSocketMessage -> 处理后的data', { data });

        // 检查消息来源是否为ws_command
        if (data.source === 'ws_command') {
            logger.log('background', 'debug', '收到来自websocket_send_command的消息', { data });
            // 处理来自websocket_send_command的消息
            logger.log('background', 'debug', '收到websocket_send_command指令', { action: data.action, command: data.command, url: data.url });
            if (data.command === 'open' && data.url) {
                await handleCaptureCommand(data);
                return;
            }

            const responseMessage = {
                type: 'response',
                message_id: data.message_id,
                success: true,
                error: false,
                content: data // 将原始消息内容一并返回
            };
            // 返回默认消息回服务器
            logger.log('background', 'debug', '返回默认消息回服务器', { responseMessage });
            websocketManager.sendMessage(responseMessage);
            return;
        }

        // 处理标准指令格式的消息
        const command = data.command;
        logger.debug('background', '检查command字段', { command });
        if (command) {
            logger.debug('background', '处理command', { command });
            switch (command) {
                case 'capture':
                    logger.debug('background', '执行capture命令');
                    await handleCaptureCommand(data);
                    break;
                case 'extract':
                    logger.debug('background', '执行extract命令');
                    await handleExtractCommand(data);
                    break;

                case 'navigate':
                    logger.debug('background', '执行navigate命令');
                    await handleNavigateCommand(data);
                    break;

                case 'open':
                    logger.debug('background', '执行open命令');
                    await handleOpenCommand(data);
                    break;

                default:
                    logger.warn('websocket', '未知指令', { command });
            }
        } else {
            logger.warn('websocket', '消息中没有command字段', { data });
        }
    } catch (error) {
        logger.error('websocket', '处理WebSocket消息失败', { error: error.message });
    }
}

// 处理截图指令
async function handleCaptureCommand(data) {
    logger.log('capture', 'info', '开始处理截图指令', data);
    try {
        // 如果指定了URL，先导航到该URL
        if (data.url) {
            logger.log('capture', 'info', '准备导航到URL', { url: data.url });
            await navigateToUrl(data.url);
            logger.log('capture', 'info', 'URL导航完成');
        }

        // 执行截图
        const captureOptions = {
            fullPage: data.fullPage !== false,
            area: data.area || null
        };
        logger.log('capture', 'info', '准备执行截图', captureOptions);

        const captureResult = await captureCurrentTab(captureOptions);
        logger.log('capture', 'info', '截图完成', {
            success: true, type: 'response',
            message_id: data.message_id,
            command: 'capture',
            success: true,
            result: captureResult
        });

        // 发送结果回服务器
        logger.log('capture', 'info', '准备发送截图结果到服务器');
        websocketManager.sendMessage({
            type: 'response',
            message_id: data.message_id,
            command: 'capture',
            success: true,
            result: captureResult
        });
    } catch (error) {
        // 记录错误日志
        logger.error('capture', '截图失败', { error: error.message });

        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            message_id: data.message_id,
            command: 'capture',
            success: false,
            error: error.message
        });
    }
}

// 处理内容提取指令
async function handleExtractCommand(data) {
    try {
        logger.log('extract', 'info', '开始处理内容提取指令', { message_id: data.message_id, url: data.url });

        // 如果指定了URL，先导航到该URL
        if (data.url) {
            logger.log('extract', 'info', '准备导航到URL', { url: data.url });
            await navigateToUrl(data.url);
            logger.log('extract', 'info', 'URL导航完成');
        }

        // 执行内容提取
        const extractOptions = {
            extractImages: data.extractImages !== false,
            extractLinks: data.extractLinks !== false,
            customSelectors: data.selectors || null
        };

        logger.log('extract', 'info', '准备执行内容提取', extractOptions);
        const extractResult = await extractTabContent(extractOptions);
        logger.log('extract', 'info', '内容提取完成', { result: extractResult });

        // 发送结果回服务器
        logger.log('extract', 'info', '准备发送提取结果到服务器');
        websocketManager.sendMessage({
            type: 'response',
            message_id: data.message_id,
            command: 'extract',
            success: true,
            result: extractResult
        });
        logger.log('extract', 'info', '提取结果已发送到服务器');
    } catch (error) {
        logger.error('extract', '内容提取失败', { error: error.message });

        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            message_id: data.message_id,
            command: 'extract',
            success: false,
            error: error.message
        });
        logger.log('extract', 'error', '错误信息已发送到服务器');
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
            message_id: data.message_id,
            command: 'navigate',
            success: true,
            url: data.url
        });
    } catch (error) {
        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            message_id: data.message_id,
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
            message_id: data.message_id || 'open_' + Date.now(), // 确保有ID，即使原始消息没有提供
            command: 'open',
            success: true,
            url: data.url
        });
    } catch (error) {
        // 发送错误回服务器
        websocketManager.sendMessage({
            type: 'response',
            message_id: data.message_id || 'open_' + Date.now(),
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

        // 获取图片格式、质量和全页面截图设置
        const { imageFormat, imageQuality } = await new Promise(resolve => {
            chrome.storage.sync.get(['imageFormat', 'imageQuality'], (result) => {
                resolve({
                    imageFormat: result.imageFormat || 'png',
                    imageQuality: result.imageQuality || 90,
                });
            });
        });

        // 合并配置和传入的选项
        const captureOptions = {
            fullPage: options.fullPage,
            area: options.area || null
        };

        const imageData = await captureManager.captureTab(captureOptions);

        return {
            url: tab.url,
            title: tab.title,
            timestamp: new Date().toISOString(),
            imageData,
            format: imageFormat,
            quality: imageQuality
        };
    } catch (error) {
        logger.error('capture', '截图失败', { error: error.message });
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
        logger.error('extract', '内容提取失败', { error: error.message });
        throw error;
    }
}

// 初始化
init();