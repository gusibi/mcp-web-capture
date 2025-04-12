class WebSocketManager {
    constructor() {
        this.socket = null;
        this.serverUrl = null;
        this.apiKey = null; // 用作连接ID
        this.connId = null; // 存储实际使用的连接ID (可能由服务器确认)
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000; // 3秒
        this.listeners = {};
        this.connectionStatus = 'disconnected'; // 'connected', 'connecting', 'disconnected', 'error'
        this.errorMessage = null; // 存储最新的错误消息
        this.connectTimeoutTimer = null; // 连接超时计时器
        this.CONNECT_TIMEOUT_MS = 10000; // 10秒连接超时
        this.keepAliveInterval = 25000; // 25秒心跳间隔
        this.keepAliveTimer = null; // 心跳计时器
        this.PING_MESSAGE = JSON.stringify({ type: 'ping' }); // 心跳消息

        // 从存储中加载配置
        this.loadConfig();

        // 监听配置变化
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'sync' && (changes.serverUrl || changes.apiKey)) {
                console.log('检测到配置更改，将重新加载并连接...');
                this.updateConfig();
            }
        });
    }

    /**
     * 从Chrome存储中加载WebSocket配置
     */
    loadConfig() {
        return new Promise((resolve) => { // 返回 Promise 以便知道加载完成
            chrome.storage.sync.get(['serverUrl', 'apiKey'], (result) => {
                const oldServerUrl = this.serverUrl;
                const oldApiKey = this.apiKey;
                let configChanged = false;

                if (result.serverUrl && result.serverUrl !== oldServerUrl) {
                    this.serverUrl = result.serverUrl;
                    configChanged = true;
                } else if (!result.serverUrl) {
                    this.serverUrl = null;
                    if (oldServerUrl) configChanged = true;
                }

                if (result.apiKey && result.apiKey !== oldApiKey) {
                    this.apiKey = result.apiKey;
                    configChanged = true;
                } else if (!result.apiKey) {
                    this.apiKey = null;
                    if (oldApiKey) configChanged = true;
                }

                console.log('配置已加载:', { serverUrl: this.serverUrl, apiKey: this.apiKey ? '***' : null });

                resolve(configChanged); // 解析 Promise，告知配置是否变化
            });
        });
    }

    /**
     * 更新WebSocket配置
     * 当检测到存储变化时调用此方法
     */
    async updateConfig() {
        console.log('开始更新WebSocket配置...');
        // 断开现有连接
        this.disconnect(true); // 传入 true 表示是配置更新导致的断开

        // 重新加载配置
        const changed = await this.loadConfig();

        // 如果配置有效且已更改或之前未连接，则尝试连接
        if (this.serverUrl && this.apiKey) {
            console.log('配置有效，尝试连接...');
            this.connect();
        } else {
            console.log('配置无效或已清空，保持断开状态。');
            this.updateStatus('disconnected', '配置无效或未设置');
        }
    }

    /**
     * 建立WebSocket连接
     * 确保只创建一个WebSocket连接实例
     */
    connect() {
        // 清除之前的连接超时计时器
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;

        // 检查是否已有活跃连接或正在连接
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            console.log('已有活跃或正在连接的WebSocket，跳过连接');
            return;
        }

        // 检查配置
        if (!this.serverUrl) {
            this.updateStatus('error', '未配置服务器地址');
            return;
        }
        if (!this.apiKey) {
            this.updateStatus('error', '未配置API密钥(连接ID)');
            return;
        }

        // 验证 serverUrl 格式 (基本验证)
        let parsedUrl;
        try {
            parsedUrl = new URL(this.serverUrl);
            if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) {
                const errorMsg = `无效的协议: ${parsedUrl.protocol}，请使用 ws:// 或 wss://`;
                this.updateStatus('error', errorMsg);
                // 这是配置错误，不应该重连
                this.reconnectAttempts = this.maxReconnectAttempts;
                return;
            }
            if (!parsedUrl.hostname) {
                const errorMsg = `无效的主机名: ${this.serverUrl}`;
                this.updateStatus('error', errorMsg);
                this.reconnectAttempts = this.maxReconnectAttempts;
                return;
            }
        } catch (e) {
            const errorMsg = `无效的 serverUrl 格式: ${this.serverUrl}`;
            this.updateStatus('error', errorMsg);
            // 这是配置错误，不应该重连
            this.reconnectAttempts = this.maxReconnectAttempts;
            return;
        }

        // 设置初始连接ID为apiKey
        this.connId = this.apiKey;
        this.updateStatus('connecting');
        console.log(`尝试连接到: ${parsedUrl.origin}${parsedUrl.pathname}?conn_id=${this.connId}`);

        try {
            // 创建WebSocket连接，将conn_id作为查询参数附加到URL
            const urlWithConnId = new URL(this.serverUrl);
            urlWithConnId.searchParams.append('conn_id', this.connId);

            this.socket = new WebSocket(urlWithConnId.toString());

            // 设置连接超时
            this.connectTimeoutTimer = setTimeout(() => {
                if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
                    console.warn('WebSocket 连接超时');
                    // 主动关闭尝试超时的连接
                    this.socket.close(1000, 'Connection Timeout'); // 使用 1000 或自定义代码
                    // handleClose 会被触发，并处理重连逻辑
                }
            }, this.CONNECT_TIMEOUT_MS);

            // 设置事件处理器
            this.socket.onopen = this.handleOpen.bind(this);
            this.socket.onmessage = this.handleMessage.bind(this);
            this.socket.onclose = this.handleClose.bind(this);
            this.socket.onerror = this.handleError.bind(this); // onerror 通常在 onclose 之前触发

        } catch (error) {
            // WebSocket 构造函数本身抛出的错误 (例如，安全策略阻止)
            console.error('创建WebSocket实例时发生错误:', error);
            this.updateStatus('error', `创建连接失败: ${error.message}`);
            // 这种错误通常也是不可恢复的，停止重连
            this.reconnectAttempts = this.maxReconnectAttempts;
            this.socket = null; // 确保 socket 实例被清理
        }
    }

    /**
     * 处理WebSocket连接成功事件
     */
    handleOpen(event) {
        clearTimeout(this.connectTimeoutTimer); // 清除连接超时计时器
        this.connectTimeoutTimer = null;
        console.log('WebSocket连接已建立');
        this.updateStatus('connected');
        this.reconnectAttempts = 0; // 重置重连尝试次数

        // 启动心跳机制
        this.startKeepAlive();

        // 发送认证消息 (如果需要)
        if (this.apiKey) {
            this.sendMessage({
                type: 'auth',
                apiKey: this.apiKey,
                conn_id: this.connId // 再次确认连接ID
            });
            console.log('已发送认证消息');
        }

        // 触发连接事件
        this.emit('connected');
    }

    /**
     * 处理接收到的WebSocket消息
     */
    handleMessage(event) {
        console.log('[WebSocketManager] 收到WebSocket消息:', event.data); // 调试日志
        try {
            if (!event || !event.data) {
                console.warn('收到空的WebSocket消息事件');
                return;
            }

            let message;
            try {
                message = JSON.parse(event.data);
            } catch (parseError) {
                console.error('解析WebSocket消息失败:', parseError, '原始数据:', event.data);
                this.emit('message', { rawData: event.data, parseError: true });
                return;
            }

            // 处理认证响应
            if (message && typeof message === 'object' && message.type === 'auth_response') {
                this.handleAuthResponse(message);
                return;
            }

            // 触发通用消息事件
            this.emit('message', { data: message, originalEvent: event });

        } catch (error) {
            console.error('处理WebSocket消息时发生内部错误:', error);
            this.emit('error', { error, source: 'message_handler' });
        }
    }

    /**
     * 处理认证响应
     */
    handleAuthResponse(message) {
        if (message.success) {
            console.log('服务器认证成功。');
            // 如果服务器返回了确认的conn_id，可以更新它，虽然通常它就是apiKey
            if (message.conn_id && message.conn_id !== this.connId) {
                console.log(`服务器确认的 conn_id 不同: ${message.conn_id} (本地: ${this.connId})，已更新。`);
                this.connId = message.conn_id;
            }
            this.emit('auth_success', { connId: this.connId });
        } else {
            const errorMsg = `认证失败: ${message.error || '未知原因'}`;
            console.error(errorMsg);
            this.updateStatus('error', errorMsg);
            this.emit('auth_failure', message.error);
            // 认证失败通常意味着apiKey错误，阻止重连
            this.reconnectAttempts = this.maxReconnectAttempts;
            this.disconnect(false); // 主动断开
        }
    }

    /**
     * 辅助方法：尝试推断是否为连接握手阶段的错误（可能包括403）
     * @param {CloseEvent} event - WebSocket 关闭事件
     * @returns {boolean} 是否可能是握手错误
     */
    isHandshakeError(event) {
        // 1. 检查明确的 "Forbidden" 或 "403" (虽然不常见)
        const reason = event?.reason?.toLowerCase() || '';
        if (reason.includes('forbidden') || reason.includes('403')) {
            console.warn('检测到关闭原因包含 "forbidden" 或 "403"');
            return true;
        }

        // 2. 检查常见的握手失败代码
        // 1006 (Abnormal Closure) 是最常见的，但也可能由其他原因引起
        // 1002 (Protocol Error)
        // 1015 (TLS Handshake failure) - 通常是 WSS 配置问题
        if ([1002, 1006, 1015].includes(event?.code)) {
            // 如果状态仍然是 'connecting' 就关闭，极有可能是握手失败
            if (this.connectionStatus === 'connecting') {
                console.warn(`连接在 "connecting" 状态下关闭 (Code: ${event.code})，推测为握手失败。`);
                return true;
            }
            // 如果是 1015 TLS 错误，几乎肯定是配置/服务器问题
            if (event.code === 1015) {
                console.warn(`检测到 TLS 握手失败 (Code: 1015)`);
                return true;
            }
            // 对于 1006，如果不是在 connecting 状态，则不太确定
            if (event.code === 1006) {
                console.log(`连接异常关闭 (Code: 1006)，原因未知，可能不是握手错误。`);
            }
        }

        // 3. 检查连接超时关闭（ ourselves 触发的）
        if (event?.code === 1000 && reason === 'Connection Timeout') {
            console.warn('检测到连接超时关闭。');
            return true; // 视为一种连接建立失败
        }

        return false;
    }


    /**
     * 处理WebSocket关闭事件
     */
    handleClose(event) {
        clearTimeout(this.connectTimeoutTimer); // 清除可能存在的连接超时计时器
        this.connectTimeoutTimer = null;

        console.log(`WebSocket连接已关闭: 代码=${event.code}, 原因='${event.reason || '无'}' Clean=${event.wasClean}`);

        // 如果 socket 实例已被手动置 null (例如在 disconnect 中)，则不再处理
        if (!this.socket) {
            console.log("Socket 实例已清除，跳过 handleClose 处理。");
            return;
        }

        this.socket = null; // 清理 socket 实例引用

        const wasConnecting = this.connectionStatus === 'connecting';
        const possibleHandshakeError = this.isHandshakeError(event);

        // 默认错误消息和重连决策
        let errorMsg = null;
        let shouldReconnect = true;
        let finalStatus = 'disconnected'; // 默认为断开

        if (event.wasClean && event.code === 1000) {
            // 正常关闭 (例如调用了 socket.close() 或服务器主动正常关闭)
            console.log("WebSocket 正常关闭。");
            shouldReconnect = false; // 通常正常关闭不重连
            if (this.statusBeforeDisconnect === 'config_update') { // 特殊标记，避免更新状态为error
                finalStatus = 'disconnected';
            }
        } else if (possibleHandshakeError) {
            // 推测为握手错误 (可能 403, 404, URL错误, TLS错误, 超时等)
            finalStatus = 'error';
            if (event.code === 1015) {
                errorMsg = "连接失败: TLS 握手错误。请检查wss://地址和服务器证书。";
            } else if (event.reason && (event.reason.toLowerCase().includes('forbidden') || event.reason.includes('403'))) {
                errorMsg = "连接失败: 服务器拒绝连接 (403 Forbidden)。请检查 API Key 或服务器权限设置。";
            } else if (event.reason === 'Connection Timeout') {
                errorMsg = "连接失败: 连接超时。请检查服务器地址和网络。";
            } else {
                // 通用握手错误消息
                errorMsg = `连接失败 (Code: ${event.code})。请检查服务器地址 (${this.serverUrl})、API Key 是否正确，以及服务器是否正在运行。`;
            }
            // 对于握手错误，通常不应无限重连
            this.reconnectAttempts = this.maxReconnectAttempts;
            shouldReconnect = false; // 阻止自动重连
            console.error(`握手错误: ${errorMsg}`);
            this.updateStatus('error', errorMsg);
            // 继续执行后续的状态更新和事件触发逻辑
        } else {
            // 其他异常关闭 (例如网络中断、服务器崩溃后未正常关闭连接)
            finalStatus = 'disconnected'; // 状态是断开，但会尝试重连
            errorMsg = `连接意外断开 (Code: ${event.code})。`;
            console.warn(errorMsg, '将尝试重新连接。');
            shouldReconnect = true; // 尝试重连
        }

        // 更新状态
        this.updateStatus(finalStatus, errorMsg);
        this.emit(finalStatus === 'error' ? 'error' : 'disconnected', { code: event.code, reason: event.reason, wasClean: event.wasClean, message: errorMsg });


        // 根据情况决定是否重连
        if (shouldReconnect && this.connectionStatus !== 'connected') {
            this.scheduleReconnect();
        } else if (!shouldReconnect) {
            console.log("根据关闭事件分析，不安排自动重连。");
        }

        // 清理标记
        this.statusBeforeDisconnect = null;
    }

    /**
     * 处理WebSocket错误事件
     * 注意：onerror 事件通常在 onclose 之前触发，且信息可能很有限。
     * 主要依赖 onclose 来判断连接失败的原因。
     */
    handleError(error) {
        // 这个事件通常只提供非常有限的信息，例如 "Error in connection establishment: net::ERR_NAME_NOT_RESOLVED"
        // 或者干脆就是一个通用的 "Event" 对象。
        // 它本身很难用来判断 403。
        console.error('WebSocket onerror 事件触发:', error);

        // 通常 onerror 后会立即触发 onclose，我们将主要逻辑放在 onclose 中处理。
        // 这里可以记录下错误，但不必立即更新状态或决定重连，等待 onclose 提供更详细信息。
        // 可以在这里暂存一个可能的错误信息，如果 onclose 没有提供更好的信息时使用。
        this.potentialErrorMessage = "WebSocket 发生未知连接错误。";
    }

    /**
     * 安排重新连接
     */
    scheduleReconnect() {
        if (this.connectionStatus === 'connecting' || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
            console.log("已经在连接或已连接，取消重连调度。");
            return;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1); // 指数退避
            const cappedDelay = Math.min(delay, 30000); // 最长30秒
            console.log(`${cappedDelay / 1000}秒后尝试重新连接 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            // 清除可能存在的旧计时器
            clearTimeout(this.reconnectTimer);

            this.reconnectTimer = setTimeout(() => {
                if (this.connectionStatus !== 'connected' && this.connectionStatus !== 'connecting') {
                    console.log("执行重连...");
                    this.connect();
                } else {
                    console.log("重连计时器触发，但状态已变为连接或正在连接，取消本次重连。");
                }
            }, cappedDelay);
        } else {
            console.error('达到最大重连次数，停止重连。');
            this.updateStatus('error', this.errorMessage || '无法连接到服务器，已达最大重连次数。');
        }
    }

    /**
     * 断开WebSocket连接
     * @param {boolean} isConfigUpdate - 是否因为配置更新而断开
     */
    disconnect(isConfigUpdate = false) {
        clearTimeout(this.reconnectTimer); // 清除重连计时器
        clearTimeout(this.connectTimeoutTimer); // 清除连接超时计时器
        clearInterval(this.keepAliveTimer); // 清除心跳计时器
        this.reconnectTimer = null;
        this.connectTimeoutTimer = null;
        this.keepAliveTimer = null;

        if (this.socket) {
            console.log(`主动断开WebSocket连接，连接ID: ${this.connId}`);
            // 设置一个标记，以便 handleClose 知道是主动断开还是配置更新
            this.statusBeforeDisconnect = isConfigUpdate ? 'config_update' : 'manual_disconnect';

            // 设置 onclose 为 null，避免在手动关闭时触发重连逻辑 (可选，但更清晰)
            // this.socket.onclose = null;
            // this.socket.onerror = null;

            if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
                this.socket.close(1000, isConfigUpdate ? "Configuration updated" : "Manual disconnection"); // 使用 1000 表示正常关闭
            }
            this.socket = null; // 立即清除引用
        } else {
            console.log("没有活跃的 WebSocket 连接可断开。");
        }

        // 如果不是因为配置更新，则更新状态为 disconnected
        if (!isConfigUpdate) {
            this.updateStatus('disconnected');
        }
        // 清空 connId 可能不是最佳选择，因为重连时还需要它。
        // 可以在连接失败或成功获取新 ID 时再更新 connId。
        // this.connId = null;
        this.reconnectAttempts = 0; // 重置重连次数
    }

    /**
     * 启动心跳机制
     */
    startKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
        }
        this.keepAliveTimer = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(this.PING_MESSAGE);
                console.log('发送心跳消息');
            }
        }, this.keepAliveInterval);
    }

    /**
     * 发送消息到服务器
     */
    sendMessage(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket未连接，无法发送消息:', message);
            return false;
        }

        try {
            const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
            // console.log('发送消息:', messageStr); // 调试时打开
            this.socket.send(messageStr);
            return true;
        } catch (error) {
            console.error('发送消息失败:', error);
            // 可以在这里触发一个错误事件或尝试处理
            this.handleError(new Error(`Failed to send message: ${error.message}`));
            return false;
        }
    }

    /**
     * 更新连接状态并通知其他部分
     */
    updateStatus(status, errorMessage = null) {
        // 只有当状态实际改变时才执行更新和通知
        if (status === this.connectionStatus && errorMessage === this.errorMessage) {
            return;
        }

        this.connectionStatus = status;

        // 如果状态变为非错误状态，清除错误消息
        if (status === 'connected' || status === 'disconnected' || status === 'connecting') {
            // 但如果传入了错误消息（例如 'disconnected' 时附带原因），则保留
            this.errorMessage = errorMessage;
        } else if (status === 'error') {
            // 如果状态是 error，优先使用传入的 errorMessage，否则保留旧的或使用默认值
            this.errorMessage = errorMessage || this.errorMessage || '未知错误';
        }

        const statusObj = {
            status: this.connectionStatus,
            errorMessage: this.errorMessage,
            connected: this.connectionStatus === 'connected',
            serverUrl: this.serverUrl,
            connId: this.connId
        };

        console.log('WebSocket 状态更新:', statusObj);

        // 触发内部状态变更事件
        this.emit('status_change', statusObj);

        // 尝试发送消息到扩展的其他部分 (例如 popup 或 options 页面)
        this.notifyExtension('connection_status_update', statusObj);
    }

    /**
     * 向扩展的其他部分发送消息 (Service Worker 安全)
     */
    notifyExtension(action, data) {
        const message = { action, ...data };
        // 尝试发送给 Popup (如果打开)
        chrome.runtime.sendMessage(message).catch(error => {
            // 忽略 "Could not establish connection. Receiving end does not exist." 错误
            if (!error.message.includes('Receiving end does not exist')) {
                console.warn('向运行时发送消息失败 (可能是 popup 未打开):', error);
            }
        });

        // 如果需要通知所有 Content Scripts (通常不需要通知状态)
        // chrome.tabs.query({}, (tabs) => {
        //     tabs.forEach(tab => {
        //         chrome.tabs.sendMessage(tab.id, message).catch(error => {
        //             if (!error.message.includes('Receiving end does not exist')) {
        //                  console.warn(`向 Tab ${tab.id} 发送消息失败:`, error);
        //             }
        //         });
        //     });
        // });
    }


    /**
     * 获取当前连接状态
     */
    getStatus() {
        return {
            status: this.connectionStatus,
            serverUrl: this.serverUrl,
            connId: this.connId,
            apiKey: this.apiKey ? '***' : null, // 不直接暴露 key
            errorMessage: this.errorMessage
        };
    }

    /**
     * 注册事件监听器
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
        return this;
    }

    /**
     * 移除事件监听器
     */
    off(event, callback) {
        if (!this.listeners[event]) return this;
        if (callback) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        } else {
            delete this.listeners[event];
        }
        return this;
    }

    /**
     * 触发事件
     */
    emit(event, data) {
        console.log(`WebSocketManager.emit: 触发事件 '${event}'`, data ? JSON.stringify(data).substring(0, 100) + '...' : '');
        if (!this.listeners[event] || this.listeners[event].length === 0) {
            // console.log(`WebSocketManager.emit: 事件 '${event}' 没有监听器。`);
            // 取消了默认响应逻辑，因为这可能导致意外行为
            return;
        }

        // 使用 slice() 创建副本，防止监听器在迭代过程中修改数组导致问题
        this.listeners[event].slice().forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`执行事件 '${event}' 的监听器时出错:`, error);
            }
        });
    }
}

// --- Service Worker 环境下的实例化和导出 ---

// 确保只创建一个实例 (单例模式)
if (!self.websocketManagerInstance) {
    self.websocketManagerInstance = new WebSocketManager();
    console.log("WebSocketManager 已在 Service Worker 中实例化。");
}

// 可以选择性地导出实例，或者让其他脚本通过 self.websocketManagerInstance 访问
// export default self.websocketManagerInstance; // 如果使用 ES 模块

// 或者保持你原来的方式，如果其他脚本期望全局 self.websocketManager
self.WebSocketManager = WebSocketManager; // 导出类本身（如果需要）
self.websocketManager = self.websocketManagerInstance; // 导出实例