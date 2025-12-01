// 网络爬虫系统 - 前端应用

// 全局变量
let socket = null;
let currentTaskId = null;
let tasks = [];
let pollingInterval = null;
let monitorData = {};
let trafficChart = null;
let speedChart = null;
let fileTypeChart = null;
let taskTrafficData = {}; // 存储每个任务的流量数据
let taskSpeedData = {}; // 存储每个任务的瞬间流量数据
let lastBytes = {}; // 存储上次的字节数，用于计算瞬间流量
let lastTime = {}; // 存储上次的时间
let lastThreadBytes = {}; // 存储每个线程上次的字节数
let lastThreadTime = {}; // 存储每个线程上次的时间
let expandedNodes = new Set(); // 存储当前任务展开的节点
let taskExpandedNodes = {}; // 存储每个任务的展开状态 {taskId: Set}
let loadUrlsTimeout = null; // URL加载防抖定时器

// 展开状态管理 - 使用内存存储，不依赖localStorage
// expandedNodes 在全局变量中定义，刷新URL列表时会保持状态
let trafficData = {
    labels: [],
    datasets: [{
        label: '总流量 (KB)',
        data: [],
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        tension: 0.4
    }]
};

let speedData = {
    labels: [],
    datasets: [{
        label: '瞬间流量',
        data: [],
        borderColor: '#FF5722',
        backgroundColor: 'rgba(255, 87, 34, 0.1)',
        tension: 0.4
    }]
};

// API基础URL
const API_BASE = window.location.origin;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Application initializing...');
    
    // 初始化WebSocket
    initializeWebSocket();
    
    // 加载任务列表，并自动选择第一个任务
    loadTasks(true);
    
    // 初始化图表
    initCharts();
    initNewCharts();
    
    // 加载主题
    loadTheme();
    
    // 添加日志
    addLog('系统已启动', 'info');
});

// ==================== WebSocket ====================

function initializeWebSocket() {
    // 暂时禁用SocketIO，使用HTTP轮询避免AssertionError
    console.log('Using HTTP polling instead of WebSocket');
    addLog('使用HTTP轮询模式', 'info');
    updateConnectionStatus(true);
    // 不启动轮询，由任务选择时启动
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (connected) {
        statusEl.innerHTML = '<i class="fas fa-circle" style="color: #4CAF50;"></i><span>已连接</span>';
    } else {
        statusEl.innerHTML = '<i class="fas fa-circle" style="color: #f44336;"></i><span>未连接</span>';
    }
}

// ==================== WebSocket连接 ====================

function initializeWebSocket() {
    console.log('Initializing WebSocket connection...');
    
    // 连接到Socket.IO服务器
    socket = io(API_BASE);
    
    // 连接成功事件
    socket.on('connect', () => {
        console.log('WebSocket connected successfully');
        addLog('WebSocket连接成功', 'success');
        
        // 如果有当前任务，加入监控房间
        if (currentTaskId) {
            joinTaskRoom(currentTaskId);
        }
    });
    
    // 连接断开事件
    socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        addLog('WebSocket连接断开', 'warning');
    });
    
    // 监控数据更新事件
    socket.on('monitor_update', (data) => {
        console.log('Received monitor update:', data);
        updateMonitorDisplay(data);
    });
    
    // 任务状态更新事件
    socket.on('task_status_update', (data) => {
        console.log('Received task status update:', data);
        // 更新任务列表中的状态
        loadTasks();
    });
    
    // 加入任务房间确认
    socket.on('joined_task', (data) => {
        console.log(`Joined task ${data.task_id} room`);
        addLog(`开始监控任务 ${data.task_id}`, 'info');
    });
    
    // 连接错误处理
    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        addLog('WebSocket连接失败', 'error');
    });
}

function joinTaskRoom(taskId) {
    if (socket && socket.connected) {
        socket.emit('join_task', { task_id: taskId });
    }
}

function leaveTaskRoom(taskId) {
    if (socket && socket.connected) {
        socket.emit('leave_task', { task_id: taskId });
    }
}

// ==================== HTTP轮询 (备用) ====================

function startPolling() {
    // WebSocket模式下不使用HTTP轮询
    console.log('WebSocket mode: HTTP polling disabled');
}

function stopPolling() {
    // WebSocket模式下不需要停止轮询
    console.log('WebSocket mode: No polling to stop');
}

async function fetchMonitorData(taskId) {
    try {
        const response = await fetch(`${API_BASE}/api/v1/monitor/${taskId}/current`);
        const result = await response.json();
        
        if (result.success) {
            updateMonitorDisplay(result.data);
        }
    } catch (error) {
        console.error('Failed to fetch monitor data:', error);
    }
}

// ==================== 任务管理 ====================

