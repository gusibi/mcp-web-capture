/**
 * 网页截图功能模块
 * 负责实现网页截图功能，支持全页面或指定区域截图
 */

class CaptureManager {
    constructor() {
        this.captureInProgress = false;
        this.offscreenCreated = false;
        this.logger = self.logger;
    }

    /**
     * 创建或获取offscreen document
     * @private
     */
    async #ensureOffscreenDocument() {
        if (this.offscreenCreated) {
            this.logger.log('CaptureManager', 'info', 'Offscreen document already exists');
            return;
        }

        this.logger.log('CaptureManager', 'info', 'Checking for existing offscreen documents');
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            this.logger.log('CaptureManager', 'info', 'Found existing offscreen document');
            this.offscreenCreated = true;
            return;
        }

        this.logger.log('CaptureManager', 'info', 'Creating new offscreen document');
        try {
            await chrome.offscreen.createDocument({
                url: 'offscreen/offscreen.html',
                reasons: ['DOM_PARSER'],
                justification: 'Image processing for screenshot capture'
            });
            this.logger.log('CaptureManager', 'info', 'Offscreen document created successfully');
            this.offscreenCreated = true;
        } catch (error) {
            this.logger.log('CaptureManager', 'error', 'Failed to create offscreen document', error);
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
    async captureTab(options) {
        logger.log('capture', 'info', '开始处理截图', { options });
        if (this.captureInProgress) {
            logger.log('capture', 'warn', '已有截图任务正在进行中');
            throw new Error('已有截图任务正在进行中');
        }

        this.captureInProgress = true;
        logger.log('capture', 'info', '设置截图标志为true');

        try {
            logger.log('capture', 'info', '查询当前活动标签页');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                logger.log('capture', 'error', '无法获取当前标签页');
                throw new Error('无法获取当前标签页');
            }

            logger.log('capture', 'info', `找到活动标签页，id: ${tab.id}`);
            let result;
            if (options.fullPage) {
                logger.log('capture', 'info', '开始全页面截图');
                result = await this.captureFullPage(tab.id);
            } else if (options.area) {
                logger.log('capture', 'info', '开始区域截图', { area: options.area });
                result = await this.captureArea(tab.id, options.area);
            } else {
                logger.log('capture', 'info', '开始可见区域截图');
                // 确保滚动到页面顶部
                await this.setScrollPosition(tab.id, 0);
                // 添加短暂延迟以确保页面渲染完成
                await new Promise(resolve => setTimeout(resolve, 100));
                result = await this.captureVisibleArea(tab.id);
            }

            logger.log('capture', 'info', '截图完成');
            return result;
        } catch (error) {
            logger.log('capture', 'error', '截图失败', { error: error.message });
            throw error;
        } finally {
            this.captureInProgress = false;
            logger.log('capture', 'info', '重置截图标志为false');
        }
    }

    /**
     * 捕获可见区域截图
     * @param {number} tabId 标签页ID
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureVisibleArea(tabId) {
        this.logger.log('CaptureManager', 'info', `Starting visible area capture for tab: ${tabId}`);
        const maxRetries = 3;
        const baseDelay = 1000; // 基础延迟1秒

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 如果不是第一次尝试，添加延迟
                if (attempt > 0) {
                    const delay = baseDelay * Math.pow(2, attempt - 1); // 指数退避策略
                    this.logger.log('CaptureManager', 'info', `Retrying capture after ${delay}ms delay (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const result = await new Promise((resolve, reject) => {
                    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(dataUrl);
                        }
                    });
                });

                this.logger.log('CaptureManager', 'info', 'Visible capture completed successfully');
                return result;
            } catch (error) {
                this.logger.log('CaptureManager', 'warn', `Capture attempt ${attempt + 1} failed:`, error.message);
                if (attempt === maxRetries - 1) {
                    this.logger.log('CaptureManager', 'error', 'All capture attempts failed');
                    throw new Error(`截图失败，已重试${maxRetries}次：${error.message}`);
                }
            }
        }
    }

    /**
     * 捕获整个页面的截图（包括滚动部分）
     * @param {number} tabId 标签页ID
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureFullPage(tabId) {
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

                // 等待页面渲染和API冷却
                await new Promise(resolve => setTimeout(resolve, 1000));

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
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!results || !results[0]) {
                    reject(new Error('无法获取页面尺寸'));
                } else {
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
