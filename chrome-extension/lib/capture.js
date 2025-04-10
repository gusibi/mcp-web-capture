/**
 * 网页截图功能模块
 * 负责实现网页截图功能，支持全页面或指定区域截图
 */

class CaptureManager {
    constructor() {
        this.captureInProgress = false;
    }

    /**
     * 捕获当前标签页的截图
     * @param {Object} options 截图选项
     * @param {boolean} options.fullPage 是否捕获整个页面
     * @param {Object} options.area 指定区域 {x, y, width, height}
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureTab(options = { fullPage: true }) {
        if (this.captureInProgress) {
            throw new Error('已有截图任务正在进行中');
        }

        this.captureInProgress = true;

        try {
            // 获取当前活动标签页
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('无法获取当前标签页');
            }

            if (options.fullPage) {
                return await this.captureFullPage(tab.id);
            } else if (options.area) {
                return await this.captureArea(tab.id, options.area);
            } else {
                return await this.captureVisibleArea(tab.id);
            }
        } catch (error) {
            console.error('截图失败:', error);
            throw error;
        } finally {
            this.captureInProgress = false;
        }
    }

    /**
     * 捕获可见区域截图
     * @param {number} tabId 标签页ID
     * @returns {Promise<string>} 返回base64编码的图片数据
     */
    async captureVisibleArea(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
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
        // 注入内容脚本获取页面尺寸
        const dimensions = await this.getPageDimensions(tabId);

        // 创建一个画布来合成完整页面截图
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;

        // 原始滚动位置
        const originalScrollTop = await this.getScrollPosition(tabId);

        try {
            // 计算需要截取的次数
            const viewportHeight = dimensions.viewportHeight;
            const totalHeight = dimensions.height;
            const captureCount = Math.ceil(totalHeight / viewportHeight);

            for (let i = 0; i < captureCount; i++) {
                // 设置滚动位置
                const scrollTop = i * viewportHeight;
                await this.setScrollPosition(tabId, scrollTop);

                // 等待页面渲染
                await new Promise(resolve => setTimeout(resolve, 100));

                // 捕获当前可见区域
                const dataUrl = await this.captureVisibleArea(tabId);

                // 将截图绘制到画布上
                const img = await this.loadImage(dataUrl);
                const y = Math.min(i * viewportHeight, totalHeight - viewportHeight);
                ctx.drawImage(img, 0, y, dimensions.width, viewportHeight);
            }

            // 返回完整页面的截图
            return canvas.toDataURL('image/png');
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

            // 裁剪指定区域
            const img = await this.loadImage(fullDataUrl);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = validArea.width;
            canvas.height = validArea.height;

            // 计算相对于可视区域的坐标
            const relativeY = validArea.y - await this.getScrollPosition(tabId);
            ctx.drawImage(img, validArea.x, relativeY, validArea.width, validArea.height, 0, 0, validArea.width, validArea.height);

            return canvas.toDataURL('image/png');
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

    /**
     * 加载图片
     * @param {string} dataUrl 图片数据URL
     * @returns {Promise<HTMLImageElement>} 图片元素
     */
    loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('加载图片失败'));
            img.src = dataUrl;
        });
    }

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
