/**
 * 选项页面脚本
 * 负责处理设置页面的用户交互和数据管理
 */

// DOM 元素
const serverUrlInput = document.getElementById('serverUrl');
const apiKeyInput = document.getElementById('apiKey');
const autoConnectCheckbox = document.getElementById('autoConnect');
const fullPageCapture = document.getElementById('fullPageCapture');
const imageFormatSelect = document.getElementById('imageFormat');
const imageQualityInput = document.getElementById('imageQuality');
const qualityValueSpan = document.getElementById('qualityValue');
const extractImagesCheckbox = document.getElementById('extractImages');
const extractLinksCheckbox = document.getElementById('extractLinks');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const saveNotification = document.getElementById('saveNotification');
const manageRulesBtn = document.getElementById('manageRulesBtn');

// 规则管理对话框元素
const rulesDialog = document.getElementById('rulesDialog');
const closeDialogBtn = document.getElementById('closeDialogBtn');
const rulesList = document.getElementById('rulesList');
const addRuleBtn = document.getElementById('addRuleBtn');
const ruleForm = document.getElementById('ruleForm');
const ruleFormTitle = document.getElementById('ruleFormTitle');
const ruleNameInput = document.getElementById('ruleName');
const urlPatternInput = document.getElementById('urlPattern');
const selectorInputs = document.getElementById('selectorInputs');
const addSelectorBtn = document.getElementById('addSelectorBtn');
const saveRuleBtn = document.getElementById('saveRuleBtn');
const cancelRuleBtn = document.getElementById('cancelRuleBtn');

// 当前编辑的规则
let currentEditRule = null;

// 初始化选项页面
function initOptions() {
    // 加载保存的设置
    loadSettings();

    // 设置事件监听器
    setupEventListeners();

    // 更新质量值显示
    updateQualityValue();
}

// 初始化选项页面
document.addEventListener('DOMContentLoaded', initOptions);

// 加载保存的设置
function loadSettings() {
    chrome.storage.sync.get([
        'serverUrl',
        'apiKey',
        'autoConnect',
        'imageFormat',
        'imageQuality',
        'extractImages',
        'extractLinks',
        'fullPageCapture'
    ], (result) => {
        // 设置服务器URL - 无论是否为空字符串都设置值
        serverUrlInput.value = result.serverUrl || '';

        // 设置API密钥 - 无论是否为空字符串都设置值
        apiKeyInput.value = result.apiKey || '';

        // 设置自动连接
        autoConnectCheckbox.checked = result.autoConnect === true;

        // 设置图片格式
        if (result.imageFormat) {
            imageFormatSelect.value = result.imageFormat;
        }

        // 设置图片质量
        if (result.imageQuality) {
            imageQualityInput.value = result.imageQuality;
            updateQualityValue();
        }

        // 设置提取选项
        extractImagesCheckbox.checked = result.extractImages !== false;
        extractLinksCheckbox.checked = result.extractLinks !== false;

        // 设置全屏截图选项
        fullPageCapture.checked = result.fullPageCapture !== false;
    });
}

// 设置事件监听器
function setupEventListeners() {
    // 保存按钮
    saveBtn.addEventListener('click', saveSettings);

    // 重置按钮
    resetBtn.addEventListener('click', resetSettings);

    // 图片质量滑块
    imageQualityInput.addEventListener('input', updateQualityValue);

    // 管理规则按钮
    manageRulesBtn.addEventListener('click', openRulesDialog);

    // 关闭对话框按钮
    closeDialogBtn.addEventListener('click', closeRulesDialog);

    // 添加规则按钮
    addRuleBtn.addEventListener('click', () => {
        showRuleForm();
    });

    // 添加选择器按钮
    addSelectorBtn.addEventListener('click', addSelectorField);

    // 保存规则按钮
    saveRuleBtn.addEventListener('click', saveRule);

    // 取消规则按钮
    cancelRuleBtn.addEventListener('click', hideRuleForm);
}

// 更新质量值显示
function updateQualityValue() {
    qualityValueSpan.textContent = imageQualityInput.value;
}

