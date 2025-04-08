/**
 * 内容脚本
 * 在网页中执行，负责处理页面内容、截图和提取操作
 */

// 内容脚本全局状态
const state = {
    capturing: false,
    extracting: false,
    highlightElements: null
};

// 初始化内容脚本
function init() {
    console.log('MCP内容脚本已加载');

    // 监听来自后台脚本的消息
    chrome.runtime.onMessage.addListener(handleMessage);

    // 创建样式元素
    createStyleElement();
}

// 处理消息
function handleMessage(message, sender, sendResponse) {
    console.log('内容脚本收到消息:', message);

    switch (message.action) {
        case 'captureFullPage':
            captureFullPage(sendResponse);
            return true; // 异步响应

        case 'captureVisibleArea':
            captureVisibleArea(sendResponse);
            return true; // 异步响应

        case 'captureArea':
            captureArea(message.area, sendResponse);
            return true; // 异步响应

        case 'extractContent':
            extractContent(message.options, sendResponse);
            return true; // 异步响应

        case 'highlightElement':
            highlightElement(message.selector, sendResponse);
            return true; // 异步响应

        case 'clearHighlights':
            clearHighlights(sendResponse);
            return true; // 异步响应

        default:
            sendResponse({ success: false, error: '未知操作' });
    }
}

// 创建样式元素
function createStyleElement() {
    const style = document.createElement('style');
    style.id = 'mcp-content-styles';
    style.textContent = `
        .mcp-highlight {
            outline: 2px solid #ff5722 !important;
            background-color: rgba(255, 87, 34, 0.1) !important;
            transition: all 0.3s ease !important;
        }
        
        .mcp-capture-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999999;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        
        .mcp-capture-message {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            font-family: Arial, sans-serif;
            font-size: 16px;
            color: #333;
        }
        
        .mcp-selection-area {
            position: absolute;
            border: 2px dashed #2196F3;
            background-color: rgba(33, 150, 243, 0.1);
            z-index: 999998;
            cursor: crosshair;
        }
    `;
    document.head.appendChild(style);
}

