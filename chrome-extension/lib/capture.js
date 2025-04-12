/**
 * 网页截图功能模块
 * 负责实现网页截图功能，支持全页面或指定区域截图
 */

class CaptureManager {
    constructor() {
        this.captureInProgress = false;
        this.offscreenCreated = false;
    }

    /**
     * 保存日志到chrome.storage.local
     * @private
     * @param {Object} logEntry 日志条目
     */
    async #saveLog(logEntry) {
        try {
            const { logs = [] } = await chrome.storage.local.get('logs');
            logs.push(logEntry);
            await chrome.storage.local.set({ logs });
        } catch (error) {
            console.error('[CaptureManager] Failed to save log:', error);
        }
    }

    /**
     * 创建或获取offscreen document
     * @private
     */
    async #ensureOffscreenDocument() {
        if (this.offscreenCreated) {
            const logEntry = {
                timestamp: Date.now(),
                level: 'debug',
                message: '[CaptureManager] Offscreen document already exists'
            };
            await this.#saveLog(logEntry);
            return;
        }

        await this.#saveLog({
            timestamp: Date.now(),
            level: 'debug',
            message: '[CaptureManager] Checking for existing offscreen documents'
        });
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            const logEntry = {
                timestamp: Date.now(),
                level: 'debug',
                message: '[CaptureManager] Found existing offscreen document'
            };
            await this.#saveLog(logEntry);
            this.offscreenCreated = true;
            return;
        }

        const logEntry = {
            timestamp: Date.now(),
            level: 'debug',
            message: '[CaptureManager] Creating new offscreen document'
        };
        await this.#saveLog(logEntry);
        try {
            await chrome.offscreen.createDocument({
                url: 'offscreen/offscreen.html',
                reasons: ['DOM_PARSER'],
                justification: 'Image processing for screenshot capture'
            });
            const logEntry = {
                timestamp: Date.now(),
                level: 'debug',
                message: '[CaptureManager] Offscreen document created successfully'
            };
            await this.#saveLog(logEntry);
            this.offscreenCreated = true;
        } catch (error) {
            const logEntry = {
                timestamp: Date.now(),
                level: 'error',
                message: '[CaptureManager] Failed to create offscreen document',
                error: error.message
            };
            await this.#saveLog(logEntry);
            throw error;
        }
    }

    /**
     * 发送消息到offscreen document
     * @private
     */
    async #sendMessageToOffscreen(message) {
        await this.#ensureOffscreenDocument();
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!response || response.error) {
                    reject(new Error(response?.error || 'Unknown error'));
                } else {
                    resolve(response.result);
                }
            });
        });
    }

    /**
     * 捕获当前标签页的截图
     * @param {Object} options 截图选项
     * @param {boolean} options.fullPage 是否捕获整个页面
     * @param {Object} options.area 指定区域 {x, y, width, height}
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureTab(options = { fullPage: true }) {
        console.debug('[CaptureManager] Starting captureTab with options:', options);
        if (this.captureInProgress) {
            console.warn('[CaptureManager] Capture already in progress');
            throw new Error('已有截图任务正在进行中');
        }

        this.captureInProgress = true;
        console.debug('[CaptureManager] Capture flag set to true');

        try {
            console.debug('[CaptureManager] Querying active tab');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                console.error('[CaptureManager] No active tab found');
                throw new Error('无法获取当前标签页');
            }

            console.debug('[CaptureManager] Active tab found, id:', tab.id);
            let result;
            if (options.fullPage) {
                console.debug('[CaptureManager] Starting full page capture');
                result = await this.captureFullPage(tab.id);
            } else if (options.area) {
                console.debug('[CaptureManager] Starting area capture with area:', options.area);
                result = await this.captureArea(tab.id, options.area);
            } else {
                console.debug('[CaptureManager] Starting visible area capture');
                result = await this.captureVisibleArea(tab.id);
            }

            console.debug('[CaptureManager] Capture completed successfully');
            return result;
        } catch (error) {
            console.error('[CaptureManager] Capture failed:', error);
            throw error;
        } finally {
            this.captureInProgress = false;
            console.debug('[CaptureManager] Capture flag reset to false');
        }
    }

    /**
     * 捕获可见区域截图
     * @param {number} tabId 标签页ID
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureVisibleArea(tabId) {
        const initialLogEntry = {
            timestamp: Date.now(),
            level: 'debug',
            message: `[CaptureManager] Starting visible area capture for tab: ${tabId}`
        };
        await this.#saveLog(initialLogEntry);
        return new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    const errorLogEntry = {
                        timestamp: Date.now(),
                        level: 'error',
                        message: '[CaptureManager] Visible capture error',
                        error: chrome.runtime.lastError.message
                    };
                    this.#saveLog(errorLogEntry);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    const successLogEntry = {
                        timestamp: Date.now(),
                        level: 'debug',
                        message: '[CaptureManager] Visible capture completed'
                    };
                    this.#saveLog(successLogEntry);
                    resolve(dataUrl);
                }
            });
        });
    }

    /**
     * 捕获整个页面的截图（包括滚动部分）
     * @param {number} tabId 标签页ID
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureFullPage(tabId) {
        const logEntry = {
            timestamp: Date.now(),
            level: 'debug',
            message: `[CaptureManager] Starting full page capture for tab: ${tabId}`
        };
        await this.#saveLog(logEntry);

        // 注入内容脚本获取页面尺寸
        const dimensions = await this.getPageDimensions(tabId);

        // 原始滚动位置
        const originalScrollTop = await this.getScrollPosition(tabId);

        try {
            // 计算需要截取的次数
            const viewportHeight = dimensions.viewportHeight;
            const totalHeight = dimensions.height;
            const captureCount = Math.ceil(totalHeight / viewportHeight);

            // 存储每个部分的截图
            const captures = [];

            for (let i = 0; i < captureCount; i++) {
                // 设置滚动位置
                const scrollTop = i * viewportHeight;
                await this.setScrollPosition(tabId, scrollTop);

                // 等待页面渲染
                await new Promise(resolve => setTimeout(resolve, 100));

                // 捕获当前可见区域
                const dataUrl = await this.captureVisibleArea(tabId);

                // 计算当前部分在完整页面中的位置
                const y = Math.min(i * viewportHeight, totalHeight - viewportHeight);
                const height = viewportHeight;

                // 添加到截图数组
                captures.push({ dataUrl, y, height });
            }

            // 使用offscreen document处理图像合成
            return await this.#sendMessageToOffscreen({
                action: 'processFullPageCapture',
                data: { dimensions, captures }
            });
        } finally {
            // 恢复原始滚动位置
            await this.setScrollPosition(tabId, originalScrollTop);
        }
    }

    /**
     * 捕获指定区域的截图
     * @param {number} tabId 标签页ID
     * @param {Object} area 区域 {x, y, width, height}
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureArea(tabId, area) {
        const logEntry = {
            timestamp: Date.now(),
            level: 'debug',
            message: `[CaptureManager] Starting area capture for tab: ${tabId}, area: ${JSON.stringify(area)}`
        };
        await this.#saveLog(logEntry);

        // 确保区域在页面内
        const dimensions = await this.getPageDimensions(tabId);
        const validArea = {
            x: Math.max(0, area.x),
            y: Math.max(0, area.y),
            width: Math.min(area.width, dimensions.width - area.x),
            height: Math.min(area.height, dimensions.height - area.y)
        };

        // 原始滚动位置
        const originalScrollTop = await this.getScrollPosition(tabId);

        try {
            // 滚动到区域可见
            await this.setScrollPosition(tabId, validArea.y);

            // 等待页面渲染
            await new Promise(resolve => setTimeout(resolve, 100));

            // 捕获可见区域
            const fullDataUrl = await this.captureVisibleArea(tabId);

            // 获取当前滚动位置
            const currentScrollPosition = await this.getScrollPosition(tabId);

            // 使用offscreen document处理图像裁剪
            return await this.#sendMessageToOffscreen({
                action: 'processAreaCapture',
                data: {
                    fullDataUrl,
                    area: validArea,
                    scrollPosition: currentScrollPosition
                }
            });
        } finally {
            // 恢复原始滚动位置
            await this.setScrollPosition(tabId, originalScrollTop);
        }
    }

    /**
     * 获取页面尺寸信息
     * @param {number} tabId 标签页ID
     * @returns {Promise<Object>} 页面尺寸信息
     */
    async getPageDimensions(tabId) {
        const logEntry = {
            timestamp: Date.now(),
            level: 'debug',
            message: `[CaptureManager] Getting page dimensions for tab: ${tabId}`
        };
        await this.#saveLog(logEntry);

        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: { tabId },
                function: () => {
                    return {
                        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                        viewportWidth: window.innerWidth,
                        viewportHeight: window.innerHeight
                    };
                }
            }, (results) => {
                if (chrome.runtime.lastError) {
                    const logEntry = {
                        timestamp: Date.now(),
                        level: 'error',
                        message: '[CaptureManager] Failed to get page dimensions',
                        error: chrome.runtime.lastError.message
                    };
                    this.#saveLog(logEntry);
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!results || !results[0]) {
                    const logEntry = {
                        timestamp: Date.now(),
                        level: 'error',
                        message: '[CaptureManager] Failed to get page dimensions: no results'
                    };
                    this.#saveLog(logEntry);
                    reject(new Error('无法获取页面尺寸'));
                } else {
                    const logEntry = {
                        timestamp: Date.now(),
                        level: 'debug',
                        message: `[CaptureManager] Got page dimensions: ${JSON.stringify(results[0].result)}`
                    };
                    this.#saveLog(logEntry);
                    resolve(results[0].result);
                }
            });
        });
    }

    /**
     * 获取当前滚动位置
     * @param {number} tabId 标签页ID
     * @returns {Promise<number>} 滚动位置
     */
    async getScrollPosition(tabId) {
        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: { tabId },
                function: () => window.scrollY
            }, (results) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!results || !results[0]) {
                    reject(new Error('无法获取滚动位置'));
                } else {
                    resolve(results[0].result);
                }
            });
        });
    }

    /**
     * 设置滚动位置
     * @param {number} tabId 标签页ID
     * @param {number} scrollTop 滚动位置
     * @returns {Promise<void>}
     */
    async setScrollPosition(tabId, scrollTop) {
        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: { tabId },
                function: (scrollY) => {
                    window.scrollTo(0, scrollY);
                },
                args: [scrollTop]
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    }

    // 注意：loadImage方法已移至offscreen.js中，不再需要在这里实现

    /**
     * 保存截图到本地
     * @param {string} dataUrl 图片数据URL
     * @param {string} filename 文件名
     * @returns {Promise<void>}
     */
    async saveScreenshot(dataUrl, filename) {
        return new Promise((resolve, reject) => {
            // 将base64转换为blob
            const byteString = atob(dataUrl.split(',')[1]);
            const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);

            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            const blob = new Blob([ab], { type: mimeString });
            const url = URL.createObjectURL(blob);

            // 创建下载链接
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            a.click();

            // 清理
            setTimeout(() => {
                URL.revokeObjectURL(url);
                resolve();
            }, 100);
        });
    }
}

// 导出全局类定义和单例
self.CaptureManager = CaptureManager;
self.captureManager = new CaptureManager();
