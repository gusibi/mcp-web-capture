/**
 * 日志管理模块
 * 负责统一处理和存储日志信息
 */

class Logger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000; // 最大日志条数
    }

    /**
     * 添加日志
     * @param {string} module 模块名称
     * @param {string} type 日志类型 (info, warn, error)
     * @param {string} message 日志消息
     * @param {Object} [data] 额外数据
     */
    log(module, type, message, data = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            module,
            level: type,
            message,
            data
        };

        // 添加到内存中
        this.logs.push(logEntry);

        // 如果超过最大条数，删除最旧的日志
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // 同时输出到控制台
        const consoleMsg = `[${logEntry.module}] ${message}`;
        switch (type) {
            case 'error':
                console.error(consoleMsg, data);
                break;
            case 'warn':
                console.warn(consoleMsg, data);
                break;
            case 'info':
            default:
                console.log(consoleMsg, data);
        }

        // 存储到本地存储
        this.saveLogs();
    }

    /**
     * 获取所有日志
     */
    getLogs() {
        return this.logs;
    }

    /**
     * 清除所有日志
     */
    clearLogs() {
        this.logs = [];
        this.saveLogs();
    }

    /**
     * 将日志保存到本地存储
     */
    saveLogs() {
        chrome.storage.local.set({ 'captureLogs': this.logs }, () => {
            if (chrome.runtime.lastError) {
                console.error('保存日志失败:', chrome.runtime.lastError);
            }
        });
    }

    /**
     * 从本地存储加载日志
     */
    loadLogs() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['captureLogs'], (result) => {
                if (result.captureLogs) {
                    this.logs = result.captureLogs;
                }
                resolve();
            });
        });
    }

    /**
     * 错误日志快捷方法
     * @param {string} module 模块名称
     * @param {string} message 日志消息
     * @param {Object} [data] 额外数据
     */
    error(module, message, data = null) {
        this.log(module, 'error', message, data);
    }

    /**
     * 调试日志快捷方法
     * @param {string} module 模块名称
     * @param {string} message 日志消息
     * @param {Object} [data] 额外数据
     */
    debug(module, message, data = null) {
        this.log(module, 'debug', message, data);
    }

    /**
   * 调试日志快捷方法
   * @param {string} module 模块名称
   * @param {string} message 日志消息
   * @param {Object} [data] 额外数据
   */
    info(module, message, data = null) {
        this.log(module, 'info', message, data);
    }

    /**
  * 调试日志快捷方法
  * @param {string} module 模块名称
  * @param {string} message 日志消息
  * @param {Object} [data] 额外数据
  */
    warn(module, message, data = null) {
        this.log(module, 'warn', message, data);
    }
}



// 导出全局类定义和单例
self.logger = Logger;
self.logger = new Logger();