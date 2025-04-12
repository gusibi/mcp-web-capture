/**
 * Offscreen文档脚本
 * 用于处理需要DOM操作的截图功能
 */

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
        sendResponse({ error: '无效的消息格式' });
        return true;
    }

    // 根据消息类型处理不同的操作
    switch (message.action) {
        case 'processFullPageCapture':
            processFullPageCapture(message.data)
                .then(result => sendResponse({ result }))
                .catch(error => sendResponse({ error: error.message }));
            return true;

        case 'processAreaCapture':
            processAreaCapture(message.data)
                .then(result => sendResponse({ result }))
                .catch(error => sendResponse({ error: error.message }));
            return true;

        default:
            sendResponse({ error: '未知操作: ' + message.action });
            return true;
    }
});

/**
 * 处理全页面截图
 * @param {Object} data 包含截图数据和尺寸信息
 * @returns {Promise<string>} 返回处理后的base64图片数据
 */
async function processFullPageCapture(data) {
    if (!data || !data.dimensions || !data.captures) {
        throw new Error('缺少必要的截图数据');
    }

    const { dimensions, captures } = data;

    // 创建画布
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // 处理每个部分的截图
    for (let i = 0; i < captures.length; i++) {
        const capture = captures[i];
        const img = await loadImage(capture.dataUrl);
        ctx.drawImage(img, 0, capture.y, dimensions.width, capture.height);
    }

    // 返回合成后的图片
    return canvas.toDataURL('image/png');
}

/**
 * 处理区域截图
 * @param {Object} data 包含截图数据和区域信息
 * @returns {Promise<string>} 返回处理后的base64图片数据
 */
async function processAreaCapture(data) {
    if (!data || !data.fullDataUrl || !data.area) {
        throw new Error('缺少必要的截图数据');
    }

    const { fullDataUrl, area, scrollPosition } = data;

    // 创建画布
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = area.width;
    canvas.height = area.height;

    // 加载并裁剪图片
    const img = await loadImage(fullDataUrl);
    const relativeY = area.y - scrollPosition;
    ctx.drawImage(img, area.x, relativeY, area.width, area.height, 0, 0, area.width, area.height);

    // 返回裁剪后的图片
    return canvas.toDataURL('image/png');
}

/**
 * 加载图片
 * @param {string} dataUrl 图片数据URL
 * @returns {Promise<HTMLImageElement>} 图片元素
 */
function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('加载图片失败'));
        img.src = dataUrl;
    });
}