// 保存设置
async function saveSettings() {
    try {
        // 验证服务器URL
        if (serverUrlInput.value && !isValidUrl(serverUrlInput.value)) {
            throw new Error('请输入有效的服务器URL');
        }

        // 保存设置到存储
        await new Promise((resolve, reject) => {
            // 即使字段为空也会保存，确保覆盖旧值
            console.log('saving settings',
                {
                    serverUrl: serverUrlInput.value, // 即使为空字符串也会保存
                    apiKey: apiKeyInput.value, // 即使为空字符串也会保存
                    autoConnect: autoConnectCheckbox.checked,
                    imageFormat: imageFormatSelect.value,
                    imageQuality: parseInt(imageQualityInput.value),
                    extractImages: extractImagesCheckbox.checked,
                    extractLinks: extractLinksCheckbox.checked,
                    fullPageCapture: fullPageCapture.checked
                })
            chrome.storage.sync.set({
                serverUrl: serverUrlInput.value, // 即使为空字符串也会保存
                apiKey: apiKeyInput.value, // 即使为空字符串也会保存
                autoConnect: autoConnectCheckbox.checked,
                imageFormat: imageFormatSelect.value,
                imageQuality: parseInt(imageQualityInput.value),
                extractImages: extractImagesCheckbox.checked,
                extractLinks: extractLinksCheckbox.checked,
                fullPageCapture: fullPageCapture.checked
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });

        // 通知后台脚本设置已更新
        chrome.runtime.sendMessage({ action: 'settings_updated' });

        // 显示保存成功通知
        showNotification('设置已保存');
    } catch (error) {
        showNotification(`保存失败: ${error.message}`, true);
    }
}

// 重置设置
function resetSettings() {
    // 确认重置
    if (!confirm('确定要重置所有设置吗？这将恢复默认设置。')) {
        return;
    }

    // 重置输入字段
    serverUrlInput.value = '';
    apiKeyInput.value = '';
    autoConnectCheckbox.checked = false;
    imageFormatSelect.value = 'png';
    imageQualityInput.value = 90;

    extractImagesCheckbox.checked = true;
    extractLinksCheckbox.checked = true;

    // 更新质量值显示
    updateQualityValue();

    // 完全清除存储中的所有设置
    chrome.storage.sync.clear(() => {
        // 保存默认设置
        saveSettings();

        // 通知后台脚本设置已重置
        chrome.runtime.sendMessage({ action: 'settings_updated' });

        // 显示重置成功通知
        showNotification('设置已重置为默认值');
    });
}

// 显示通知
function showNotification(message, isError = false) {
    saveNotification.textContent = message;
    saveNotification.className = isError ? 'notification error' : 'notification success';
    saveNotification.style.display = 'block';

    // 3秒后隐藏通知
    setTimeout(() => {
        saveNotification.style.display = 'none';
    }, 3000);
}

// 验证URL
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

// 打开规则管理对话框
function openRulesDialog() {
    // 加载规则列表
    loadRulesList();

    // 显示对话框
    rulesDialog.style.display = 'block';
}

// 关闭规则管理对话框
function closeRulesDialog() {
    rulesDialog.style.display = 'none';
    hideRuleForm();
}

// 显示规则表单
function showRuleForm(rule = null) {
    // 设置当前编辑的规则
    currentEditRule = rule;

    // 设置表单标题
    ruleFormTitle.textContent = rule ? '编辑提取规则' : '添加提取规则';

    // 清空表单
    ruleNameInput.value = '';
    urlPatternInput.value = '';
    selectorInputs.innerHTML = '';

    // 如果是编辑，填充表单
    if (rule) {
        ruleNameInput.value = rule.name;
        urlPatternInput.value = rule.urlPattern;

        // 添加选择器字段
        for (const key in rule.selectors) {
            addSelectorField(key, rule.selectors[key]);
        }
    } else {
        // 添加一个空的选择器字段
        addSelectorField();
    }

    // 显示表单
    ruleForm.style.display = 'block';
}

// 隐藏规则表单
function hideRuleForm() {
    ruleForm.style.display = 'none';
    currentEditRule = null;
}

// 添加选择器字段
function addSelectorField(key = '', selector = '') {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'selector-field';

    // 键名输入
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'selector-key';
    keyInput.placeholder = '字段名称 (如: title)';
    keyInput.value = key;

    // 选择器输入
    const selectorInput = document.createElement('input');
    selectorInput.type = 'text';
    selectorInput.className = 'selector-value';
    selectorInput.placeholder = 'CSS选择器 (如: h1.title)';
    selectorInput.value = selector;

    // 删除按钮
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn small danger';
    removeBtn.textContent = '删除';
    removeBtn.addEventListener('click', () => {
        fieldDiv.remove();
    });

    // 添加到字段容器
    fieldDiv.appendChild(keyInput);
    fieldDiv.appendChild(selectorInput);
    fieldDiv.appendChild(removeBtn);

    selectorInputs.appendChild(fieldDiv);
}

// 保存规则
async function saveRule() {
    try {
        // 验证规则名称
        if (!ruleNameInput.value.trim()) {
            throw new Error('请输入规则名称');
        }

        // 验证URL模式
        if (!urlPatternInput.value.trim()) {
            throw new Error('请输入URL模式');
        }

        // 验证URL模式是否为有效的正则表达式
        try {
            new RegExp(urlPatternInput.value);
        } catch (e) {
            throw new Error('URL模式不是有效的正则表达式');
        }

        // 收集选择器
        const selectors = {};
        const selectorFields = selectorInputs.querySelectorAll('.selector-field');

        if (selectorFields.length === 0) {
            throw new Error('请至少添加一个选择器');
        }

        for (const field of selectorFields) {
            const key = field.querySelector('.selector-key').value.trim();
            const selector = field.querySelector('.selector-value').value.trim();

            if (!key || !selector) {
                throw new Error('选择器字段不能为空');
            }

            selectors[key] = selector;
        }

        // 创建规则对象
        const rule = {
            name: ruleNameInput.value.trim(),
            urlPattern: urlPatternInput.value.trim(),
            selectors: selectors
        };

        // 从存储中获取现有规则
        await new Promise((resolve, reject) => {
            chrome.storage.sync.get(['extractionRules'], async (result) => {
                try {
                    let rules = result.extractionRules || [];

                    // 如果是编辑，先删除旧规则
                    if (currentEditRule) {
                        rules = rules.filter(r => r.name !== currentEditRule.name);
                    }

                    // 添加新规则
                    rules.push(rule);

                    // 保存回存储
                    await new Promise((saveResolve, saveReject) => {
                        chrome.storage.sync.set({ extractionRules: rules }, () => {
                            if (chrome.runtime.lastError) {
                                saveReject(new Error(chrome.runtime.lastError.message));
                            } else {
                                saveResolve();
                            }
                        });
                    });

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });

        // 重新加载规则列表
        loadRulesList();

        // 隐藏表单
        hideRuleForm();

        // 显示成功通知
        showNotification('规则已保存');
    } catch (error) {
        showNotification(`保存规则失败: ${error.message}`, true);
    }
}

// 编辑规则
function editRule(rule) {
    showRuleForm(rule);
}

// 删除规则
async function deleteRule(ruleName) {
    // 确认删除
    if (!confirm(`确定要删除规则 "${ruleName}" 吗？`)) {
        return;
    }

    try {
        // 从存储中获取现有规则
        await new Promise((resolve, reject) => {
            chrome.storage.sync.get(['extractionRules'], async (result) => {
                try {
                    let rules = result.extractionRules || [];

                    // 过滤掉要删除的规则
                    rules = rules.filter(rule => rule.name !== ruleName);

                    // 保存回存储
                    await new Promise((saveResolve, saveReject) => {
                        chrome.storage.sync.set({ extractionRules: rules }, () => {
                            if (chrome.runtime.lastError) {
                                saveReject(new Error(chrome.runtime.lastError.message));
                            } else {
                                saveResolve();
                            }
                        });
                    });

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });

        // 重新加载规则列表
        loadRulesList();

        // 显示成功通知
        showNotification('规则已删除');
    } catch (error) {
        showNotification(`删除规则失败: ${error.message}`, true);
    }
}

// 加载规则列表
function loadRulesList() {
    // 清空列表
    rulesList.innerHTML = '';

    // 从浏览器存储中获取所有规则
    chrome.storage.sync.get(['extractionRules'], (result) => {
        const rules = result.extractionRules || [];

        if (rules.length === 0) {
            // 没有规则时显示提示
            const emptyItem = document.createElement('li');
            emptyItem.className = 'empty-item';
            emptyItem.textContent = '暂无自定义提取规则';
            rulesList.appendChild(emptyItem);
            return;
        }

        // 添加每个规则到列表
        rules.forEach(rule => {
            const item = document.createElement('li');

            // 规则信息
            const infoDiv = document.createElement('div');
            infoDiv.className = 'rule-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'rule-name';
            nameSpan.textContent = rule.name;

            const patternSpan = document.createElement('span');
            patternSpan.className = 'rule-pattern';
            patternSpan.textContent = rule.urlPattern;

            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(patternSpan);

            // 规则操作
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'rule-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn small';
            editBtn.textContent = '编辑';
            editBtn.addEventListener('click', () => editRule(rule));

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn small danger';
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', () => deleteRule(rule.name));

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);

            // 添加到列表项
            item.appendChild(infoDiv);
            item.appendChild(actionsDiv);

            rulesList.appendChild(item);
        });
    });
}