/**
 * WebSocket 连接管理模块
 * 负责与远程服务建立持久性 WebSocket 连接，处理消息收发和连接状态管理
 * 参考Python后端实现，使用apiKey作为连接ID，确保单一连接实例
 */

class WebSocketManager {
    constructor() {
        this.socket = null;
        this.serverUrl = null;
        this.apiKey = null; // 用作连接ID
        this.connId = null; // 存储连接ID
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
            } else {
                this.serverUrl = null;
            }
            if (result.apiKey) {
                this.apiKey = result.apiKey;
            } else {
                this.apiKey = null;
            }

            // 如果有配置，自动连接
            if (this.serverUrl && this.apiKey) {
                this.connect();
            } else if (this.socket) {
                // 如果配置被清空但仍有连接，断开连接
                console.log('配置已清空，断开WebSocket连接');
                this.disconnect();
            }
        });
    }

    /**
     * 更新WebSocket配置
     * 当设置页面保存新配置时调用此方法
     */
    updateConfig() {
        console.log('更新WebSocket配置');
        // 断开现有连接
        if (this.socket) {
            this.disconnect();
        }
        // 重新加载配置
        this.loadConfig();
    }

    /**
     * 建立WebSocket连接
     * 确保只创建一个WebSocket连接实例，使用apiKey作为连接ID
     */
    connect() {
        // 检查是否已有活跃连接，避免创建多个连接
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {

            return;
        }

        if (!this.serverUrl) {
            this.updateStatus('error', '未配置服务器地址');
            return;
        }

        if (!this.apiKey) {
            this.updateStatus('error', '未配置API密钥(连接ID)');
            return;
        }

        // 设置连接ID为apiKey
        this.connId = this.apiKey;


        this.updateStatus('connecting');

        try {
            // 创建WebSocket连接，将conn_id作为查询参数附加到URL
            const url = new URL(this.serverUrl);
            url.searchParams.append('conn_id', this.connId);

            this.socket = new WebSocket(url.toString());


            // 设置事件处理器
            this.socket.onopen = this.handleOpen.bind(this);
            this.socket.onmessage = this.handleMessage.bind(this);
            this.socket.onclose = this.handleClose.bind(this);
            this.socket.onerror = this.handleError.bind(this);

        } catch (error) {
            console.error('------------->创建WebSocket连接时发生错误:', error);
            this.updateStatus('error', error.message);
            this.scheduleReconnect();
        }
    }

    /**
     * 处理WebSocket连接成功事件
     * 发送带有连接ID的认证消息
     */
    handleOpen(event) {

        this.updateStatus('connected');
        this.reconnectAttempts = 0;

        // 发送认证消息，包含连接ID
        if (this.apiKey) {
            this.sendMessage({
                type: 'auth',
                apiKey: this.apiKey,
                conn_id: this.connId // 发送连接ID给服务器
            });

        }

        // 触发连接事件
        this.emit('connected');
    }

    /**
     * 处理接收到的WebSocket消息
     * 增强Service Worker环境下的消息处理能力
     * 处理连接ID确认和认证响应
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



            // 处理认证响应，检查是否包含连接ID确认
            if (message && typeof message === 'object' && message.type === 'auth_response') {

                this.handleAuthResponse(message);
                return;
            }

            // 根据消息类型处理
            if (message && typeof message === 'object' && message.command) {
                // 首先检查是否有command字段，与background.js保持一致

                // 直接传递消息，让background.js处理command
                this.emit('message', { data: message, originalEvent: event });

                return;
            } else {
                // 处理非对象类型的消息

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
     * 处理服务器返回的连接ID确认
     */
    handleAuthResponse(message) {
        if (message.success) {
            // 如果服务器返回了连接ID，更新本地存储的连接ID
            if (message.conn_id) {
                this.connId = message.conn_id;

            } else {

            }
            this.emit('auth_success', { connId: this.connId });
        } else {
            console.error('认证失败:', message.error);
            this.updateStatus('error', '认证失败: ' + message.error);
            this.emit('auth_failure', message.error);
        }
    }

    /**
 * 检测是否为403错误的辅助方法
 * @param {Event|CloseEvent|Error} event - WebSocket错误或关闭事件
 * @returns {boolean} 是否为403错误
 */
    detect403Error(event) {
        const reason = event?.reason || '';
        const message = event?.message || '';
        const url = event?.target?.url || this.serverUrl || '';

        // 1. 检查明显的403关键字
        if (reason.includes('403') || message.includes('403') || reason.includes('Forbidden') || message.includes('Forbidden')) {
            return true;
        }

        // 2. 特殊错误码，可能是403或URL错误
        if (event.code === 1006 || event.code === 1015) {
            // TLS失败常常是 URL 配错，或服务器拒绝连接
            if (url && (url.includes('wrong') || url.includes('invalid') || url.includes('localhost'))) {
                console.warn('WebSocket URL 可能配置错误:', url);
                return true; // 假定为连接失败或伪403
            }

            // fallback: 看 errorMessage 中有没有提示
            if (this.errorMessage && this.errorMessage.includes('403')) {
                return true;
            }

            // TLS 失败的场景（一般是 serverUrl 写错、证书无效）
            if (event.code === 1015 && url.startsWith('wss://')) {
                console.warn('TLS 握手失败，可能为伪403或无效 serverUrl');
                return true;
            }
        }

        return false;
    }


    /**
 * 处理WebSocket关闭事件
 */
    handleClose(event) {
        console.log(`WebSocket连接已关闭: 代码=${event.code}, 原因=${event.reason || '无原因'}`);

        // 检查是否可能为403错误
        const is403Error = this.detect403Error(event);

        if (is403Error) {
            const errorMsg = '服务器拒绝连接 (403 Forbidden)';
            console.error('WebSocket 403错误:', errorMsg);
            this.updateStatus('error', errorMsg);
            this.emit('error', { code: event.code, message: errorMsg, is403Error: true });
            this.reconnectAttempts = this.maxReconnectAttempts; // 阻止重连
        } else if (event.code === 1006 || event.code === 1015) {
            // 异常关闭（1006: 异常终止，1015: TLS失败）
            const errorMsg = event.reason || `连接异常关闭 (代码: ${event.code})`;
            console.error('WebSocket异常关闭:', errorMsg);
            this.updateStatus('error', errorMsg);
            this.emit('error', { code: event.code, message: errorMsg });
            this.scheduleReconnect();
        } else {
            // 正常关闭
            console.log('WebSocket正常关闭');
            this.updateStatus('disconnected');
            this.emit('disconnected', event);
        }
    }

    /**
 * 处理WebSocket错误事件
 */
    handleError(error) {
        console.error('WebSocket错误:', error);

        // 默认错误信息
        let errorMessage = '连接错误';
        let is403Error = false;

        // 检测可能的403错误
        is403Error = this.detect403Error(error);

        if (is403Error) {
            errorMessage = '服务器拒绝连接 (403 Forbidden)';
            console.error('WebSocket 403错误:', errorMessage);
        } else if (error.message) {
            errorMessage = error.message;
        } else if (error.target && error.target.url) {
            errorMessage = `无法连接到 ${error.target.url}`;
        }

        // 更新状态并触发错误事件
        this.updateStatus('error', errorMessage);
        this.emit('error', { message: errorMessage, originalError: error, is403Error });

        // 根据错误类型决定是否重连
        if (is403Error) {
            console.log('403错误，停止重连');
            this.reconnectAttempts = this.maxReconnectAttempts; // 阻止重连
        } else {
            console.log('非403错误，尝试重连');
            this.scheduleReconnect();
        }
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
     * 清除连接ID
     */
    disconnect() {
        if (this.socket) {
            console.log(`断开WebSocket连接，连接ID: ${this.connId}`);
            this.socket.close();
            this.socket = null;
        }
        // 断开连接时清除连接ID，但保留apiKey以便重新连接
        this.connId = null;
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
        this.errorMessage = errorMessage; // 保存错误消息到实例属性

        // 构建状态对象，确保包含所有必要信息
        const statusObj = {
            status,
            errorMessage,
            connected: status === 'connected',
            serverUrl: this.serverUrl,
            connId: this.connId // 添加连接ID到状态对象
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
     * 包含连接ID信息和错误消息
     */
    getStatus() {
        return {
            status: this.connectionStatus,
            serverUrl: this.serverUrl,
            connId: this.connId,
            apiKey: this.apiKey,
            errorMessage: this.errorMessage // 添加错误消息属性
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