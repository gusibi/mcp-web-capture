/**
 * WebSocket 连接管理模块
 * 负责与远程服务建立持久性 WebSocket 连接，处理消息收发和连接状态管理
 */

class WebSocketManager {
    constructor() {
        this.socket = null;
        this.serverUrl = null;
        this.apiKey = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000; // 3秒
        this.listeners = {};
        this.connectionStatus = 'disconnected'; // 'connected', 'connecting', 'disconnected', 'error'

        // 从存储中加载配置
        this.loadConfig();
    }

    /**
     * 从Chrome存储中加载WebSocket配置
     */
    loadConfig() {
        chrome.storage.sync.get(['serverUrl', 'apiKey'], (result) => {
            if (result.serverUrl) {
                this.serverUrl = result.serverUrl;
            }
            if (result.apiKey) {
                this.apiKey = result.apiKey;
            }

            // 如果有配置，自动连接
            if (this.serverUrl) {
                this.connect();
            }
        });
    }

    /**
     * 建立WebSocket连接
     */
    connect() {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            console.log('WebSocket已连接或正在连接中');
            return;
        }

        if (!this.serverUrl) {
            this.updateStatus('error', '未配置服务器地址');
            return;
        }

        this.updateStatus('connecting');

        try {
            // 创建WebSocket连接
            this.socket = new WebSocket(this.serverUrl);

            // 设置事件处理器
            this.socket.onopen = this.handleOpen.bind(this);
            this.socket.onmessage = this.handleMessage.bind(this);
            this.socket.onclose = this.handleClose.bind(this);
            this.socket.onerror = this.handleError.bind(this);
        } catch (error) {
            this.updateStatus('error', error.message);
            this.scheduleReconnect();
        }
    }

    /**
     * 处理WebSocket连接成功事件
     */
    handleOpen(event) {
        console.log('WebSocket连接已建立: ', this.serverUrl);
        this.updateStatus('connected');
        this.reconnectAttempts = 0;

        // 发送认证消息
        if (this.apiKey) {
            this.sendMessage({
                type: 'auth',
                apiKey: this.apiKey
            });
        }

        // 触发连接事件
        this.emit('connected');
    }

    /**
     * 处理接收到的WebSocket消息
     * 增强Service Worker环境下的消息处理能力
     */
    handleMessage(event) {
        try {
            // 确保event对象有效
            if (!event || !event.data) {
                console.error('收到无效WebSocket消息事件');
                return;
            }

            // 尝试解析消息
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (parseError) {
                console.error('解析WebSocket消息失败:', parseError);
                // 即使解析失败，也将原始消息传递出去
                this.emit('message', { data: event.data, parseError: true });
                return;
            }

            console.log('WebSocketManager.handleMessage->收到消息:', message);

            // 根据消息类型处理
            if (message && typeof message === 'object' && message.command) {
                // 首先检查是否有command字段，与background.js保持一致
                console.log('WebSocketManager.handleMessage->发现command字段:', message.command);
                // 直接传递消息，让background.js处理command
                this.emit('message', { data: message, originalEvent: event });
                console.log('WebSocketManager.handleMessage->已发送message事件:', message);
                return;
            } else {
                // 处理非对象类型的消息
                console.log('WebSocketManager.handleMessage->发送非对象message事件:', { data: message, isNotObject: true });
                this.emit('message', { data: message, isNotObject: true });
            }
        } catch (error) {
            console.error('处理WebSocket消息时发生错误:', error);
            // 确保错误不会中断Service Worker
            this.emit('error', { error, source: 'message_handler' });
        }
    }

    /**
     * 处理认证响应
     */
    handleAuthResponse(message) {
        if (message.success) {
            console.log('认证成功');
            this.emit('auth_success');
        } else {
            console.error('认证失败:', message.error);
            this.updateStatus('error', '认证失败: ' + message.error);
            this.emit('auth_failure', message.error);
        }
    }

    /**
     * 处理WebSocket连接关闭事件
     */
    handleClose(event) {
        console.log(`WebSocket连接已关闭: ${event.code} ${event.reason}`);
        this.updateStatus('disconnected');
        this.emit('disconnected', event);

        // 尝试重新连接
        this.scheduleReconnect();
    }

    /**
     * 处理WebSocket错误事件
     */
    handleError(error) {
        console.error('WebSocket错误:', error);
        this.updateStatus('error', error.message || '连接错误');
        this.emit('error', error);
    }

    /**
     * 安排重新连接
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`${this.reconnectInterval / 1000}秒后尝试重新连接 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                this.connect();
            }, this.reconnectInterval);
        } else {
            console.error('达到最大重连次数，停止重连');
            this.updateStatus('error', '无法连接到服务器');
        }
    }

    /**
     * 断开WebSocket连接
     */
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.updateStatus('disconnected');
    }

    /**
     * 发送消息到服务器
     */
    sendMessage(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket未连接，无法发送消息');
            return false;
        }

        try {
            const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
            this.socket.send(messageStr);
            return true;
        } catch (error) {
            console.error('发送消息失败:', error);
            return false;
        }
    }

    /**
     * 更新连接状态
     * 增强Service Worker环境下的错误处理
     */
    updateStatus(status, errorMessage = null) {
        this.connectionStatus = status;

        // 构建状态对象，确保包含所有必要信息
        const statusObj = {
            status,
            errorMessage,
            connected: status === 'connected',
            serverUrl: this.serverUrl
        };

        // 触发状态变更事件
        this.emit('status_change', statusObj);

        // 发送状态更新到扩展图标
        try {
            chrome.runtime.sendMessage({
                action: 'connection_status_update',
                status: status,
                errorMessage: errorMessage
            }).catch(error => {
                console.log('发送状态更新失败，可能是接收方未准备好', error);
            });
        } catch (error) {
            console.error('发送状态更新消息时出错:', error);
        }
    }

    /**
     * 获取当前连接状态
     */
    getStatus() {
        return {
            status: this.connectionStatus,
            serverUrl: this.serverUrl
        };
    }

    /**
     * 注册事件监听器
     * 在Service Worker环境中使用更可靠的事件处理方式
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        // 确保回调函数是可序列化的，或者使用适当的绑定
        this.listeners[event].push(callback);
        return this; // 支持链式调用
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
        return this; // 支持链式调用
    }

    /**
     * 触发事件
     * 使用try-catch包装每个回调，防止一个回调错误影响其他回调
     */
    emit(event, data) {
        console.log('WebSocketManager.emit->触发事件:', event, '监听器数量:', this.listeners[event] ? this.listeners[event].length : 0);
        if (!this.listeners[event]) {
            console.log(`WebSocketManager.emit->未找到事件[${event}]的监听器，使用默认响应`);
            // 提供默认响应处理
            if (data && typeof data === 'object' && data.message_id) {
                // 如果消息包含message_id，说明需要响应
                this.sendMessage({
                    type: 'default_response',
                    message_id: data.message_id,
                    event: event,
                    status: 'unhandled',
                    timestamp: new Date().toISOString()
                });
                console.log(`WebSocketManager.emit->已发送默认响应，事件[${event}]，消息ID[${data.message_id}]`);
            }
            return;
        }

        for (const callback of this.listeners[event]) {
            try {
                console.log('WebSocketManager.emit->执行回调:', event);
                callback(data);
                console.log('WebSocketManager.emit->回调执行完成:', event);
            } catch (error) {
                console.error(`事件处理器错误 (${event}):`, error);
            }
        }
    }
}

// 导出类定义，避免重复实例化
self.WebSocketManager = WebSocketManager;
self.websocketManager = new WebSocketManager();