async function loadTasks(autoSelectFirst = false) {
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks`);
        const result = await response.json();
        
        if (result.success) {
            tasks = result.data;
            renderTaskList();
            
            // 如果需要自动选择第一个任务，且有任务存在
            if (autoSelectFirst && tasks.length > 0 && !currentTaskId) {
                selectTask(tasks[0].id);
            }
        }
    } catch (error) {
        console.error('Failed to load tasks:', error);
        addLog('加载任务列表失败', 'error');
    }
}

function renderTaskList() {
    const taskList = document.getElementById('taskList');
    
    if (tasks.length === 0) {
        if (!taskList.querySelector('.empty-state')) {
            taskList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>暂无任务</p>
                </div>
            `;
        }
        return;
    }
    
    // 检查是否需要重建任务卡片结构
    const existingItems = taskList.querySelectorAll('.task-item');
    const taskIds = tasks.map(t => t.id);
    const existingIds = Array.from(existingItems).map(el => parseInt(el.dataset.taskId));
    
    // 如果任务数量或ID不匹配，重建结构
    if (existingItems.length !== tasks.length || !taskIds.every(id => existingIds.includes(id))) {
        taskList.innerHTML = tasks.map(task => `
            <div class="task-item" data-task-id="${task.id}" onclick="selectTask(${task.id})">
                <div class="task-item-header">
                    <h4 class="task-name"></h4>
                    <span class="task-status-badge"></span>
                </div>
                <div class="task-item-body">
                    <div class="task-url"></div>
                    <div class="task-meta">
                        <span class="meta-depth"><i class="fas fa-layer-group"></i> 深度: <span>0</span></span>
                        <span class="meta-threads"><i class="fas fa-server"></i> 线程: <span>0</span></span>
                    </div>
                    <div class="task-progress">
                        <div class="task-progress-bar">
                            <div class="task-progress-fill"></div>
                        </div>
                        <span class="task-progress-text">0%</span>
                    </div>
                </div>
                <div class="task-item-footer">
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteTask(${task.id})" 
                            title="删除任务">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    // 只更新内容，不重建DOM结构
    tasks.forEach(task => {
        const item = taskList.querySelector(`[data-task-id="${task.id}"]`);
        if (!item) return;
        
        // 更新active状态
        item.classList.toggle('active', task.id === currentTaskId);
        
        // 更新名称
        const nameEl = item.querySelector('.task-name');
        if (nameEl) nameEl.textContent = task.name;
        
        // 更新状态
        const statusEl = item.querySelector('.task-status-badge');
        if (statusEl) {
            statusEl.className = `task-status-badge status-${task.status}`;
            statusEl.textContent = getStatusText(task.status);
        }
        
        // 更新URL
        const urlEl = item.querySelector('.task-url');
        if (urlEl) urlEl.textContent = task.url;
        
        // 更新深度
        const depthEl = item.querySelector('.meta-depth span');
        if (depthEl) depthEl.textContent = task.max_depth;
        
        // 更新线程数
        const threadsEl = item.querySelector('.meta-threads span');
        if (threadsEl) threadsEl.textContent = task.thread_count;
        
        // 更新进度条
        const progressFill = item.querySelector('.task-progress-fill');
        if (progressFill) progressFill.style.width = `${task.progress || 0}%`;
        
        // 更新进度文字
        const progressText = item.querySelector('.task-progress-text');
        if (progressText) progressText.textContent = `${(task.progress || 0).toFixed(1)}%`;
    });
}

function selectTask(taskId) {
    // 保存当前任务的展开状态
    if (currentTaskId && expandedNodes.size > 0) {
        taskExpandedNodes[currentTaskId] = new Set(expandedNodes);
    }
    
    // 离开当前任务的WebSocket房间
    if (currentTaskId && currentTaskId !== taskId) {
        leaveTaskRoom(currentTaskId);
    }
    
    currentTaskId = taskId;
    const task = tasks.find(t => t.id === taskId);
    
    if (task) {
        document.getElementById('currentTaskName').textContent = task.name;
        document.getElementById('currentTaskStatus').textContent = getStatusText(task.status);
        document.getElementById('currentTaskStatus').className = `task-status status-${task.status}`;
        
        // 显示编辑按钮
        document.getElementById('btnEditTask').style.display = 'inline-flex';
        
        updateControlButtons(task.status, task.queue_status);
        renderTaskList();
        
        // 加入新任务的WebSocket房间
        joinTaskRoom(taskId);
        
        // 切换任务时重置流量图表
        resetTrafficChart(taskId);
        
        // 恢复目标任务的展开状态（如果有的话）
        if (taskExpandedNodes[taskId]) {
            expandedNodes = new Set(taskExpandedNodes[taskId]);
        } else {
            expandedNodes = new Set();
        }
        
        // 加载任务数据（包括停止的任务，用于显示最终流量）
        fetchMonitorData(taskId);
        
        // 根据任务状态控制轮询
        // 只有运行中的任务才需要轮询，暂停/停止/完成都不需要
        if (task.status === 'running') {
            startPolling();
        } else {
            // 暂停、停止、完成、失败等状态都停止轮询
            stopPolling();
        }
        debouncedLoadUrls();
        loadStats();
        
        addLog(`已选择任务: ${task.name}`, 'info');
    }
}

function updateControlButtons(status, queueStatus = 'active') {
    const btnStart = document.getElementById('btnStart');
    const btnPauseCrawling = document.getElementById('btnPauseCrawling');
    const btnResumeCrawling = document.getElementById('btnResumeCrawling');
    const btnPauseQueue = document.getElementById('btnPauseQueue');
    const btnResumeQueue = document.getElementById('btnResumeQueue');
    const btnStop = document.getElementById('btnStop');
    
    // 重置所有按钮
    btnStart.disabled = false;
    btnPauseCrawling.disabled = true;
    btnResumeCrawling.disabled = true;
    btnPauseQueue.disabled = true;
    btnResumeQueue.disabled = true;
    btnStop.disabled = true;
    
    // 队列控制按钮始终可用（除了pending状态）
    const queueControlsEnabled = status !== 'pending';
    
    switch (status) {
        case 'pending':
            btnStart.disabled = false;
            btnStart.innerHTML = '<i class="fas fa-play"></i> 开始';
            break;
        case 'stopped':
        case 'failed':
            btnStart.disabled = false;
            btnStart.innerHTML = '<i class="fas fa-redo"></i> 重启';
            // 队列控制可用
            if (queueStatus === 'paused') {
                btnResumeQueue.disabled = false;
            } else {
                btnPauseQueue.disabled = false;
            }
            break;
        case 'completed':
            btnStart.disabled = false;
            btnStart.innerHTML = '<i class="fas fa-redo"></i> 重新开始';
            // 队列控制可用
            if (queueStatus === 'paused') {
                btnResumeQueue.disabled = false;
            } else {
                btnPauseQueue.disabled = false;
            }
            break;
        case 'running':
            btnStart.disabled = true;
            btnStart.innerHTML = '<i class="fas fa-play"></i> 开始';
            btnPauseCrawling.disabled = false;
            btnStop.disabled = false;
            // 队列控制基于队列状态
            if (queueStatus === 'paused') {
                btnResumeQueue.disabled = false;
            } else {
                btnPauseQueue.disabled = false;
            }
            break;
        case 'paused':
            btnStart.disabled = true;
            btnStart.innerHTML = '<i class="fas fa-play"></i> 开始';
            btnResumeCrawling.disabled = false;
            btnStop.disabled = false;
            // 队列控制基于队列状态
            if (queueStatus === 'paused') {
                btnResumeQueue.disabled = false;
            } else {
                btnPauseQueue.disabled = false;
            }
            break;
    }
}

async function startTask() {
    if (!currentTaskId) {
        addLog('请先选择一个任务', 'warning');
        return;
    }
    
    // 直接启动，不显示确认弹窗
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/start`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            const task = tasks.find(t => t.id === currentTaskId);
            if (task && (task.status === 'completed' || task.status === 'stopped')) {
                const completed = task.completed_urls || 0;
                const failed = task.failed_urls || 0;
                if (completed > 0 || failed > 0) {
                    addLog(`任务已重新启动: ${task.name} (上次: 成功 ${completed} 个，失败 ${failed} 个)`, 'success');
                } else {
                    addLog(`任务已重新启动: ${task.name}`, 'success');
                }
            } else {
                addLog(`任务已启动: ${task.name}`, 'success');
            }
            startPolling();
            await loadTasks();
            selectTask(currentTaskId);
        } else {
            // 如果是僵尸任务错误，尝试自动清理
            if (result.error && result.error.includes('任务正在运行中')) {
                addLog('检测到僵尸任务，正在自动清理...', 'warning');
                const cleaned = await forceCleanupTask(currentTaskId);
                if (cleaned) {
                    addLog('僵尸任务已清理，请重新尝试启动', 'success');
                } else {
                    addLog(`任务启动失败: ${result.error}`, 'error');
                }
            } else {
                addLog(`任务启动失败: ${result.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('Failed to start task:', error);
        addLog('启动任务失败', 'error');
    }
}

async function pauseCrawling() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/pause`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            addLog('爬取已暂停，停止刷新', 'info');
            stopPolling();  // 立即停止轮询
            await loadTasks();
            // 更新UI但不重新选择任务（避免重新启动轮询）
            const task = tasks.find(t => t.id === currentTaskId);
            if (task) {
                document.getElementById('currentTaskStatus').textContent = getStatusText(task.status);
                document.getElementById('currentTaskStatus').className = `task-status status-${task.status}`;
                updateControlButtons(task.status, task.queue_status);
                renderTaskList();
            }
        } else {
            addLog(`爬取暂停失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to pause crawling:', error);
        addLog('爬取暂停失败', 'error');
    }
}

async function resumeCrawling() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/resume`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            addLog('爬取已继续', 'success');
            startPolling();
            await loadTasks();
            selectTask(currentTaskId);
        } else {
            addLog(`爬取继续失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to resume crawling:', error);
        addLog('爬取继续失败', 'error');
    }
}

async function stopTask() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/stop`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            addLog('任务已停止，停止刷新', 'warning');
            stopPolling();  // 立即停止轮询
            await loadTasks();
            await loadTasks();
            const task = tasks.find(t => t.id === currentTaskId);
            if (task) {
                document.getElementById('currentTaskStatus').textContent = getStatusText(task.status);
                document.getElementById('currentTaskStatus').className = `task-status status-${task.status}`;
                updateControlButtons(task.status, task.queue_status);
                renderTaskList();
            }
        } else {
            addLog(`停止失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to stop task:', error);
        addLog('停止任务失败', 'error');
    }
}

async function pauseQueue() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/pause-queue`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            addLog('URL队列已暂停，停止发现新链接', 'info');
            await loadTasks();
            const task = tasks.find(t => t.id === currentTaskId);
            if (task) {
                updateControlButtons(task.status, task.queue_status);
                renderTaskList();
            }
        } else {
            addLog(`队列暂停失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to pause queue:', error);
        addLog('队列暂停失败', 'error');
    }
}

async function resumeQueue() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/resume-queue`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            addLog('URL队列已继续，恢复发现新链接', 'success');
            await loadTasks();
            const task = tasks.find(t => t.id === currentTaskId);
            if (task) {
                updateControlButtons(task.status, task.queue_status);
                renderTaskList();
            }
        } else {
            addLog(`队列继续失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to resume queue:', error);
        addLog('队列继续失败', 'error');
    }
}

async function deleteTask(taskId) {
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${taskId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.success) {
            addLog('任务已删除', 'info');
            
            // 清理该任务的流量数据
            if (taskTrafficData[taskId]) {
                delete taskTrafficData[taskId];
                console.log(`Cleared traffic data for deleted task ${taskId}`);
            }
            
            if (taskId === currentTaskId) {
                currentTaskId = null;
                document.getElementById('currentTaskName').textContent = '请选择一个任务';
                document.getElementById('currentTaskStatus').textContent = '-';
                
                // 重置图表为空状态
                if (trafficChart) {
                    trafficData = {
                        labels: [],
                        datasets: [{
                            label: '总流量 (KB)',
                            data: [],
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76, 175, 80, 0.1)',
                            tension: 0.4
                        }]
                    };
                    trafficChart.data = trafficData;
                    trafficChart.update();
                }
            }
            await loadTasks();
        } else {
            addLog(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to delete task:', error);
        addLog('删除任务失败', 'error');
    }
}

// ==================== 创建任务 ====================

function showCreateTaskModal() {
    document.getElementById('createTaskModal').classList.add('show');
}

function closeCreateTaskModal() {
    document.getElementById('createTaskModal').classList.remove('show');
    document.getElementById('createTaskForm').reset();
}

async function createTask(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    
    const taskData = {
        name: formData.get('name'),
        url: formData.get('url'),
        strategy: formData.get('strategy'),
        max_depth: parseInt(formData.get('max_depth')),
        thread_count: parseInt(formData.get('thread_count')),
        request_interval: parseFloat(formData.get('request_interval')),
        retry_times: parseInt(formData.get('retry_times')),
        respect_robots: formData.get('respect_robots') === 'on',
        allow_cross_domain: formData.get('allow_cross_domain') === 'on'
    };
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });
        const result = await response.json();
        
        if (result.success) {
            addLog(`任务创建成功: ${taskData.name}`, 'success');
            closeCreateTaskModal();
            await loadTasks();
            selectTask(result.data.id);
        } else {
            addLog(`创建失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to create task:', error);
        addLog('创建任务失败', 'error');
    }
}

// ==================== 编辑任务 ====================

async function showEditTaskModal() {
    if (!currentTaskId) {
        addLog('请先选择一个任务', 'warning');
        return;
    }
    
    try {
        // 从后端获取任务的完整配置
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}`);
        const result = await response.json();
        
        if (!result.success) {
            addLog('获取任务配置失败', 'error');
            return;
        }
        
        const task = result.data;
        
        // 填充表单数据
        document.getElementById('editTaskId').value = task.id;
        document.getElementById('editTaskName').value = task.name;
        document.getElementById('editTaskUrl').value = task.url;
        document.getElementById('editTaskStrategy').value = task.strategy || 'bfs';
        document.getElementById('editTaskMaxDepth').value = task.max_depth || 3;
        document.getElementById('editTaskThreadCount').value = task.thread_count || 3;
        document.getElementById('editTaskInterval').value = task.request_interval || 1.0;
        document.getElementById('editTaskRetry').value = task.retry_times || 3;
        document.getElementById('editTaskRobots').checked = Boolean(task.respect_robots);
        document.getElementById('editTaskCrossDomain').checked = Boolean(task.allow_cross_domain);
        
        document.getElementById('editTaskModal').classList.add('show');
    } catch (error) {
        console.error('Failed to get task config:', error);
        addLog('获取任务配置失败', 'error');
    }
}

function closeEditTaskModal() {
    document.getElementById('editTaskModal').classList.remove('show');
}

async function updateTask(event) {
    event.preventDefault();
    
    const taskId = document.getElementById('editTaskId').value;
    
    // 防止重复提交
    const submitButton = event.target.querySelector('button[type="submit"]');
    if (submitButton.disabled) {
        console.log('Submit already in progress, ignoring...');
        return;
    }
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
    
    // 添加调试日志
    console.log('Updating task:', taskId);
    
    const taskData = {
        name: document.getElementById('editTaskName').value,
        url: document.getElementById('editTaskUrl').value,
        strategy: document.getElementById('editTaskStrategy').value,
        max_depth: parseInt(document.getElementById('editTaskMaxDepth').value),
        thread_count: parseInt(document.getElementById('editTaskThreadCount').value),
        request_interval: parseFloat(document.getElementById('editTaskInterval').value),
        retry_times: parseInt(document.getElementById('editTaskRetry').value),
        respect_robots: document.getElementById('editTaskRobots').checked,
        allow_cross_domain: document.getElementById('editTaskCrossDomain').checked
    };
    
    // 调试输出任务数据
    console.log('Task data:', taskData);
    
    // 验证数据
    if (!taskData.name || taskData.name.trim() === '') {
        addLog('任务名称不能为空', 'error');
        return;
    }
    
    if (!taskData.url || taskData.url.trim() === '') {
        addLog('起始URL不能为空', 'error');
        return;
    }
    
    if (isNaN(taskData.max_depth) || taskData.max_depth < 1) {
        addLog('最大深度必须是大于0的数字', 'error');
        return;
    }
    
    if (isNaN(taskData.thread_count) || taskData.thread_count < 1) {
        addLog('线程数必须是大于0的数字', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${taskId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        
        const result = await response.json();
        console.log('Response result:', result);
        
        if (result.success) {
            addLog(`任务配置已更新: ${taskData.name}`, 'success');
            closeEditTaskModal();
            await loadTasks();
            // 更新当前显示的任务名称
            document.getElementById('currentTaskName').textContent = taskData.name;
        } else {
            console.error('Update failed:', result.error);
            
            // 如果是僵尸任务错误，尝试自动清理
            if (result.error && result.error.includes('任务正在运行中')) {
                addLog('检测到僵尸任务，正在自动清理...', 'warning');
                const cleaned = await forceCleanupTask(taskId);
                if (cleaned) {
                    addLog('僵尸任务已清理，请重新尝试编辑', 'success');
                } else {
                    addLog(`更新失败: ${result.error}`, 'error');
                }
            } else {
                addLog(`更新失败: ${result.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('Failed to update task:', error);
        addLog(`更新任务失败: ${error.message}`, 'error');
    } finally {
        // 恢复按钮状态
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-save"></i> 保存修改';
    }
}

// ==================== 监控显示 ====================

function updateMonitorDisplay(data) {
    monitorData = data;
    
    // 任务隔离验证日志已禁用，减少控制台噪音
    
    // 更新进度
    const progress = data.progress || 0;
    document.getElementById('progressText').textContent = `${progress.toFixed(1)}%`;
    document.getElementById('progressFill').style.width = `${progress}%`;
    
    // 计算瞬间流量
    const currentBytes = data.total_bytes || 0;
    const currentTime = Date.now();
    let instantSpeed = 0;
    
    if (lastBytes[data.task_id] !== undefined && lastTime[data.task_id] !== undefined) {
        const byteDiff = currentBytes - lastBytes[data.task_id];
        const timeDiff = (currentTime - lastTime[data.task_id]) / 1000; // 转换为秒
        
        if (timeDiff > 0) {
            instantSpeed = (byteDiff / 1024) / timeDiff; // KB/s
        }
    }
    
    // 更新记录
    lastBytes[data.task_id] = currentBytes;
    lastTime[data.task_id] = currentTime;
    
    // 更新统计卡片
    document.getElementById('statTotalUrls').textContent = formatNumber(data.total_urls || 0);
    document.getElementById('statCompleted').textContent = formatNumber(data.completed_urls || 0);
    document.getElementById('statFailed').textContent = formatNumber(data.failed_urls || 0);
    document.getElementById('statSuccessRate').textContent = `${(data.success_rate || 0).toFixed(1)}%`;
    document.getElementById('statTotalBytes').textContent = formatBytes(data.total_bytes || 0);
    document.getElementById('statInstantSpeed').textContent = `${instantSpeed.toFixed(2)} KB/s`;
    document.getElementById('statAvgResponse').textContent = `${((data.avg_response_time || 0) * 1000).toFixed(0)} ms`;
    
    // 调试信息（可以在控制台查看详细统计）
    if (window.debugStats) {
        console.log('=== 详细统计 ===');
        console.log(`队列URL: ${data.total_urls || 0}`);
        console.log(`已处理: ${data.total_processed || 0}`);
        console.log(`已完成: ${data.completed_urls || 0}`);
        console.log(`失败: ${data.failed_urls || 0}`);
        console.log(`跨域禁止: ${data.cross_domain_blocked_urls || 0}`);
        console.log(`深度禁止: ${data.depth_blocked_urls || 0}`);
        console.log(`重复URL: ${data.duplicate_urls || 0}`);
        console.log(`队列剩余: ${data.queue_size || 0}`);
        console.log(`进度: ${(data.progress || 0).toFixed(1)}%`);
        console.log('================');
    }
    
    // 更新线程状态
    updateThreadsDisplay(data.threads || {});
    
    // 更新流量图表
    updateTrafficChart(data);
    
    // 更新瞬间流量图表
    updateSpeedChart(data, instantSpeed);
    
    // 更新任务状态
    const task = tasks.find(t => t.id === currentTaskId);
    if (task) {
        const oldStatus = task.status;
        task.status = data.status;
        task.progress = progress;
        
        // 更新状态显示
        document.getElementById('currentTaskStatus').textContent = getStatusText(data.status);
        document.getElementById('currentTaskStatus').className = `task-status status-${data.status}`;
        
        updateControlButtons(data.status, data.queue_status);
        renderTaskList();
        
        // 如果任务完成或停止，添加日志（避免重复）并停止轮询
        if (data.status === 'completed' && oldStatus !== 'completed') {
            const completed = data.completed_urls || 0;
            const failed = data.failed_urls || 0;
            const total = completed + failed;
            const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
            addLog(`任务已完成: ${task.name} - 成功 ${completed} 个，失败 ${failed} 个，成功率 ${successRate}%`, 'success');
            stopPolling(); // 停止轮询
        } else if (data.status === 'stopped' && oldStatus !== 'stopped') {
            const completed = data.completed_urls || 0;
            const failed = data.failed_urls || 0;
            addLog(`任务已停止: ${task.name} - 已处理 ${completed + failed} 个URL (成功 ${completed}，失败 ${failed})`, 'warning');
            stopPolling(); // 停止轮询
        } else if (data.status === 'failed' && oldStatus !== 'failed') {
            const completed = data.completed_urls || 0;
            const failed = data.failed_urls || 0;
            addLog(`任务失败: ${task.name} - 已处理 ${completed + failed} 个URL (成功 ${completed}，失败 ${failed})`, 'error');
            stopPolling(); // 停止轮询
        }
        
        // 如果任务不再运行，确保停止轮询
        if (data.status !== 'running' && pollingInterval) {
            stopPolling();
        }
    }
}

function updateThreadsDisplay(threads) {
    const threadsGrid = document.getElementById('threadsGrid');
    const threadIds = Object.keys(threads);
    
    if (threadIds.length === 0) {
        if (!threadsGrid.querySelector('.empty-state')) {
            threadsGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-info-circle"></i>
                    <p>等待任务启动...</p>
                </div>
            `;
        }
        return;
    }
    
    // 检查是否需要创建卡片结构
    const existingCards = threadsGrid.querySelectorAll('.thread-card');
    if (existingCards.length !== threadIds.length) {
        // 线程数量变化，重新创建结构
        threadsGrid.innerHTML = threadIds.map(id => `
            <div class="thread-card" data-thread-id="${id}">
                <div class="thread-header">
                    <span class="thread-id">线程 #${id}</span>
                    <span class="thread-status"></span>
                </div>
                <div class="thread-body">
                    <div class="thread-url"></div>
                    <div class="thread-stats">
                        <span class="stat-completed"><i class="fas fa-check"></i> <span>0</span></span>
                        <span class="stat-failed"><i class="fas fa-times"></i> <span>0</span></span>
                        <span class="stat-speed"><i class="fas fa-tachometer-alt"></i> <span>0.00</span> req/s</span>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    // 只更新内容，不重建DOM结构
    threadIds.forEach(id => {
        const thread = threads[id];
        const card = threadsGrid.querySelector(`[data-thread-id="${id}"]`);
        if (!card) return;
        
        // 更新卡片状态类
        card.className = `thread-card status-${thread.status}`;
        
        // 更新状态文字
        const statusEl = card.querySelector('.thread-status');
        if (statusEl) statusEl.textContent = getThreadStatusText(thread.status);
        
        // 更新URL
        const urlEl = card.querySelector('.thread-url');
        if (urlEl) {
            urlEl.title = thread.current_url || '';
            urlEl.textContent = thread.current_url ? truncateUrl(thread.current_url, 40) : '空闲中...';
        }
        
        // 更新统计
        const completedEl = card.querySelector('.stat-completed span');
        if (completedEl) completedEl.textContent = thread.completed;
        
        const failedEl = card.querySelector('.stat-failed span');
        if (failedEl) failedEl.textContent = thread.failed;
        
        const speedEl = card.querySelector('.stat-speed span');
        if (speedEl) speedEl.textContent = thread.speed.toFixed(2);
    });
}

// 重置流量图表（切换任务时调用）
function resetTrafficChart(taskId) {
    if (!trafficChart) return;
    
    console.log(`Resetting traffic chart for task ${taskId}`);
    
    // 恢复或创建该任务的总流量数据
    if (!taskTrafficData[taskId]) {
        taskTrafficData[taskId] = {
            labels: [],
            datasets: [{
                label: '总流量 (KB)',
                data: [],
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                tension: 0.4
            }]
        };
    }
    
    // 恢复或创建该任务的瞬间流量数据
    if (!taskSpeedData[taskId]) {
        taskSpeedData[taskId] = {
            labels: [],
            datasets: [{
                label: '瞬间流量',
                data: [],
                borderColor: '#FF5722',
                backgroundColor: 'rgba(255, 87, 34, 0.1)',
                tension: 0.4
            }]
        };
    }
    
    // 使用该任务的数据
    trafficData = taskTrafficData[taskId];
    trafficChart.data = trafficData;
    trafficChart.update();
    
    if (speedChart) {
        speedData = taskSpeedData[taskId];
        speedChart.data = speedData;
        speedChart.update();
    }
    
    // 重置瞬间流量计算的基准值
    lastBytes[taskId] = undefined;
    lastTime[taskId] = undefined;
    
    // 重置线程瞬间流量计算的基准值
    Object.keys(lastThreadBytes).forEach(key => {
        if (key.startsWith(`${taskId}_`)) {
            delete lastThreadBytes[key];
            delete lastThreadTime[key];
        }
    });
}

function updateTrafficChart(data) {
    if (!trafficChart || !currentTaskId) return;
    
    // 确保当前任务有数据存储
    if (!taskTrafficData[currentTaskId]) {
        taskTrafficData[currentTaskId] = {
            labels: [],
            datasets: [{
                label: '总流量 (KB)',
                data: [],
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                tension: 0.4
            }]
        };
    }
    
    // 使用当前任务的数据
    trafficData = taskTrafficData[currentTaskId];
    
    const now = new Date().toLocaleTimeString();
    
    // 计算当前流量
    let trafficKB = (data.total_bytes || 0) / 1024;
    
    // 如果任务已停止，只在第一次获取数据时更新图表
    if (data.status !== 'running') {
        // 检查是否需要添加最终流量数据点
        if (trafficData.labels.length === 0 || 
            (trafficData.labels.length > 0 && trafficData.datasets[0].data[trafficData.datasets[0].data.length - 1] !== trafficKB)) {
            
            // 添加最终流量数据点
            trafficData.labels.push(now);
            trafficData.datasets[0].data.push(trafficKB);
            
            // 更新图表
            trafficChart.data = trafficData;
            trafficChart.update();
        }
        return; // 停止的任务不需要继续添加新数据点
    }
    
    // 保持最近30个数据点
    if (trafficData.labels.length >= 30) {
        trafficData.labels.shift();
        trafficData.datasets[0].data.shift();
        
        // 同时移除线程数据
        trafficData.datasets.forEach(dataset => {
            if (dataset.data.length >= 30) {
                dataset.data.shift();
            }
        });
    }
    
    trafficData.labels.push(now);
    trafficData.datasets[0].data.push(trafficKB);
    
    // 更新线程流量数据
    updateThreadTrafficData(data.threads || {}, data.status);
    
    // 更新图表
    trafficChart.data = trafficData;
    trafficChart.update('none');
}

function updateSpeedChart(data, instantSpeed) {
    if (!speedChart || !currentTaskId) return;
    
    // 确保当前任务有数据存储
    if (!taskSpeedData[currentTaskId]) {
        taskSpeedData[currentTaskId] = {
            labels: [],
            datasets: [{
                label: '瞬间流量',
                data: [],
                borderColor: '#FF5722',
                backgroundColor: 'rgba(255, 87, 34, 0.1)',
                tension: 0.4
            }]
        };
    }
    
    // 使用当前任务的数据
    speedData = taskSpeedData[currentTaskId];
    
    const now = new Date().toLocaleTimeString();
    
    // 如果任务已停止，只在第一次获取数据时更新图表
    if (data.status !== 'running') {
        // 检查是否需要添加最终速度数据点（通常为0）
        if (speedData.labels.length === 0 || 
            (speedData.labels.length > 0 && speedData.datasets[0].data[speedData.datasets[0].data.length - 1] !== 0)) {
            
            // 添加最终速度数据点
            speedData.labels.push(now);
            speedData.datasets[0].data.push(0);
            
            // 线程速度也设为0
            speedData.datasets.forEach(dataset => {
                if (dataset.threadId) {
                    dataset.data.push(0);
                }
            });
            
            // 更新图表
            speedChart.data = speedData;
            speedChart.update();
        }
        return; // 停止的任务不需要继续添加新数据点
    }
    
    // 保持最近30个数据点
    if (speedData.labels.length >= 30) {
        speedData.labels.shift();
        speedData.datasets[0].data.shift();
        
        // 同时移除线程数据
        speedData.datasets.forEach(dataset => {
            if (dataset.data.length >= 30) {
                dataset.data.shift();
            }
        });
    }
    
    speedData.labels.push(now);
    speedData.datasets[0].data.push(Math.max(0, instantSpeed)); // 确保不为负数
    
    // 更新线程瞬间流量数据
    updateThreadSpeedData(data.threads || {}, data.status);
    
    // 更新图表
    speedChart.data = speedData;
    speedChart.update('none');
}

function updateThreadTrafficData(threads, taskStatus) {
    const threadIds = Object.keys(threads);
    
    // 确保每个线程都有对应的数据集
    threadIds.forEach(threadId => {
        let dataset = trafficData.datasets.find(d => d.threadId === threadId);
        
        if (!dataset) {
            // 创建新的线程数据集
            const colors = [
                '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
                '#9966FF', '#FF9F40', '#E7E9ED', '#71B37C'
            ];
            const colorIndex = parseInt(threadId) % colors.length;
            
            dataset = {
                label: `线程 #${threadId}`,
                data: new Array(trafficData.labels.length - 1).fill(0), // 填充历史数据为0
                borderColor: colors[colorIndex],
                backgroundColor: colors[colorIndex] + '20',
                tension: 0.4,
                threadId: threadId,
                hidden: false
            };
            trafficData.datasets.push(dataset);
        }
        
        // 根据线程实际字节数计算累计流量
        const thread = threads[threadId];
        let threadTrafficKB = 0;
        
        if (taskStatus === 'running' && thread && typeof thread.bytes === 'number') {
            // 使用线程的累计字节数（转换为KB）
            threadTrafficKB = thread.bytes / 1024;
            
            // 如果线程不在爬取状态，显示当前累计值但不增长
            if (thread.status !== 'crawling') {
                // 保持当前累计值
                threadTrafficKB = thread.bytes / 1024;
            }
        } else {
            // 任务暂停或停止时流量为0
            threadTrafficKB = 0;
        }
        
        dataset.data.push(threadTrafficKB);
    });
    
    // 移除不存在的线程数据集
    trafficData.datasets = trafficData.datasets.filter(dataset => {
        if (dataset.threadId && !threadIds.includes(dataset.threadId)) {
            return false; // 移除
        }
        return true; // 保留总流量数据集和存在的线程
    });
}

function updateThreadSpeedData(threads, taskStatus) {
    const threadIds = Object.keys(threads);
    const currentTime = Date.now();
    
    // 确保每个线程都有对应的数据集
    threadIds.forEach(threadId => {
        let dataset = speedData.datasets.find(d => d.threadId === threadId);
        
        if (!dataset) {
            // 创建新的线程数据集
            const colors = [
                '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384'
            ];
            const colorIndex = parseInt(threadId) % colors.length;
            
            dataset = {
                label: `线程 #${threadId}`,
                data: new Array(speedData.labels.length - 1).fill(0), // 填充历史数据为0
                borderColor: colors[colorIndex],
                backgroundColor: colors[colorIndex] + '20',
                tension: 0.4,
                threadId: threadId
            };
            speedData.datasets.push(dataset);
        }
        
        // 计算线程瞬间流量
        const thread = threads[threadId];
        let threadSpeed = 0;
        
        if (taskStatus === 'running' && thread && typeof thread.bytes === 'number') {
            const taskKey = `${currentTaskId}_${threadId}`;
            
            if (lastThreadBytes[taskKey] !== undefined && lastThreadTime[taskKey] !== undefined) {
                const byteDiff = thread.bytes - lastThreadBytes[taskKey];
                const timeDiff = (currentTime - lastThreadTime[taskKey]) / 1000; // 转换为秒
                
                if (timeDiff > 0 && byteDiff >= 0) {
                    threadSpeed = (byteDiff / 1024) / timeDiff; // KB/s
                }
            }
            
            // 更新记录
            lastThreadBytes[taskKey] = thread.bytes;
            lastThreadTime[taskKey] = currentTime;
        }
        
        dataset.data.push(Math.max(0, threadSpeed));
    });
    
    // 移除不存在的线程数据集
    speedData.datasets = speedData.datasets.filter(dataset => {
        if (dataset.threadId && !threadIds.includes(dataset.threadId)) {
            return false; // 移除
        }
        return true; // 保留总流量数据集和存在的线程
    });
}

// ==================== URL列表 ====================

let currentPage = 1;
const pageSize = 50;

// 搜索防抖
let searchTimeout = null;
function debounceSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        resetPageAndLoad();
    }, 300);
}

// 防抖的loadUrls函数
let loadUrlsRequestId = 0; // 用于取消过期的请求

function debouncedLoadUrls() {
    if (loadUrlsTimeout) {
        clearTimeout(loadUrlsTimeout);
    }
    loadUrlsTimeout = setTimeout(() => {
        loadUrls();
    }, 300); // 增加到300ms防抖
}

async function loadUrls() {
    if (!currentTaskId) return;
    
    // 使用请求ID来确保只处理最新的请求
    const currentRequestId = ++loadUrlsRequestId;
    
    const status = document.getElementById('urlStatusFilter').value;
    const prefix = document.getElementById('urlPrefixSearch').value.trim();
    const ext = document.getElementById('urlExtFilter').value;
    
    // 加载所有URL数据（不分页）
    const params = new URLSearchParams({
        page: 1,
        page_size: 10000  // 加载所有数据
    });
    
    if (status) params.append('status', status);
    if (prefix) params.append('prefix', prefix);
    if (ext) params.append('ext', ext);
    
    const url = `${API_BASE}/api/v1/tasks/${currentTaskId}/urls?${params.toString()}`;
    
    try {
        const response = await fetch(url);
        const result = await response.json();
        
        // 检查是否是最新的请求，如果不是则忽略结果
        if (currentRequestId !== loadUrlsRequestId) {
            return;
        }
        
        if (result.success) {
            const urls = result.data.urls || [];
            renderUrlTree(urls);
        } else {
            console.error('Failed to load URLs:', result.error);
        }
    } catch (error) {
        console.error('Failed to load URLs:', error);
    }
}

function renderUrlTree(urls) {
    const treeContainer = document.getElementById('urlTree');
    
    if (urls.length === 0) {
        treeContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>暂无数据</p>
            </div>
        `;
        return;
    }
    
    // 按域名和路径组织URL
    const tree = buildUrlTree(urls);
    
    // 渲染树形结构
    treeContainer.innerHTML = renderTreeNodes(tree);
    
    // 绑定事件
    bindTreeEvents();
}

function buildUrlTree(urls) {
    const tree = {};
    
    urls.forEach(urlData => {
        try {
            const urlObj = new URL(urlData.url);
            const domain = urlObj.hostname;
            const pathParts = urlObj.pathname.split('/').filter(p => p);
            
            // 初始化域名节点
            if (!tree[domain]) {
                tree[domain] = {
                    type: 'domain',
                    name: domain,
                    children: {},
                    urls: []
                };
            }
            
            // 如果没有路径，直接放在域名下
            if (pathParts.length === 0) {
                tree[domain].urls.push(urlData);
            } else {
                // 按路径层级组织，为每个路径部分创建文件夹
                let current = tree[domain].children;
                
                // 为所有路径部分创建文件夹结构
                for (let i = 0; i < pathParts.length; i++) {
                    const part = pathParts[i];
                    if (!current[part]) {
                        current[part] = {
                            type: 'folder',
                            name: part,
                            children: {},
                            urls: []
                        };
                    }
                    
                    // 如果是最后一个路径部分，将URL添加到该文件夹
                    if (i === pathParts.length - 1) {
                        current[part].urls.push(urlData);
                    } else {
                        // 否则继续深入下一级
                        current = current[part].children;
                    }
                }
            }
        } catch (e) {
            // URL解析失败，放在根目录
            if (!tree['其他']) {
                tree['其他'] = {
                    type: 'domain',
                    name: '其他',
                    children: {},
                    urls: []
                };
            }
            tree['其他'].urls.push(urlData);
        }
    });
    
    return tree;
}

function renderTreeNodes(tree, level = 0) {
    let html = '';
    
    for (const key in tree) {
        const node = tree[key];
        const hasChildren = Object.keys(node.children || {}).length > 0 || (node.urls && node.urls.length > 0);
        const urlCount = countUrls(node);
        
        if (node.type === 'domain') {
            // 检查域名节点是否应该展开
            const domainKey = `domain:${node.name}`;
            const isExpanded = expandedNodes.has(domainKey);
            const expandedClass = isExpanded ? ' expanded' : '';
            const folderIcon = isExpanded ? 'fa-folder-open' : 'fa-globe';
            
            // 域名节点
            html += `
                <div class="tree-domain">
                    <div class="tree-domain-header${expandedClass}" data-node-key="${domainKey}" onclick="toggleTreeNode(this)">
                        <span class="tree-node-toggle${expandedClass}"><i class="fas fa-chevron-right"></i></span>
                        <span class="tree-node-icon folder"><i class="fas ${folderIcon}"></i></span>
                        <span class="tree-node-name">${escapeHtml(node.name)}</span>
                        <span class="tree-domain-count">${urlCount} 个文件</span>
                    </div>
                    <div class="tree-node-children${expandedClass}">
                        ${renderTreeChildren(node, node.name)}
                    </div>
                </div>
            `;
        }
    }
    
    return html;
}

function renderTreeChildren(node, parentPath = '') {
    let html = '';
    
    // 先渲染直接的URL
    if (node.urls && node.urls.length > 0) {
        node.urls.forEach(urlData => {
            html += renderFileNode(urlData);
        });
    }
    
    // 再渲染子文件夹
    if (node.children) {
        for (const key in node.children) {
            const child = node.children[key];
            const hasChildren = Object.keys(child.children || {}).length > 0 || (child.urls && child.urls.length > 0);
            
            if (child.type === 'folder') {
                // 构建文件夹的唯一标识
                const folderPath = parentPath ? `${parentPath}/${child.name}` : child.name;
                const folderKey = `folder:${folderPath}`;
                const isExpanded = expandedNodes.has(folderKey);
                const expandedClass = isExpanded ? ' expanded' : '';
                const folderIcon = isExpanded ? 'fa-folder-open' : 'fa-folder';
                
                html += `
                    <div class="tree-node">
                        <div class="tree-node-header${expandedClass}" data-node-key="${folderKey}" onclick="toggleTreeNode(this)">
                            <span class="tree-node-toggle${expandedClass} ${hasChildren ? '' : 'empty'}">
                                <i class="fas fa-chevron-right"></i>
                            </span>
                            <span class="tree-node-icon folder"><i class="fas ${folderIcon}"></i></span>
                            <span class="tree-node-name">${escapeHtml(child.name)}</span>
                            <span class="tree-node-meta">${countUrls(child)} 项</span>
                        </div>
                        <div class="tree-node-children${expandedClass}">
                            ${renderTreeChildren(child, folderPath)}
                        </div>
                    </div>
                `;
            } else {
                // 文件节点
                if (child.urls && child.urls.length > 0) {
                    child.urls.forEach(urlData => {
                        html += renderFileNode(urlData, child.name);
                    });
                }
            }
        }
    }
    
    return html;
}

function renderFileNode(urlData, displayName = null) {
    const icon = getFileIcon(urlData.content_type, urlData.url);
    const iconClass = getFileIconClass(urlData.content_type);
    const name = displayName || getFileName(urlData.url);
    const statusClass = urlData.status || 'pending';
    const statusText = getStatusText(urlData.status || 'pending');
    
    // 检查是否应该展开
    const isExpanded = expandedNodes.has(urlData.url);
    const expandedClass = isExpanded ? ' expanded' : '';
    
    return `
        <div class="tree-node tree-file-node">
            <div class="tree-node-header" data-url="${escapeHtml(urlData.url)}" onclick="toggleFileDetails(this)">
                <span class="tree-node-toggle${expandedClass}"><i class="fas fa-chevron-right"></i></span>
                <span class="tree-node-icon file ${iconClass}"><i class="${icon}"></i></span>
                <span class="tree-node-name">
                    <a href="${escapeHtml(urlData.url)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(name)}</a>
                </span>
                <span class="tree-node-status ${statusClass}">${statusText}</span>
                ${urlData.file_size ? `<span class="tree-node-meta">${formatBytes(urlData.file_size)}</span>` : ''}
            </div>
            <div class="tree-file-details${expandedClass}">
                <div class="file-details-grid">
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-link"></i> URL</span>
                        <span class="detail-value"><a href="${escapeHtml(urlData.url)}" target="_blank">${escapeHtml(urlData.url)}</a></span>
                    </div>
                    ${urlData.title ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-heading"></i> 标题</span>
                        <span class="detail-value">${escapeHtml(urlData.title)}</span>
                    </div>` : ''}
                    ${urlData.author ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-user"></i> 作者</span>
                        <span class="detail-value">${escapeHtml(urlData.author)}</span>
                    </div>` : ''}
                    ${urlData.description ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-align-left"></i> 摘要</span>
                        <span class="detail-value">${escapeHtml(urlData.description)}</span>
                    </div>` : ''}
                    ${urlData.keywords ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-tags"></i> 关键词</span>
                        <span class="detail-value">${escapeHtml(urlData.keywords)}</span>
                    </div>` : ''}
                    ${urlData.publish_time ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-calendar"></i> 发布时间</span>
                        <span class="detail-value">${escapeHtml(urlData.publish_time)}</span>
                    </div>` : ''}
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-layer-group"></i> 深度</span>
                        <span class="detail-value">${urlData.depth}</span>
                    </div>
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-info-circle"></i> 状态</span>
                        <span class="detail-value"><span class="status-badge status-${statusClass}">${statusText}</span></span>
                    </div>
                    ${urlData.status_code ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-server"></i> 状态码</span>
                        <span class="detail-value">${urlData.status_code}</span>
                    </div>` : ''}
                    ${urlData.response_time ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-clock"></i> 响应时间</span>
                        <span class="detail-value">${(urlData.response_time * 1000).toFixed(0)} ms</span>
                    </div>` : ''}
                    ${urlData.file_size ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-file"></i> 文件大小</span>
                        <span class="detail-value">${formatBytes(urlData.file_size)}</span>
                    </div>` : ''}
                    ${urlData.content_type ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-file-alt"></i> 内容类型</span>
                        <span class="detail-value">${escapeHtml(urlData.content_type)}</span>
                    </div>` : ''}
                    ${urlData.created_at ? `
                    <div class="file-detail-item">
                        <span class="detail-label"><i class="fas fa-clock"></i> 爬取时间</span>
                        <span class="detail-value">${formatDateTime(urlData.created_at)}</span>
                    </div>` : ''}
                    <div class="file-detail-item file-actions">
                        <button class="btn btn-sm btn-primary" data-url="${escapeHtml(urlData.url)}" onclick="downloadUrl(this.dataset.url)" title="下载文件">
                            <i class="fas fa-download"></i> 下载
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function toggleFileDetails(header) {
    const toggle = header.querySelector('.tree-node-toggle');
    const details = header.nextElementSibling;
    const url = header.getAttribute('data-url');
    
    const isExpanded = toggle.classList.contains('expanded');
    
    if (isExpanded) {
        // 收起
        toggle.classList.remove('expanded');
        details.classList.remove('expanded');
        expandedNodes.delete(url);
    } else {
        // 展开
        toggle.classList.add('expanded');
        details.classList.add('expanded');
        expandedNodes.add(url);
    }
    // 状态保存在内存中的expandedNodes，刷新时会自动恢复
}

function getFileName(url) {
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        const parts = path.split('/').filter(p => p);
        if (parts.length === 0) return urlObj.hostname;
        let name = parts[parts.length - 1];
        // 添加查询参数提示
        if (urlObj.search) {
            name += ' (带参数)';
        }
        return name || 'index';
    } catch {
        return url.substring(0, 30);
    }
}

function getFileIcon(contentType, url) {
    if (!contentType) {
        // 根据URL扩展名猜测
        if (url.match(/\.(html?|php|asp|jsp)(\?|$)/i)) return 'fas fa-file-code';
        if (url.match(/\.css(\?|$)/i)) return 'fab fa-css3-alt';
        if (url.match(/\.js(\?|$)/i)) return 'fab fa-js-square';
        if (url.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)(\?|$)/i)) return 'fas fa-file-image';
        if (url.match(/\.pdf(\?|$)/i)) return 'fas fa-file-pdf';
        if (url.match(/\.(mp4|webm|avi|mov)(\?|$)/i)) return 'fas fa-file-video';
        if (url.match(/\.(mp3|wav|ogg)(\?|$)/i)) return 'fas fa-file-audio';
        if (url.match(/\.json(\?|$)/i)) return 'fas fa-file-code';
        return 'fas fa-file';
    }
    
    if (contentType.includes('html')) return 'fas fa-file-code';
    if (contentType.includes('css')) return 'fab fa-css3-alt';
    if (contentType.includes('javascript')) return 'fab fa-js-square';
    if (contentType.includes('image')) return 'fas fa-file-image';
    if (contentType.includes('pdf')) return 'fas fa-file-pdf';
    if (contentType.includes('video')) return 'fas fa-file-video';
    if (contentType.includes('audio')) return 'fas fa-file-audio';
    if (contentType.includes('json')) return 'fas fa-file-code';
    if (contentType.includes('xml')) return 'fas fa-file-code';
    return 'fas fa-file';
}

function getFileIconClass(contentType) {
    if (!contentType) return '';
    if (contentType.includes('html')) return 'html';
    if (contentType.includes('css')) return 'css';
    if (contentType.includes('javascript')) return 'js';
    if (contentType.includes('image')) return 'image';
    if (contentType.includes('pdf')) return 'pdf';
    if (contentType.includes('video')) return 'video';
    if (contentType.includes('audio')) return 'audio';
    if (contentType.includes('json')) return 'json';
    return '';
}

function countUrls(node) {
    let count = node.urls ? node.urls.length : 0;
    if (node.children) {
        for (const key in node.children) {
            count += countUrls(node.children[key]);
        }
    }
    return count;
}

function toggleTreeNode(header) {
    const toggle = header.querySelector('.tree-node-toggle');
    const children = header.nextElementSibling;
    
    if (toggle.classList.contains('empty')) return;
    
    const isExpanding = !toggle.classList.contains('expanded');
    
    toggle.classList.toggle('expanded');
    children.classList.toggle('expanded');
    header.classList.toggle('expanded');
    
    // 保存展开状态到expandedNodes
    const nodeKey = header.getAttribute('data-node-key');
    if (nodeKey) {
        if (isExpanding) {
            expandedNodes.add(nodeKey);
        } else {
            expandedNodes.delete(nodeKey);
        }
    }
    
    // 更新文件夹图标
    const folderIcon = header.querySelector('.tree-node-icon.folder i');
    if (folderIcon) {
        if (isExpanding) {
            folderIcon.classList.remove('fa-folder', 'fa-globe');
            folderIcon.classList.add('fa-folder-open');
        } else {
            folderIcon.classList.remove('fa-folder-open');
            // 域名节点用globe图标，文件夹用folder图标
            if (nodeKey && nodeKey.startsWith('domain:')) {
                folderIcon.classList.add('fa-globe');
            } else {
                folderIcon.classList.add('fa-folder');
            }
        }
    }
}

function expandAllNodes() {
    // 展开所有文件夹节点并记录状态
    document.querySelectorAll('.tree-node-toggle:not(.empty)').forEach(toggle => {
        toggle.classList.add('expanded');
    });
    document.querySelectorAll('.tree-node-children').forEach(children => {
        children.classList.add('expanded');
    });
    document.querySelectorAll('.tree-node-icon.folder i.fa-folder, .tree-node-icon.folder i.fa-globe').forEach(icon => {
        icon.classList.remove('fa-folder', 'fa-globe');
        icon.classList.add('fa-folder-open');
    });
    
    // 记录所有文件夹/域名节点的展开状态
    document.querySelectorAll('[data-node-key]').forEach(header => {
        const nodeKey = header.getAttribute('data-node-key');
        if (nodeKey) {
            expandedNodes.add(nodeKey);
            header.classList.add('expanded');
        }
    });
    
    // 展开所有文件详情并记录状态
    document.querySelectorAll('.tree-file-details').forEach(details => {
        details.classList.add('expanded');
        const header = details.previousElementSibling;
        if (header) {
            const toggle = header.querySelector('.tree-node-toggle');
            if (toggle) {
                toggle.classList.add('expanded');
            }
            header.classList.add('expanded');
            const url = header.getAttribute('data-url');
            if (url) {
                expandedNodes.add(url);
            }
        }
    });
}

function collapseAllNodes() {
    // 收起所有文件夹节点
    document.querySelectorAll('.tree-node-toggle').forEach(toggle => {
        toggle.classList.remove('expanded');
    });
    document.querySelectorAll('.tree-node-children').forEach(children => {
        children.classList.remove('expanded');
    });
    document.querySelectorAll('.tree-node-icon.folder i.fa-folder-open').forEach(icon => {
        icon.classList.remove('fa-folder-open');
        icon.classList.add('fa-folder');
    });
    // 恢复域名节点的globe图标
    document.querySelectorAll('.tree-domain-header .tree-node-icon.folder i').forEach(icon => {
        icon.classList.remove('fa-folder-open', 'fa-folder');
        icon.classList.add('fa-globe');
    });
    
    // 移除所有header的expanded类
    document.querySelectorAll('[data-node-key]').forEach(header => {
        header.classList.remove('expanded');
    });
    
    // 收起所有文件详情并清除状态
    document.querySelectorAll('.tree-file-details').forEach(details => {
        details.classList.remove('expanded');
    });
    document.querySelectorAll('.tree-node-header').forEach(header => {
        header.classList.remove('expanded');
    });
    
    expandedNodes.clear();
}

function bindTreeEvents() {
    // 树形结构事件已通过onclick绑定
}

function resetPageAndLoad() {
    console.log('resetPageAndLoad called');
    currentPage = 1;
    debouncedLoadUrls();
}

async function exportUrls() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/export`);
        const result = await response.json();
        
        if (result.success) {
            const dataStr = JSON.stringify(result.data, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `task_${currentTaskId}_urls.json`;
            link.click();
            URL.revokeObjectURL(url);
            
            addLog('URL列表已导出', 'success');
        }
    } catch (error) {
        console.error('Failed to export URLs:', error);
        addLog('导出失败', 'error');
    }
}

// ==================== 数据分析 ====================

async function loadStats() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/stats`);
        const result = await response.json();
        
        if (result.success) {
            updateFileTypeChart(result.data.file_types);
            updateStatusChart(result.data.status_stats);
            // domainCount元素已被删除，不再更新
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

function updateFileTypeChart(fileTypes) {
    if (!fileTypeChart) return;
    
    const labels = fileTypes.map(ft => ft.content_type || 'unknown');
    const data = fileTypes.map(ft => ft.count);
    
    fileTypeChart.data.labels = labels;
    fileTypeChart.data.datasets[0].data = data;
    fileTypeChart.update();
}

function updateStatusChart(statusStats) {
    if (!statusChart) return;
    
    const labels = statusStats.map(s => getStatusText(s.status));
    const data = statusStats.map(s => s.count);
    
    statusChart.data.labels = labels;
    statusChart.data.datasets[0].data = data;
    statusChart.update();
}

// ==================== 图表初始化 ====================

function initCharts() {
    // 总流量图表
    const trafficCtx = document.getElementById('trafficChart');
    if (trafficCtx) {
        trafficChart = new Chart(trafficCtx, {
            type: 'line',
            data: trafficData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'KB'
                        }
                    }
                },
                animation: {
                    duration: 0
                }
            }
        });
    }
    
    // 瞬间流量图表
    const speedCtx = document.getElementById('speedChart');
    if (speedCtx) {
        speedChart = new Chart(speedCtx, {
            type: 'line',
            data: speedData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'KB/s'
                        }
                    }
                },
                animation: {
                    duration: 0
                }
            }
        });
    }
    
    // 文件类型图表
    const fileTypeCtx = document.getElementById('fileTypeChart');
    if (fileTypeCtx) {
        fileTypeChart = new Chart(fileTypeCtx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#4CAF50', '#2196F3', '#FFC107', '#FF5722', 
                        '#9C27B0', '#00BCD4', '#FF9800', '#795548'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }
    
    // 状态图表
    const statusCtx = document.getElementById('statusChart');
    if (statusCtx) {
        statusChart = new Chart(statusCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'URL数量',
                    data: [],
                    backgroundColor: '#2196F3'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
}

// ==================== 标签页切换 ====================

function switchTab(tabName) {
    // 更新标签按钮
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // 更新内容面板
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    
    // 加载对应数据
    if (tabName === 'urls') {
        debouncedLoadUrls();
    } else if (tabName === 'stats') {
        loadStats();
        updateAnalysisCharts();
    }
}

// ==================== 日志管理 ====================

function addLog(message, type = 'info') {
    const logsContent = document.getElementById('logsContent');
    const time = new Date().toLocaleString();
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    logEntry.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="log-message">${escapeHtml(message)}</span>
    `;
    
    logsContent.insertBefore(logEntry, logsContent.firstChild);
    
    // 限制日志数量
    while (logsContent.children.length > 100) {
        logsContent.removeChild(logsContent.lastChild);
    }
}

function clearLogs() {
    const logsContent = document.getElementById('logsContent');
    logsContent.innerHTML = '';
    addLog('日志已清空', 'info');
}

// ==================== 主题切换 ====================

function toggleTheme() {
    const body = document.body;
    const isDark = body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    const icon = document.querySelector('.theme-toggle i');
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
}

function loadTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.querySelector('.theme-toggle i').className = 'fas fa-sun';
    }
}

// ==================== 测试函数 ====================

function testFilters() {
    console.log('Testing filters...');
    const statusFilter = document.getElementById('urlStatusFilter');
    const typeFilter = document.getElementById('urlTypeFilter');
    
    console.log('Status filter:', statusFilter ? statusFilter.value : 'NOT FOUND');
    console.log('Type filter:', typeFilter ? typeFilter.value : 'NOT FOUND');
    
    if (statusFilter && typeFilter) {
        console.log('Filters found, calling resetPageAndLoad...');
        resetPageAndLoad();
    } else {
        console.error('Filters not found!');
    }
}


async function testUrlStatus() {
    console.log('=== Testing URL Status ===');
    if (!currentTaskId) {
        console.log('No task selected');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/urls?page=1&page_size=10`);
        const result = await response.json();
        
        if (result.success) {
            console.log('URL Records:', result.data.urls.map(url => ({
                url: url.url.substring(0, 50) + '...',
                status: url.status,
                depth: url.depth
            })));
            
            const statusCounts = {};
            result.data.urls.forEach(url => {
                statusCounts[url.status] = (statusCounts[url.status] || 0) + 1;
            });
            console.log('Status counts:', statusCounts);
        } else {
            console.error('Failed to load URLs:', result.error);
        }
    } catch (error) {
        console.error('Error testing URL status:', error);
    }
}

async function checkActiveCrawlers() {
    console.log('=== Checking Active Crawlers ===');
    try {
        const response = await fetch(`${API_BASE}/api/v1/debug/active-crawlers`);
        const result = await response.json();
        
        if (result.success) {
            console.log('Active crawlers:', result.active_crawlers);
            console.log('Current task ID:', currentTaskId);
            console.log('Is current task active?', result.active_crawlers.includes(currentTaskId));
            return result.active_crawlers;
        } else {
            console.error('Failed to get active crawlers:', result.error);
            return [];
        }
    } catch (error) {
        console.error('Error checking active crawlers:', error);
        return [];
    }
}

async function forceCleanupTask(taskId) {
    console.log(`=== Force Cleanup Task ${taskId} ===`);
    try {
        const response = await fetch(`${API_BASE}/api/v1/debug/force-cleanup/${taskId}`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            console.log('Cleanup result:', result.message);
            addLog(`任务 ${taskId} 已强制清理`, 'success');
        } else {
            console.error('Cleanup failed:', result.error);
            addLog(`清理失败: ${result.error}`, 'error');
        }
        return result.success;
    } catch (error) {
        console.error('Error cleaning up task:', error);
        addLog(`清理任务失败: ${error.message}`, 'error');
        return false;
    }
}

async function fixZombieTask() {
    console.log('=== Fixing Zombie Task ===');
    
    // 1. 检查活跃爬虫
    const activeCrawlers = await checkActiveCrawlers();
    
    // 2. 如果当前任务在活跃列表中，强制清理
    if (currentTaskId && activeCrawlers.includes(currentTaskId)) {
        console.log(`Task ${currentTaskId} is zombie, cleaning up...`);
        await forceCleanupTask(currentTaskId);
        
        // 3. 重新加载任务列表
        await loadTasks();
        addLog('僵尸任务已清理，请重试操作', 'success');
    } else {
        console.log('No zombie task detected');
        addLog('未检测到僵尸任务', 'info');
    }
}

function testEditForm() {
    console.log('=== Testing Edit Form ===');
    console.log('Current task ID:', currentTaskId);
    
    // 检查表单元素
    const elements = [
        'editTaskId', 'editTaskName', 'editTaskUrl', 'editTaskStrategy',
        'editTaskMaxDepth', 'editTaskThreadCount', 'editTaskInterval',
        'editTaskRetry', 'editTaskCrossDomain'
    ];
    
    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            console.log(`${id}:`, element.value || element.checked);
        } else {
            console.error(`Element not found: ${id}`);
        }
    });
    
    // 测试表单提交
    const form = document.getElementById('editTaskForm');
    if (form) {
        console.log('Form found, testing submit...');
        // 不实际提交，只测试数据收集
        const taskData = {
            name: document.getElementById('editTaskName').value,
            url: document.getElementById('editTaskUrl').value,
            strategy: document.getElementById('editTaskStrategy').value,
            max_depth: parseInt(document.getElementById('editTaskMaxDepth').value),
            thread_count: parseInt(document.getElementById('editTaskThreadCount').value),
            request_interval: parseFloat(document.getElementById('editTaskInterval').value),
            retry_times: parseInt(document.getElementById('editTaskRetry').value),
            allow_cross_domain: document.getElementById('editTaskCrossDomain').checked
        };
        console.log('Collected task data:', taskData);
    } else {
        console.error('Form not found');
    }
}

// ==================== 工具函数 ====================

function formatNumber(num) {
    return num.toLocaleString();
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString();
}

function truncateUrl(url, maxLength) {
    if (!url) return '';
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getStatusText(status) {
    const statusMap = {
        'pending': '待处理',
        'running': '运行中',
        'paused': '已暂停',
        'stopped': '已停止',
        'completed': '已完成',
        'failed': '失败',
        'blocked': '已阻止',
        'robots_blocked': 'Robots禁止'
    };
    return statusMap[status] || status;
}

function getThreadStatusText(status) {
    const statusMap = {
        'idle': '空闲',
        'crawling': '爬取中',
        'paused': '暂停',
        'error': '错误',
        'stopped': '停止'
    };
    return statusMap[status] || status;
}



// 下载URL对应的文件
function downloadUrl(url) {
    try {
        // 从URL中提取文件名
        const urlObj = new URL(url);
        let filename = urlObj.pathname.split('/').pop() || 'download';
        
        // 如果没有扩展名，添加.html
        if (!filename.includes('.')) {
            filename += '.html';
        }
        
        // 通过后端代理下载文件，传递当前任务ID
        const params = new URLSearchParams({
            url: url
        });
        
        if (currentTaskId) {
            params.append('task_id', currentTaskId);
        }
        
        const downloadUrl = `${API_BASE}/api/v1/download?${params.toString()}`;
        
        // 创建一个隐藏的a标签来触发下载
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        addLog(`开始下载: ${filename}`, 'info');
    } catch (error) {
        console.error('Download failed:', error);
        addLog('下载失败', 'error');
    }
}

// ==================== URL列表新功能 ====================

// 刷新URL列表
function refreshUrls() {
    if (!currentTaskId) {
        addLog('请先选择一个任务', 'warning');
        return;
    }
    
    addLog('正在刷新URL列表...', 'info');
    debouncedLoadUrls();
}

// 导出筛选后的URL列表
async function exportFilteredUrls() {
    if (!currentTaskId) {
        addLog('请先选择一个任务', 'warning');
        return;
    }
    
    try {
        const status = document.getElementById('urlStatusFilter').value;
        const prefix = document.getElementById('urlPrefixSearch').value.trim();
        const ext = document.getElementById('urlExtFilter').value;
        
        const params = new URLSearchParams({
            page: 1,
            page_size: 10000  // 获取所有数据
        });
        
        if (status) params.append('status', status);
        if (prefix) params.append('prefix', prefix);
        if (ext) params.append('ext', ext);
        
        const url = `${API_BASE}/api/v1/tasks/${currentTaskId}/urls?${params.toString()}`;
        
        addLog('正在导出筛选结果...', 'info');
        
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success && result.data.urls.length > 0) {
            // 创建CSV内容
            const csvContent = createCSVContent(result.data.urls);
            
            // 下载CSV文件
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const filename = `filtered_urls_task_${currentTaskId}_${new Date().toISOString().slice(0, 10)}.csv`;
            
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            addLog(`导出完成: ${result.data.urls.length} 条记录`, 'success');
        } else {
            addLog('没有符合条件的数据可导出', 'warning');
        }
    } catch (error) {
        console.error('Export failed:', error);
        addLog('导出失败', 'error');
    }
}

// 创建CSV内容
function createCSVContent(urls) {
    const headers = ['URL', '状态', '深度', '状态码', '响应时间(ms)', '文件大小', '内容类型', '标题', '爬取时间'];
    const csvRows = [headers.join(',')];
    
    urls.forEach(url => {
        const row = [
            `"${url.url || ''}"`,
            `"${url.status || ''}"`,
            url.depth || 0,
            url.status_code || '',
            url.response_time ? (url.response_time * 1000).toFixed(0) : '',
            url.file_size || 0,
            `"${url.content_type || ''}"`,
            `"${(url.title || '').replace(/"/g, '""')}"`,
            `"${url.created_at || ''}"`
        ];
        csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
}

// 导出文件压缩包
async function exportFilesZip() {
    if (!currentTaskId) {
        addLog('请先选择一个任务', 'warning');
        return;
    }
    
    try {
        const status = document.getElementById('urlStatusFilter').value;
        const prefix = document.getElementById('urlPrefixSearch').value.trim();
        const ext = document.getElementById('urlExtFilter').value;
        
        const params = new URLSearchParams({
            page: 1,
            page_size: 1000  // 限制数量，避免压缩包过大
        });
        
        if (status) params.append('status', status);
        if (prefix) params.append('prefix', prefix);
        if (ext) params.append('ext', ext);
        
        const url = `${API_BASE}/api/v1/tasks/${currentTaskId}/urls?${params.toString()}`;
        
        addLog('正在获取文件列表...', 'info');
        
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success && result.data.urls.length > 0) {
            const completedUrls = result.data.urls.filter(url => url.status === 'completed');
            
            if (completedUrls.length === 0) {
                addLog('没有已完成的文件可导出', 'warning');
                return;
            }
            
            if (completedUrls.length > 100) {
                if (!confirm(`将要导出 ${completedUrls.length} 个文件，可能需要较长时间。是否继续？`)) {
                    return;
                }
            }
            
            addLog(`开始导出 ${completedUrls.length} 个文件...`, 'info');
            
            // 使用JSZip创建压缩包
            const zip = new JSZip();
            let successCount = 0;
            let failCount = 0;
            
            // 显示进度弹窗
            const progressDiv = document.createElement('div');
            progressDiv.id = 'exportProgressModal';
            progressDiv.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                           background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); 
                               width: 450px; max-width: 90vw; text-align: center;">
                        <h4 style="margin: 0 0 20px 0; color: #333; font-size: 18px;">
                            <i class="fas fa-file-archive" style="color: #4CAF50; margin-right: 8px;"></i>
                            正在导出文件
                        </h4>
                        <div style="width: 100%; height: 24px; background: #f0f0f0; border-radius: 12px; overflow: hidden; margin-bottom: 15px;">
                            <div id="exportProgress" style="height: 100%; background: linear-gradient(90deg, #4CAF50, #45a049); width: 0%; transition: width 0.3s;"></div>
                        </div>
                        <p id="exportStatus" style="margin: 0 0 20px 0; color: #666; font-size: 14px; min-height: 20px; 
                                                           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">准备中...</p>
                        <div style="display: flex; gap: 10px; justify-content: center;">
                            <button id="exportCancelBtn" class="btn btn-secondary" style="padding: 8px 20px;">
                                <i class="fas fa-times"></i> 取消
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(progressDiv);
            
            // 添加取消按钮事件
            let exportCancelled = false;
            document.getElementById('exportCancelBtn').onclick = () => {
                exportCancelled = true;
                document.body.removeChild(progressDiv);
                addLog('导出已取消', 'warning');
            };
            
            // 批量下载文件
            for (let i = 0; i < completedUrls.length; i++) {
                // 检查是否已取消
                if (exportCancelled) {
                    return;
                }
                
                const urlData = completedUrls[i];
                const progress = ((i + 1) / completedUrls.length * 100).toFixed(1);
                
                // 更新进度条和状态
                const progressBar = document.getElementById('exportProgress');
                const statusText = document.getElementById('exportStatus');
                if (progressBar) progressBar.style.width = progress + '%';
                
                // 优化URL显示，提取文件名或域名
                let displayUrl = urlData.url;
                try {
                    const urlObj = new URL(urlData.url);
                    const pathname = urlObj.pathname;
                    const filename = pathname.split('/').pop();
                    if (filename && filename.length > 0) {
                        displayUrl = `${urlObj.hostname}/${filename}`;
                    } else {
                        displayUrl = urlObj.hostname;
                    }
                } catch (e) {
                    // 如果URL解析失败，保持原样但限制长度
                    if (displayUrl.length > 50) {
                        displayUrl = displayUrl.substring(0, 47) + '...';
                    }
                }
                
                if (statusText) {
                    statusText.textContent = `${i + 1}/${completedUrls.length} - ${displayUrl}`;
                    statusText.title = urlData.url; // 鼠标悬停显示完整URL
                }
                
                try {
                    // 通过后端API获取文件内容
                    const fileResponse = await fetch(`${API_BASE}/api/v1/download?url=${encodeURIComponent(urlData.url)}&task_id=${currentTaskId}`);
                    
                    if (fileResponse.ok) {
                        const fileBlob = await fileResponse.blob();
                        
                        // 检查文件是否为空
                        if (fileBlob.size === 0) {
                            console.warn(`Empty file: ${urlData.url}`);
                            failCount++;
                            continue;
                        }
                        
                        // 生成安全的文件名
                        let filename;
                        try {
                            const urlObj = new URL(urlData.url);
                            filename = decodeURIComponent(urlObj.pathname.split('/').pop()) || 'index';
                        } catch (e) {
                            filename = `file_${i}`;
                        }
                        
                        // 清理文件名中的非法字符
                        filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
                        
                        // 如果没有扩展名，根据内容类型添加
                        if (!filename.includes('.')) {
                            if (urlData.content_type) {
                                if (urlData.content_type.includes('html')) filename += '.html';
                                else if (urlData.content_type.includes('json')) filename += '.json';
                                else if (urlData.content_type.includes('javascript')) filename += '.js';
                                else if (urlData.content_type.includes('css')) filename += '.css';
                                else if (urlData.content_type.includes('image')) {
                                    if (urlData.content_type.includes('png')) filename += '.png';
                                    else if (urlData.content_type.includes('jpg') || urlData.content_type.includes('jpeg')) filename += '.jpg';
                                    else if (urlData.content_type.includes('gif')) filename += '.gif';
                                    else filename += '.img';
                                } else filename += '.txt';
                            } else {
                                filename += '.html';
                            }
                        }
                        
                        // 创建文件夹结构
                        let domain, folderPath;
                        try {
                            const urlObj = new URL(urlData.url);
                            domain = urlObj.hostname.replace(/[<>:"/\\|?*]/g, '_');
                            const path = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/')) || '/';
                            folderPath = `${domain}${path}`.replace(/\/+/g, '/').replace(/^\//, '').replace(/[<>:"/\\|?*]/g, '_');
                        } catch (e) {
                            domain = 'unknown_domain';
                            folderPath = domain;
                        }
                        
                        const fullPath = folderPath ? `${folderPath}/${filename}` : filename;
                        
                        zip.file(fullPath, fileBlob);
                        successCount++;
                        console.log(`Added to zip: ${fullPath} (${fileBlob.size} bytes)`);
                    } else {
                        const errorText = await fileResponse.text();
                        console.error(`HTTP ${fileResponse.status} for ${urlData.url}: ${errorText}`);
                        failCount++;
                    }
                } catch (error) {
                    failCount++;
                    console.error(`Error downloading ${urlData.url}:`, error);
                }
                
                // 添加小延迟避免过载
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            // 检查是否已取消
            if (exportCancelled) {
                return;
            }
            
            const statusText = document.getElementById('exportStatus');
            if (statusText) statusText.textContent = '正在生成压缩包...';
            
            // 生成压缩包
            const zipBlob = await zip.generateAsync({type: 'blob'});
            
            // 下载压缩包
            const link = document.createElement('a');
            const filename = `task_${currentTaskId}_files_${new Date().toISOString().slice(0, 10)}.zip`;
            
            link.href = URL.createObjectURL(zipBlob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // 移除进度显示
            if (document.body.contains(progressDiv)) {
                document.body.removeChild(progressDiv);
            }
            
            addLog(`导出完成: ${successCount} 个文件成功，${failCount} 个文件失败`, successCount > 0 ? 'success' : 'warning');
        } else {
            addLog('没有符合条件的数据可导出', 'warning');
        }
    } catch (error) {
        console.error('Export files failed:', error);
        addLog('导出文件失败', 'error');
        
        // 确保移除进度显示
        const progressModal = document.getElementById('exportProgressModal');
        if (progressModal && document.body.contains(progressModal)) {
            document.body.removeChild(progressModal);
        }
    }
}

// ==================== 数据分析新图表 ====================

// 初始化新的图表
function initNewCharts() {
    // 深度分布图表
    const depthCtx = document.getElementById('depthChart');
    if (depthCtx) {
        window.depthChart = new Chart(depthCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'URL数量',
                    data: [],
                    backgroundColor: 'rgba(54, 162, 235, 0.8)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'URL数量'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: '深度'
                        }
                    }
                }
            }
        });
    }
    
    // 文件大小分布图表
    const sizeCtx = document.getElementById('sizeChart');
    if (sizeCtx) {
        window.sizeChart = new Chart(sizeCtx, {
            type: 'pie',
            data: {
                labels: ['< 1KB', '1KB-10KB', '10KB-100KB', '100KB-1MB', '> 1MB'],
                datasets: [{
                    data: [0, 0, 0, 0, 0],
                    backgroundColor: [
                        '#FF6384',
                        '#36A2EB',
                        '#FFCE56',
                        '#4BC0C0',
                        '#9966FF'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }
    
    // 响应时间分布图表
    const responseTimeCtx = document.getElementById('responseTimeChart');
    if (responseTimeCtx) {
        window.responseTimeChart = new Chart(responseTimeCtx, {
            type: 'bar',
            data: {
                labels: ['< 100ms', '100-500ms', '500ms-1s', '1s-5s', '> 5s'],
                datasets: [{
                    label: 'URL数量',
                    data: [0, 0, 0, 0, 0],
                    backgroundColor: 'rgba(255, 99, 132, 0.8)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'URL数量'
                        }
                    }
                }
            }
        });
    }
    
}

// 更新数据分析图表
async function updateAnalysisCharts() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/tasks/${currentTaskId}/analysis`);
        const result = await response.json();
        
        if (result.success) {
            const data = result.data;
            
            // 更新深度分布
            if (window.depthChart && data.depth_distribution) {
                window.depthChart.data.labels = data.depth_distribution.map(d => `深度 ${d.depth}`);
                window.depthChart.data.datasets[0].data = data.depth_distribution.map(d => d.count);
                window.depthChart.update();
            }
            
            // 更新文件大小分布
            if (window.sizeChart && data.size_distribution) {
                window.sizeChart.data.datasets[0].data = data.size_distribution;
                window.sizeChart.update();
            }
            
            // 更新响应时间分布
            if (window.responseTimeChart && data.response_time_distribution) {
                window.responseTimeChart.data.datasets[0].data = data.response_time_distribution;
                window.responseTimeChart.update();
            }
            
        }
    } catch (error) {
        console.error('Failed to update analysis charts:', error);
    }
}

// 刷新数据分析图表
function refreshAnalysisCharts() {
    if (!currentTaskId) {
        addLog('请先选择一个任务', 'warning');
        return;
    }
    
    addLog('正在刷新数据分析...', 'info');
    updateAnalysisCharts();
}