// 捕获整个页面
async function captureFullPage(sendResponse) {
    try {
        if (state.capturing) {
            throw new Error('已有截图任务正在进行中');
        }

        state.capturing = true;
        showCaptureOverlay('正在截取整个页面...');

        // 获取页面完整高度
        const scrollHeight = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
        );

        // 获取页面完整宽度
        const scrollWidth = Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth
        );

        // 获取当前滚动位置
        const originalScrollTop = window.scrollY;
        const originalScrollLeft = window.scrollX;

        // 创建一个画布来合并所有截图
        const canvas = document.createElement('canvas');
        canvas.width = scrollWidth;
        canvas.height = scrollHeight;
        const ctx = canvas.getContext('2d');

        // 视口高度和宽度
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        // 计算需要滚动的次数
        const verticalScrolls = Math.ceil(scrollHeight / viewportHeight);
        const horizontalScrolls = Math.ceil(scrollWidth / viewportWidth);

        // 逐块截图并合并
        for (let y = 0; y < verticalScrolls; y++) {
            for (let x = 0; x < horizontalScrolls; x++) {
                // 滚动到指定位置
                const scrollTop = y * viewportHeight;
                const scrollLeft = x * viewportWidth;
                window.scrollTo(scrollLeft, scrollTop);

                // 等待重绘
                await new Promise(resolve => setTimeout(resolve, 100));

                // 截取当前可见区域
                const dataUrl = await captureVisibleAreaInternal();

                // 将截图绘制到画布上
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = dataUrl;
                });

                ctx.drawImage(
                    img,
                    0, 0, viewportWidth, viewportHeight,
                    scrollLeft, scrollTop, viewportWidth, viewportHeight
                );
            }
        }

        // 恢复原始滚动位置
        window.scrollTo(originalScrollLeft, originalScrollTop);

        // 转换为数据URL
        const fullPageDataUrl = canvas.toDataURL('image/png');

        hideCaptureOverlay();
        state.capturing = false;

        sendResponse({ success: true, dataUrl: fullPageDataUrl });
    } catch (error) {
        hideCaptureOverlay();
        state.capturing = false;
        console.error('全页面截图失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 捕获可见区域
async function captureVisibleArea(sendResponse) {
    try {
        if (state.capturing) {
            throw new Error('已有截图任务正在进行中');
        }

        state.capturing = true;
        showCaptureOverlay('正在截取可见区域...');

        const dataUrl = await captureVisibleAreaInternal();

        hideCaptureOverlay();
        state.capturing = false;

        sendResponse({ success: true, dataUrl });
    } catch (error) {
        hideCaptureOverlay();
        state.capturing = false;
        console.error('可见区域截图失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 内部函数：捕获可见区域
async function captureVisibleAreaInternal() {
    return new Promise((resolve, reject) => {
        try {
            // 使用chrome.runtime.sendMessage请求后台脚本执行截图
            chrome.runtime.sendMessage(
                { action: 'captureVisibleTab' },
                response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!response || !response.success) {
                        reject(new Error(response?.error || '截图失败'));
                    } else {
                        resolve(response.dataUrl);
                    }
                }
            );
        } catch (error) {
            reject(error);
        }
    });
}

// 捕获指定区域
async function captureArea(area, sendResponse) {
    try {
        if (state.capturing) {
            throw new Error('已有截图任务正在进行中');
        }

        if (!area || typeof area !== 'object' || !area.x || !area.y || !area.width || !area.height) {
            throw new Error('无效的区域参数');
        }

        state.capturing = true;
        showCaptureOverlay('正在截取指定区域...');

        // 获取当前滚动位置
        const originalScrollTop = window.scrollY;
        const originalScrollLeft = window.scrollX;

        // 滚动到区域可见
        window.scrollTo(area.x, area.y);

        // 等待重绘
        await new Promise(resolve => setTimeout(resolve, 100));

        // 截取可见区域
        const visibleDataUrl = await captureVisibleAreaInternal();

        // 创建一个画布来裁剪区域
        const canvas = document.createElement('canvas');
        canvas.width = area.width;
        canvas.height = area.height;
        const ctx = canvas.getContext('2d');

        // 将截图绘制到画布上并裁剪
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = visibleDataUrl;
        });

        // 计算相对于可见区域的坐标
        const relativeX = area.x - window.scrollX;
        const relativeY = area.y - window.scrollY;

        ctx.drawImage(
            img,
            relativeX, relativeY, area.width, area.height,
            0, 0, area.width, area.height
        );

        // 恢复原始滚动位置
        window.scrollTo(originalScrollLeft, originalScrollTop);

        // 转换为数据URL
        const areaDataUrl = canvas.toDataURL('image/png');

        hideCaptureOverlay();
        state.capturing = false;

        sendResponse({ success: true, dataUrl: areaDataUrl });
    } catch (error) {
        hideCaptureOverlay();
        state.capturing = false;
        console.error('区域截图失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 提取内容
async function extractContent(options = {}, sendResponse) {
    try {
        if (state.extracting) {
            throw new Error('已有内容提取任务正在进行中');
        }

        state.extracting = true;
        showCaptureOverlay('正在提取页面内容...');

        // 默认选项
        const defaultOptions = {
            extractImages: true,
            extractLinks: true,
            customSelectors: null
        };

        const extractOptions = { ...defaultOptions, ...options };

        // 提取页面基本信息
        const pageInfo = {
            url: window.location.href,
            title: document.title,
            description: getMetaContent('description'),
            keywords: getMetaContent('keywords'),
            author: getMetaContent('author'),
            favicon: getFaviconUrl()
        };

        // 提取主要内容
        const mainContent = extractMainContent();

        // 提取图片（如果启用）
        const images = extractOptions.extractImages ? extractImages() : [];

        // 提取链接（如果启用）
        const links = extractOptions.extractLinks ? extractLinks() : [];

        // 提取自定义选择器内容
        const customContent = {};
        if (extractOptions.customSelectors && typeof extractOptions.customSelectors === 'object') {
            for (const [key, selector] of Object.entries(extractOptions.customSelectors)) {
                customContent[key] = extractElementContent(selector);
            }
        }

        // 组合结果
        const result = {
            pageInfo,
            mainContent,
            images,
            links,
            customContent
        };

        hideCaptureOverlay();
        state.extracting = false;

        sendResponse({ success: true, result });
    } catch (error) {
        hideCaptureOverlay();
        state.extracting = false;
        console.error('内容提取失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 获取Meta标签内容
function getMetaContent(name) {
    const meta = document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[property="og:${name}"]`);
    return meta ? meta.getAttribute('content') : '';
}

// 获取网站图标URL
function getFaviconUrl() {
    const linkIcon = document.querySelector('link[rel="shortcut icon"]') ||
        document.querySelector('link[rel="icon"]');
    if (linkIcon) {
        return new URL(linkIcon.href, window.location.href).href;
    }
    return new URL('/favicon.ico', window.location.href).href;
}

// 提取主要内容
function extractMainContent() {
    // 尝试识别主要内容区域
    const contentSelectors = [
        'article',
        'main',
        '.content',
        '#content',
        '.article',
        '#article',
        '.post',
        '#post',
        '.main',
        '.main-content'
    ];

    let mainElement = null;

    // 尝试使用选择器找到主要内容
    for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && isVisibleElement(element) && hasSubstantialContent(element)) {
            mainElement = element;
            break;
        }
    }

    // 如果没有找到明确的主要内容，使用启发式方法
    if (!mainElement) {
        mainElement = findContentByHeuristics();
    }

    // 如果仍然没有找到，使用body
    if (!mainElement) {
        mainElement = document.body;
    }

    // 提取内容
    return {
        text: cleanText(mainElement.innerText),
        html: mainElement.innerHTML,
        textContent: mainElement.textContent.trim()
    };
}

// 使用启发式方法查找内容
function findContentByHeuristics() {
    // 获取所有可能的内容块
    const contentBlocks = Array.from(document.querySelectorAll('div, section, article'));

    // 按内容量排序
    const sortedBlocks = contentBlocks
        .filter(el => isVisibleElement(el) && hasSubstantialContent(el))
        .sort((a, b) => {
            // 计算文本密度（文本长度/HTML长度）
            const aDensity = a.textContent.length / a.innerHTML.length;
            const bDensity = b.textContent.length / b.innerHTML.length;

            // 计算段落数量
            const aParagraphs = a.querySelectorAll('p').length;
            const bParagraphs = b.querySelectorAll('p').length;

            // 综合评分
            const aScore = a.textContent.length * aDensity * (aParagraphs + 1);
            const bScore = b.textContent.length * bDensity * (bParagraphs + 1);

            return bScore - aScore;
        });

    return sortedBlocks.length > 0 ? sortedBlocks[0] : null;
}

// 检查元素是否可见
function isVisibleElement(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0;
}

// 检查元素是否有实质性内容
function hasSubstantialContent(element) {
    const text = element.textContent.trim();
    return text.length > 100 && element.querySelectorAll('p, h1, h2, h3, h4, h5, h6').length > 0;
}

// 清理文本
function cleanText(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim();
}

// 提取图片
function extractImages() {
    const images = [];
    const imgElements = document.querySelectorAll('img');

    imgElements.forEach(img => {
        if (isVisibleElement(img) && img.src && img.src.trim() !== '') {
            const rect = img.getBoundingClientRect();

            // 只收集足够大的图片
            if (rect.width >= 100 && rect.height >= 100) {
                images.push({
                    src: img.src,
                    alt: img.alt || '',
                    width: rect.width,
                    height: rect.height,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight
                });
            }
        }
    });

    return images;
}

// 提取链接
function extractLinks() {
    const links = [];
    const linkElements = document.querySelectorAll('a');

    linkElements.forEach(link => {
        if (isVisibleElement(link) && link.href && link.href.trim() !== '') {
            links.push({
                href: link.href,
                text: link.textContent.trim(),
                title: link.title || '',
                isExternal: link.hostname !== window.location.hostname
            });
        }
    });

    return links;
}

// 提取元素内容
function extractElementContent(selector) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            return null;
        }

        return {
            text: element.textContent.trim(),
            html: element.innerHTML,
            exists: true
        };
    } catch (error) {
        console.error(`提取选择器 ${selector} 内容失败:`, error);
        return {
            exists: false,
            error: error.message
        };
    }
}

// 高亮元素
function highlightElement(selector, sendResponse) {
    try {
        // 清除之前的高亮
        clearHighlights();

        // 查找元素
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) {
            throw new Error(`未找到匹配选择器 ${selector} 的元素`);
        }

        // 高亮元素
        state.highlightElements = [];
        elements.forEach(element => {
            element.classList.add('mcp-highlight');
            state.highlightElements.push(element);

            // 滚动到第一个元素
            if (state.highlightElements.length === 1) {
                element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        });

        sendResponse({
            success: true,
            count: elements.length,
            message: `已高亮 ${elements.length} 个元素`
        });
    } catch (error) {
        console.error('高亮元素失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 清除高亮
function clearHighlights(sendResponse) {
    try {
        if (state.highlightElements) {
            state.highlightElements.forEach(element => {
                if (element && element.classList) {
                    element.classList.remove('mcp-highlight');
                }
            });
            state.highlightElements = null;
        }

        if (sendResponse) {
            sendResponse({ success: true });
        }
    } catch (error) {
        console.error('清除高亮失败:', error);
        if (sendResponse) {
            sendResponse({ success: false, error: error.message });
        }
    }
}

// 显示截图覆盖层
function showCaptureOverlay(message) {
    const overlay = document.createElement('div');
    overlay.className = 'mcp-capture-overlay';
    overlay.id = 'mcp-capture-overlay';

    const messageElement = document.createElement('div');
    messageElement.className = 'mcp-capture-message';
    messageElement.textContent = message || '正在处理...';

    overlay.appendChild(messageElement);
    document.body.appendChild(overlay);
}

// 隐藏截图覆盖层
function hideCaptureOverlay() {
    const overlay = document.getElementById('mcp-capture-overlay');
    if (overlay) {
        overlay.remove();
    }
}

// 初始化内容脚本
init();