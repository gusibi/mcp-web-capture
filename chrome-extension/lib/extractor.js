/**
 * 内容提取功能模块
 * 负责智能识别和提取网页主要内容区域
 */

(function (global) {
    class ContentExtractor {
        constructor() {
            this.extractionRules = [];
            this.loadCustomRules();
        }

        /**
         * 从存储中加载自定义提取规则
         */
        loadCustomRules() {
            chrome.storage.sync.get(['extractionRules'], (result) => {
                if (result.extractionRules && Array.isArray(result.extractionRules)) {
                    this.extractionRules = result.extractionRules;
                }
            });
        }

        /**
         * 提取当前页面的主要内容
         * @param {number} tabId 标签页ID
         * @param {Object} options 提取选项
         * @returns {Promise<Object>} 提取的内容
         */
        async extractContent(tabId, options = {}) {
            try {
                // 获取页面URL，用于匹配自定义规则
                const tab = await this.getTabInfo(tabId);
                const url = tab.url;

                // 检查是否有匹配的自定义规则
                const customRule = this.findMatchingRule(url);

                if (customRule) {
                    // 使用自定义规则提取内容
                    return await this.extractWithCustomRule(tabId, customRule);
                } else {
                    // 使用通用算法提取内容
                    return await this.extractWithGeneralAlgorithm(tabId, options);
                }
            } catch (error) {
                console.error('内容提取失败:', error);
                throw error;
            }
        }

        /**
         * 获取标签页信息
         * @param {number} tabId 标签页ID
         * @returns {Promise<Object>} 标签页信息
         */
        async getTabInfo(tabId) {
            return new Promise((resolve, reject) => {
                chrome.tabs.get(tabId, (tab) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(tab);
                    }
                });
            });
        }

        /**
         * 查找匹配URL的自定义规则
         * @param {string} url 页面URL
         * @returns {Object|null} 匹配的规则或null
         */
        findMatchingRule(url) {
            return this.extractionRules.find(rule => {
                try {
                    const pattern = new RegExp(rule.urlPattern);
                    return pattern.test(url);
                } catch (e) {
                    console.error('规则匹配错误:', e);
                    return false;
                }
            });
        }

        /**
         * 使用自定义规则提取内容
         * @param {number} tabId 标签页ID
         * @param {Object} rule 自定义规则
         * @returns {Promise<Object>} 提取的内容
         */
        async extractWithCustomRule(tabId, rule) {
            return new Promise((resolve, reject) => {
                chrome.scripting.executeScript({
                    target: { tabId },
                    function: (selectors) => {
                        const result = {};

                        // 遍历选择器并提取内容
                        for (const key in selectors) {
                            const selector = selectors[key];
                            const elements = document.querySelectorAll(selector);

                            if (elements.length > 0) {
                                if (elements.length === 1) {
                                    // 单个元素
                                    result[key] = elements[0].innerText.trim();
                                } else {
                                    // 多个元素
                                    result[key] = Array.from(elements).map(el => el.innerText.trim());
                                }
                            }
                        }

                        // 添加页面元数据
                        result.title = document.title;
                        result.url = window.location.href;

                        return result;
                    },
                    args: [rule.selectors]
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!results || !results[0]) {
                        reject(new Error('内容提取失败'));
                    } else {
                        resolve(results[0].result);
                    }
                });
            });
        }

        /**
         * 使用通用算法提取内容
         * @param {number} tabId 标签页ID
         * @param {Object} options 提取选项
         * @returns {Promise<Object>} 提取的内容
         */
        async extractWithGeneralAlgorithm(tabId, options) {
            return new Promise((resolve, reject) => {
                chrome.scripting.executeScript({
                    target: { tabId },
                    function: (opts) => {
                        // 通用内容提取算法
                        function findMainContent() {
                            // 候选元素评分
                            const candidates = [];

                            // 常见内容容器选择器
                            const contentSelectors = [
                                'article',
                                '.article',
                                '.post',
                                '.content',
                                '.main-content',
                                'main',
                                '#content',
                                '#main',
                                '.entry-content',
                                '.post-content'
                            ];

                            // 首先尝试常见内容选择器
                            for (const selector of contentSelectors) {
                                const elements = document.querySelectorAll(selector);
                                for (const el of elements) {
                                    // 忽略隐藏元素
                                    if (el.offsetParent === null) continue;

                                    // 计算文本密度和内容长度
                                    const textLength = el.innerText.trim().length;
                                    const childNodes = el.childNodes.length || 1;
                                    const textDensity = textLength / childNodes;

                                    // 评分因素：文本长度、文本密度、图片数量
                                    const images = el.querySelectorAll('img').length;
                                    const score = textLength * 0.5 + textDensity * 0.3 + images * 50;

                                    candidates.push({
                                        element: el,
                                        score: score,
                                        textLength: textLength
                                    });
                                }
                            }

                            // 如果没有找到候选元素，尝试分析所有段落
                            if (candidates.length === 0) {
                                // 获取所有段落
                                const paragraphs = document.querySelectorAll('p');

                                // 查找段落密集区域
                                const clusters = [];
                                let currentCluster = [];

                                for (const p of paragraphs) {
                                    // 忽略短文本和隐藏元素
                                    if (p.innerText.trim().length < 20 || p.offsetParent === null) continue;

                                    // 如果当前段落与上一个段落在同一区域，加入当前簇
                                    if (currentCluster.length > 0) {
                                        const lastP = currentCluster[currentCluster.length - 1];
                                        const lastRect = lastP.getBoundingClientRect();
                                        const currentRect = p.getBoundingClientRect();

                                        // 判断是否在同一区域（垂直距离较近）
                                        if (Math.abs(currentRect.top - lastRect.bottom) < 100) {
                                            currentCluster.push(p);
                                            continue;
                                        }
                                    }

                                    // 开始新簇
                                    if (currentCluster.length > 0) {
                                        clusters.push([...currentCluster]);
                                    }
                                    currentCluster = [p];
                                }

                                // 添加最后一个簇
                                if (currentCluster.length > 0) {
                                    clusters.push(currentCluster);
                                }

                                // 找出最大的簇
                                let maxCluster = null;
                                let maxLength = 0;

                                for (const cluster of clusters) {
                                    const totalLength = cluster.reduce((sum, p) => sum + p.innerText.trim().length, 0);
                                    if (totalLength > maxLength) {
                                        maxLength = totalLength;
                                        maxCluster = cluster;
                                    }
                                }

                                // 如果找到了最大簇，找到它们的共同父元素
                                if (maxCluster && maxCluster.length > 0) {
                                    const commonParent = findCommonParent(maxCluster);
                                    if (commonParent) {
                                        const textLength = commonParent.innerText.trim().length;
                                        const childNodes = commonParent.childNodes.length || 1;
                                        const textDensity = textLength / childNodes;
                                        const images = commonParent.querySelectorAll('img').length;
                                        const score = textLength * 0.5 + textDensity * 0.3 + images * 50;

                                        candidates.push({
                                            element: commonParent,
                                            score: score,
                                            textLength: textLength
                                        });
                                    }
                                }
                            }

                            // 查找共同父元素
                            function findCommonParent(elements) {
                                if (!elements || elements.length === 0) return null;
                                if (elements.length === 1) return elements[0].parentElement;

                                // 获取第一个元素的所有父元素
                                const parents = [];
                                let parent = elements[0].parentElement;

                                while (parent) {
                                    parents.push(parent);
                                    parent = parent.parentElement;
                                }

                                // 检查其他元素是否共享这些父元素
                                for (let i = 1; i < elements.length; i++) {
                                    let currentParent = elements[i].parentElement;
                                    let found = false;

                                    while (currentParent && !found) {
                                        if (parents.includes(currentParent)) {
                                            found = true;
                                            // 保留共同父元素及其上层
                                            const index = parents.indexOf(currentParent);
                                            parents.splice(0, index);
                                        } else {
                                            currentParent = currentParent.parentElement;
                                        }
                                    }

                                    if (!found) return null;
                                }

                                return parents[0];
                            }

                            // 按分数排序并返回最高分的元素
                            candidates.sort((a, b) => b.score - a.score);
                            return candidates.length > 0 ? candidates[0].element : null;
                        }

                        // 获取meta标签内容
                        function getMetaContent(name) {
                            const meta = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"], meta[property="twitter:${name}"]`);
                            return meta ? meta.content : null;
                        }

                        // 提取主要内容
                        const mainElement = findMainContent();

                        if (!mainElement) {
                            return {
                                title: getMetaContent('title') || document.title,
                                description: getMetaContent('description'),
                                url: window.location.href,
                                content: document.body.innerText.substring(0, 1000) + '...',
                                error: '无法识别主要内容区域'
                            };
                        }

                        // 提取图片
                        const images = Array.from(mainElement.querySelectorAll('img'))
                            .filter(img => {
                                // 过滤掉小图标和装饰图片
                                const width = img.naturalWidth || img.width;
                                const height = img.naturalHeight || img.height;
                                return width > 100 && height > 100;
                            })
                            .map(img => ({
                                src: img.src,
                                alt: img.alt,
                                width: img.naturalWidth || img.width,
                                height: img.naturalHeight || img.height
                            }));

                        // 提取链接
                        const links = Array.from(mainElement.querySelectorAll('a'))
                            .filter(a => a.href && a.innerText.trim().length > 0)
                            .map(a => ({
                                href: a.href,
                                text: a.innerText.trim()
                            }));

                        // 返回结构化内容
                        return {
                            title: getMetaContent('title') || document.title,
                            description: getMetaContent('description'),
                            url: window.location.href,
                            content: mainElement.innerText,
                            html: mainElement.innerHTML,
                            images: images,
                            links: links,
                            textLength: mainElement.innerText.length
                        };
                    },
                    args: [options]
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!results || !results[0]) {
                        reject(new Error('内容提取失败'));
                    } else {
                        resolve(results[0].result);
                    }
                });
            });
        }

        /**
         * 添加自定义提取规则
         * @param {Object} rule 规则对象
         * @returns {Promise<boolean>} 是否成功
         */
        async addCustomRule(rule) {
            // 验证规则格式
            if (!rule.name || !rule.urlPattern || !rule.selectors) {
                throw new Error('规则格式无效');
            }

            // 检查URL模式是否有效
            try {
                new RegExp(rule.urlPattern);
            } catch (e) {
                throw new Error('URL模式无效: ' + e.message);
            }

            // 添加规则
            this.extractionRules.push(rule);

            // 保存到存储
            return new Promise((resolve, reject) => {
                chrome.storage.sync.set({ extractionRules: this.extractionRules }, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(true);
                    }
                });
            });
        }

        /**
         * 删除自定义提取规则
         * @param {string} ruleName 规则名称
         * @returns {Promise<boolean>} 是否成功
         */
        async removeCustomRule(ruleName) {
            const initialLength = this.extractionRules.length;
            this.extractionRules = this.extractionRules.filter(rule => rule.name !== ruleName);

            // 如果没有变化，说明规则不存在
            if (initialLength === this.extractionRules.length) {
                return false;
            }

            // 保存到存储
            return new Promise((resolve, reject) => {
                chrome.storage.sync.set({ extractionRules: this.extractionRules }, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(true);
                    }
                });
            });
        }

        /**
         * 获取所有自定义提取规则
         * @returns {Array} 规则列表
         */
        getCustomRules() {
            return [...this.extractionRules];
        }
    }

    // 创建单例实例并导出到全局作用域
    global.contentExtractor = new ContentExtractor();
    global.ContentExtractor = ContentExtractor;
})(self);
