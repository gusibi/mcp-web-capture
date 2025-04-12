// 日志查看器脚本

let allLogs = [];
let activeFilters = {
    level: 'all',
    search: '',
    startTime: null,
    endTime: null
};

// 从存储中加载日志
async function loadLogs() {
    const result = await chrome.storage.local.get(['captureLogs']);
    allLogs = result.captureLogs || [];
    applyFiltersAndRender();
}

// 应用过滤器并渲染日志
function applyFiltersAndRender() {
    let filteredLogs = allLogs;

    // 级别过滤
    if (activeFilters.level !== 'all') {
        filteredLogs = filteredLogs.filter(log => log.level === activeFilters.level);
    }

    // 搜索过滤
    if (activeFilters.search) {
        const searchLower = activeFilters.search.toLowerCase();
        filteredLogs = filteredLogs.filter(log => {
            return log.message.toLowerCase().includes(searchLower) ||
                (log.error && log.error.toLowerCase().includes(searchLower));
        });
    }

    // 时间范围过滤
    if (activeFilters.startTime) {
        filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(activeFilters.startTime));
    }
    if (activeFilters.endTime) {
        filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(activeFilters.endTime));
    }

    renderLogs(filteredLogs);
}

// 渲染日志到页面
function renderLogs(logs) {
    const container = document.getElementById('logs');
    container.innerHTML = '';

    if (logs.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">没有找到匹配的日志</div>';
        return;
    }

    logs.forEach(log => {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${log.level}`;

        const timestamp = new Date(log.timestamp).toLocaleString();
        logEntry.innerHTML = `
            <div class="timestamp">${timestamp}</div>
            <div class="level">[${log.level.toUpperCase()}]</div>
            <div class="message">${log.message}</div>
            ${log.error ? `<div class="error-details">错误: ${log.error}</div>` : ''}
        `;

        container.appendChild(logEntry);
    });
}

// 清除所有日志
async function clearLogs() {
    await chrome.storage.local.remove('captureLogs');
    allLogs = [];
    applyFiltersAndRender();
}

// 初始化页面
async function init() {
    // 初始化级别过滤器
    document.querySelectorAll('.filter-group button').forEach(button => {
        button.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-group button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            activeFilters.level = button.dataset.level || 'all';
            applyFiltersAndRender();
        });
    });

    // 初始化搜索框
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', (e) => {
        activeFilters.search = e.target.value;
        applyFiltersAndRender();
    });

    // 初始化时间范围选择器
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');

    startTimeInput.addEventListener('change', (e) => {
        activeFilters.startTime = e.target.value;
        applyFiltersAndRender();
    });

    endTimeInput.addEventListener('change', (e) => {
        activeFilters.endTime = e.target.value;
        applyFiltersAndRender();
    });

    // 初始化刷新和清除按钮
    document.getElementById('refresh-logs').addEventListener('click', loadLogs);
    document.getElementById('clear-logs').addEventListener('click', clearLogs);

    // 加载初始日志
    await loadLogs();
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);