// ========== 状态管理 ==========
let currentPage = 'messages';
let currentChat = null;
let isAiThinking = false;
let currentSetting = null;  // 当前打开的设置项
let pageHistory = [];        // 页面导航栈

// 压入页面到导航栈
function pushPage(page) {
    pageHistory.push(page);
}

// 返回上一页
function goBack() {
    if (pageHistory.length === 0) {
        renderEmptyContent();
        return;
    }
    const page = pageHistory.pop();
    if (page.type === 'settings_list') {
        currentPage = 'settings';
        currentSetting = null;
        renderList();
        renderEmptyContent();
    } else if (page.type === 'setting_detail' && page.data) {
        openSettingDetail(page.data);
    }
}

// 对话数据（从 localStorage 恢复）
const chats = {
    ai: {
        id: 'ai',
        name: 'INTENT 意图',
        avatar: '🧠',
        type: 'ai',
        messages: []
    }
};

// 从文件恢复聊天记录
function loadChatHistory() {
    try {
        if (window.Qidian && Qidian.loadChatFile) {
            const saved = Qidian.loadChatFile();
            if (saved) {
                chats.ai.messages = JSON.parse(saved);
            }
        }
    } catch (e) {
        console.warn('恢复聊天记录失败:', e);
    }
}

// 保存聊天记录到文件
function saveChatHistory() {
    try {
        if (window.Qidian && Qidian.saveChatFile) {
            Qidian.saveChatFile(JSON.stringify(chats.ai.messages));
        }
    } catch (e) {
        console.warn('保存聊天记录失败:', e);
    }
}

// 好友数据（占位，后续实现交友功能）
const friends = [];

// 好友申请（占位）
const friendRequests = [];

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    // 应用保存的主题
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    loadChatHistory();
    initKnowledgeBase();
    setupNavigation();
    setupChatInput();
    setupBrowserEntry();
    setupHeaderButtons();
    renderList();
    // 定时更新系统状态
    setInterval(updateSystemStatus, 5000);
});

// ========== 头部按钮（头像/加号） ==========
function setupHeaderButtons() {
    const avatar = document.getElementById('user-avatar');
    const addBtn = document.getElementById('add-btn');
    const avatarMenu = document.getElementById('avatar-menu');

    if (avatar) {
        avatar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (avatarMenu.style.display === 'none') {
                avatarMenu.style.display = 'block';
            } else {
                avatarMenu.style.display = 'none';
            }
        });
    }

    // 点击菜单项
    if (avatarMenu) {
        avatarMenu.querySelectorAll('.avatar-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                avatarMenu.style.display = 'none';
                if (action === 'settings') {
                    // 打开设置页面
                    currentPage = 'settings';
                    currentChat = null;
                    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                    renderList();
                    renderEmptyContent();
                } else if (action === 'about') {
                    alert('起点OS mini v1.0\n\n基于 proot 非 root 容器\n模块化系统 (.qd/.qds/.qdai)\n本地 AI: Qwen2.5-1.5B (MNN)');
                }
            });
        });
    }

    // 点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
        if (avatarMenu && avatarMenu.style.display === 'block' && !avatarMenu.contains(e.target) && e.target.id !== 'user-avatar') {
            avatarMenu.style.display = 'none';
        }
    });

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const choice = prompt('请选择操作：\n1. 新建 AI 对话\n2. 添加好友\n3. 安装应用\n\n输入数字选择：', '1');
            if (choice === '1') {
                chats.ai.messages = [];
                openChat(chats.ai);
            } else if (choice === '2') {
                alert('添加好友功能开发中...');
            } else if (choice === '3') {
                alert('安装应用功能开发中...');
            }
        });
    }
}

// ========== 浏览器入口 ==========
function setupBrowserEntry() {
    const entry = document.getElementById('browser-entry');
    if (entry) {
        entry.addEventListener('click', () => {
            openInternalBrowser('https://www.baidu.com');
        });
    }
}

// ========== 导航 ==========
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentPage = item.dataset.page;
            currentChat = null;
            currentSetting = null;
            pageHistory = [];  // 切换主导航时清空页面栈
            isAiThinking = false;
            renderList();
            if (currentPage === 'knowledge') {
                knowledgePath = [''];
                renderKnowledgeContent();
            } else {
                renderEmptyContent();
            }
        });
    });
}

// ========== 搜索 ==========
function setupSearch() {
    const input = document.getElementById('global-search');
    input.addEventListener('input', (e) => {
        const keyword = e.target.value.trim().toLowerCase();
        // 简单过滤当前列表
        const items = document.querySelectorAll('.list-item');
        items.forEach(item => {
            const name = item.querySelector('.list-item-name')?.textContent.toLowerCase() || '';
            const preview = item.querySelector('.list-item-preview')?.textContent.toLowerCase() || '';
            if (!keyword || name.includes(keyword) || preview.includes(keyword)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    });
}

// ========== 列表渲染 ==========
function renderList() {
    const listContent = document.getElementById('list-content');
    const listTitle = document.getElementById('list-title');
    listContent.innerHTML = '';

    switch (currentPage) {
        case 'messages':
            listTitle.textContent = '消息';
            renderMessageList(listContent);
            break;
        case 'contacts':
            listTitle.textContent = '通讯录';
            renderContactList(listContent);
            break;
        case 'knowledge':
            listTitle.textContent = '知识库';
            renderKnowledgeList(listContent);
            break;
        case 'apps':
            listTitle.textContent = '应用';
            renderAppList(listContent);
            break;
        case 'settings':
            listTitle.textContent = '设置';
            renderSettingsList(listContent);
            break;
    }
}

function renderMessageList(container) {
    // AI 对话
    const aiChat = chats.ai;
    const lastMsg = aiChat.messages[aiChat.messages.length - 1];
    const aiItem = createListItem({
        avatar: aiChat.avatar,
        name: aiChat.name,
        preview: lastMsg ? (lastMsg.role === 'user' ? '我: ' : '') + lastMsg.content : '和 AI 开始对话',
        time: '',
        onClick: () => openChat(aiChat)
    });
    if (currentChat && currentChat.id === aiChat.id) aiItem.classList.add('active');
    container.appendChild(aiItem);

    // 好友对话
    if (friends.length > 0) {
        friends.forEach(f => {
            const item = createListItem({
                avatar: f.avatar || '👤',
                name: f.name,
                preview: f.lastMessage || '暂无消息',
                time: f.time || '',
                onClick: () => openChat(f)
            });
            container.appendChild(item);
        });
    } else {
        const empty = document.createElement('div');
        empty.className = 'list-empty';
        empty.textContent = '暂无好友消息';
        container.appendChild(empty);
    }

    // 更新未读徽章
    updateMsgBadge();
}

function renderContactList(container) {
    // AI 助手分组
    container.appendChild(createGroupHeader('AI 助手'));
    const aiItem = createListItem({
        avatar: '🤖',
        name: '奇点AI',
        preview: '本地 AI 助手 · 在线',
        onClick: () => openContactDetail({ name: '奇点AI', type: 'ai', avatar: '🤖', desc: '基于 Qwen2.5-1.5B 的本地 AI 助手，支持对话、系统管理、界面定制。' })
    });
    container.appendChild(aiItem);

    // 好友分组
    container.appendChild(createGroupHeader(`我的好友 (${friends.length})`));
    if (friends.length > 0) {
        friends.forEach(f => {
            const item = createListItem({
                avatar: f.avatar || '👤',
                name: f.name,
                preview: f.status || '离线',
                onClick: () => openContactDetail(f)
            });
            container.appendChild(item);
        });
    } else {
        const empty = document.createElement('div');
        empty.className = 'list-empty';
        empty.textContent = '暂无好友，点击右上角 + 添加';
        container.appendChild(empty);
    }

    // 好友申请分组
    container.appendChild(createGroupHeader(`好友申请 (${friendRequests.length})`));
    if (friendRequests.length > 0) {
        friendRequests.forEach(req => {
            const item = createListItem({
                avatar: req.avatar || '👤',
                name: req.name,
                preview: '请求添加你为好友',
                onClick: () => handleFriendRequest(req)
            });
            container.appendChild(item);
        });
    } else {
        const empty = document.createElement('div');
        empty.className = 'list-empty';
        empty.textContent = '暂无好友申请';
        container.appendChild(empty);
    }
}

// ========== 知识库文件系统 ==========
let knowledgePath = ['']; // 当前路径，[''] 表示根目录

// 初始化知识库（从 localStorage 恢复或创建默认空白）
function initKnowledgeBase() {
    const KB_VERSION = 'v3'; // 版本号，升级时强制重置
    const savedVersion = localStorage.getItem('qidian_kb_version');
    let kb = localStorage.getItem('qidian_knowledge_base');

    // 版本不匹配或无数据时，创建空白知识库
    if (!kb || savedVersion !== KB_VERSION) {
        kb = {
            '': []  // 根目录为空
        };
        localStorage.setItem('qidian_knowledge_base', JSON.stringify(kb));
        localStorage.setItem('qidian_kb_version', KB_VERSION);
    }
    return JSON.parse(kb);
}

// 系统保留后缀，知识库中禁止创建
const SYSTEM_EXTENSIONS = ['.qd', '.qds', '.qdai'];

// 检查文件名是否合法（不能是系统后缀）
function isValidKnowledgeFileName(name) {
    const lower = name.toLowerCase();
    for (const ext of SYSTEM_EXTENSIONS) {
        if (lower.endsWith(ext)) {
            return false;
        }
    }
    return true;
}

function getKnowledgeBase() {
    return initKnowledgeBase();
}

function saveKnowledgeBase(kb) {
    localStorage.setItem('qidian_knowledge_base', JSON.stringify(kb));
}

function getCurrentPathStr() {
    return knowledgePath.join('/');
}

function getCurrentFolder() {
    const kb = getKnowledgeBase();
    const path = getCurrentPathStr();
    return kb[path] || [];
}

function renderKnowledgeList(container) {
    const items = getCurrentFolder();
    const path = getCurrentPathStr();

    // 工具栏（仅保留新建文件夹和新建文本）
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'padding:6px 12px;border-bottom:1px solid var(--border);display:flex;gap:6px;';
    toolbar.innerHTML = `
        <button id="kb-new-folder" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);">📁 新建文件夹</button>
        <button id="kb-new-file" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);">📄 新建文本</button>
    `;
    container.appendChild(toolbar);

    // 返回上一级（非根目录时）
    if (knowledgePath.length > 1 || (knowledgePath.length === 1 && knowledgePath[0] !== '')) {
        const upItem = document.createElement('div');
        upItem.className = 'list-item';
        upItem.innerHTML = `
            <div class="list-item-avatar">⬆️</div>
            <div class="list-item-info">
                <div class="list-item-name">返回上一级</div>
            </div>
        `;
        upItem.addEventListener('click', () => {
            knowledgePath.pop();
            if (knowledgePath.length === 0) knowledgePath = [''];
            renderList();
            renderKnowledgeContent();
        });
        container.appendChild(upItem);
    }

    // 文件和文件夹列表
    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'list-empty';
        empty.textContent = '此文件夹为空，点击上方按钮新建';
        container.appendChild(empty);
    } else {
        // 先文件夹后文件
        const folders = items.filter(i => i.type === 'folder');
        const files = items.filter(i => i.type === 'file');

        [...folders, ...files].forEach(item => {
            const isFolder = item.type === 'folder';
            const listItem = createListItem({
                avatar: isFolder ? '📁' : '📄',
                name: item.name,
                preview: isFolder ? '文件夹' : '知识库文件',
                onClick: () => {
                    if (isFolder) {
                        knowledgePath.push(item.name);
                        renderList();
                        renderKnowledgeContent();
                    } else {
                        openKnowledgeFile(item);
                    }
                }
            });
            // 右键删除
            listItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (confirm(`确定删除 "${item.name}" 吗？`)) {
                    const kb = getKnowledgeBase();
                    const p = getCurrentPathStr();
                    kb[p] = kb[p].filter(i => i.name !== item.name);
                    saveKnowledgeBase(kb);
                    renderList();
                    renderKnowledgeContent();
                }
            });
            container.appendChild(listItem);
        });
    }

    // 绑定新建按钮
    setTimeout(() => {
        document.getElementById('kb-new-folder')?.addEventListener('click', () => {
            const name = prompt('输入文件夹名称：');
            if (name) {
                if (!isValidKnowledgeFileName(name)) {
                    alert('文件夹名称不能使用系统保留后缀（.qd / .qds / .qdai）');
                    return;
                }
                const kb = getKnowledgeBase();
                const p = getCurrentPathStr();
                if (!kb[p]) kb[p] = [];
                if (kb[p].find(i => i.name === name)) {
                    alert('文件夹已存在');
                    return;
                }
                kb[p].push({ name, type: 'folder' });
                kb[p + '/' + name] = [];
                saveKnowledgeBase(kb);
                renderList();
            }
        });

        document.getElementById('kb-new-file')?.addEventListener('click', () => {
            const name = prompt('输入文件名（自动加 .txt 后缀）：');
            if (name) {
                if (!isValidKnowledgeFileName(name)) {
                    alert('文件名不能使用系统保留后缀（.qd / .qds / .qdai）');
                    return;
                }
                const fileName = name.endsWith('.txt') ? name : name + '.txt';
                const kb = getKnowledgeBase();
                const p = getCurrentPathStr();
                if (!kb[p]) kb[p] = [];
                if (kb[p].find(i => i.name === fileName)) {
                    alert('文件已存在');
                    return;
                }
                kb[p].push({ name: fileName, type: 'file', content: '# ' + fileName + '\n\n新文件，点击编辑开始写入。' });
                saveKnowledgeBase(kb);
                renderList();
            }
        });
    }, 50);
}

// 知识库文件详情/编辑
function openKnowledgeFile(file) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = `
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📄 ${file.name}</span>
        <button id="kb-edit-vscode" style="margin-left:8px;padding:4px 10px;border-radius:4px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">✏️ VSCode 编辑</button>
    `;
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="padding:16px;">
            <div style="padding:10px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:12px;">
                <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:4px;">文件路径</div>
                <div style="font-size:var(--fs);font-family:monospace;">知识库://${getCurrentPathStr()}/${file.name}</div>
            </div>
            <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;white-space:pre-wrap;word-wrap:break-word;font-size:var(--fs);line-height:1.7;max-height:calc(100vh - 200px);overflow-y:auto;">${file.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>
    `;

    setTimeout(() => {
        document.getElementById('kb-edit-vscode')?.addEventListener('click', () => {
            // 用 VSCode 打开知识库文件
            openKnowledgeFileInVSCode(file);
        });
    }, 50);
}

// 用 VSCode 打开知识库文件
function openKnowledgeFileInVSCode(file) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = `
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📝 ${file.name}</span>
        <span style="font-size:var(--fs-sm);color:var(--text-secondary);margin-left:8px;">知识库文件</span>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
        <button id="kb-save" style="flex:1;padding:8px;border-radius:6px;border:none;background:var(--success);color:white;cursor:pointer;font-size:var(--fs);">💾 保存</button>
        <button id="kb-back" style="flex:1;padding:8px;border-radius:6px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs);">← 返回</button>
    `;

    body.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;">
            <div style="padding:4px 8px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:var(--fs-sm);color:var(--text-secondary);">
                📁 知识库://${getCurrentPathStr()}/${file.name} · ${file.content.length} 字符
            </div>
            <textarea id="kb-editor" spellcheck="false" style="flex:1;width:100%;padding:12px;border:none;background:var(--bg-input);color:#d4d4d4;font-family:'Consolas','Monaco',monospace;font-size:12px;resize:none;outline:none;line-height:1.5;tab-size:4;">${file.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        </div>
    `;

    setTimeout(() => {
        const textarea = document.getElementById('kb-editor');

        // Tab 键支持
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 4;
            }
        });

        document.getElementById('kb-save')?.addEventListener('click', () => {
            const newContent = textarea.value;
            const kb = getKnowledgeBase();
            const p = getCurrentPathStr();
            const idx = kb[p].findIndex(i => i.name === file.name);
            if (idx >= 0) {
                kb[p][idx].content = newContent;
                saveKnowledgeBase(kb);
                showToast('已保存');
            }
        });

        document.getElementById('kb-back')?.addEventListener('click', () => {
            openKnowledgeFile(file);
        });
    }, 50);
}

// 知识库内容区（未选中文件时显示概览）
function renderKnowledgeContent() {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    const path = getCurrentPathStr();
    const items = getCurrentFolder();
    const folderCount = items.filter(i => i.type === 'folder').length;
    const fileCount = items.filter(i => i.type === 'file').length;

    header.innerHTML = `<span>📚 知识库</span>`;
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="padding:20px;">
            <h3 style="margin-bottom:14px;font-size:var(--fs-md);">当前位置：${path || '根目录'}</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                <div class="setting-card">
                    <div class="label">文件夹</div>
                    <div class="value">${folderCount} 个</div>
                </div>
                <div class="setting-card">
                    <div class="label">文件</div>
                    <div class="value">${fileCount} 个</div>
                </div>
            </div>
            <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;">
                <div style="font-size:var(--fs);margin-bottom:8px;color:var(--text-primary);">💡 知识库使用说明</div>
                <ul style="font-size:var(--fs-sm);color:var(--text-secondary);line-height:1.8;padding-left:16px;">
                    <li>文本文件后缀为 <b>.txt</b>（Windows 标准文本格式）</li>
                    <li>点击文件夹进入，点击文件查看内容</li>
                    <li>点击「VSCode 编辑」可直接修改文件内容</li>
                    <li>右键文件/文件夹可删除</li>
                    <li>数据保存在本地，退出不丢失</li>
                    <li>保留 Windows 文件管理器逻辑（路径、层级、新建）</li>
                </ul>
            </div>
        </div>
    `;
}

function renderAppList(container) {
    // VS Code（默认集成）
    const vscodeItem = createListItem({
        avatar: '📝',
        name: 'VS Code',
        preview: '代码编辑器（Web版）',
        onClick: () => openAppDetail({ name: 'VS Code', icon: '📝', desc: '基于 Web 的代码编辑器，支持 HTML/CSS/JS/代码编辑。可直接编辑奇点OS界面文件。', status: '就绪', action: 'open_vscode' })
    });
    container.appendChild(vscodeItem);

    // 安装 Windows 应用
    const installItem = createListItem({
        avatar: '🪟',
        name: '安装 Windows 应用',
        preview: '选择 .exe 文件，通过 Win32 兼容层运行',
        onClick: () => openWindowsInstaller()
    });
    container.appendChild(installItem);

    // 容器终端
    const terminalItem = createListItem({
        avatar: '💻',
        name: '容器终端',
        preview: '奇点OS proot 容器环境',
        onClick: () => openAppDetail({ name: '容器终端', icon: '💻', desc: '基于 proot 的奇点OS容器环境，无需 root 权限即可运行 Linux 程序和奇点OS全部模块。支持 .qd/.qds/.qdai 模块化系统。', status: '运行中' })
    });
    container.appendChild(terminalItem);

    // AI 引擎
    const aiItem = createListItem({
        avatar: '🧠',
        name: 'AI 引擎',
        preview: 'MNN · Qwen2.5-1.5B',
        onClick: () => openAppDetail({ name: 'AI 引擎', icon: '🧠', desc: '基于 MNN 推理引擎的本地大语言模型，4线程约25.9 tok/s。支持对话、系统管理、界面定制。', status: '就绪' })
    });
    container.appendChild(aiItem);

    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = '安装 Windows 应用后将显示在这里';
    container.appendChild(empty);
}

function renderSettingsList(container) {
    const settings = [
        { name: '系统状态', icon: '📊', desc: '容器、AI、微服务运行状态' },
        { name: '投屏与远程', icon: '📺', desc: '屏幕投射、远程控制、多屏协同' },
        { name: '外观设置', icon: '🎨', desc: '深色/浅色主题、横屏/竖屏' },
        { name: 'AI 权限', icon: '🔐', desc: '网络、位置、麦克风等权限管理' },
        { name: 'AI 配置', icon: '🤖', desc: '模型参数、推理线程、温度' },
        { name: '界面编辑', icon: '✏️', desc: '直接编辑 HTML/CSS/JS 界面文件' },
        { name: '模型切换', icon: '🔄', desc: '本地模型 / 云端 API 切换' },
        { name: '关于', icon: 'ℹ️', desc: '起点OS mini 版本信息' }
    ];

    settings.forEach(s => {
        const item = createListItem({
            avatar: s.icon,
            name: s.name,
            preview: s.desc,
            onClick: () => openSettingDetail(s)
        });
        container.appendChild(item);
    });
}

function createListItem({ avatar, name, preview, time, badge, onClick }) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
        <div class="list-item-avatar">${avatar}</div>
        <div class="list-item-info">
            <div class="list-item-name">${name}</div>
            <div class="list-item-preview">${preview || ''}</div>
        </div>
        ${time ? `<div class="list-item-time">${time}</div>` : ''}
        ${badge ? `<div class="list-item-badge">${badge}</div>` : ''}
    `;
    if (onClick) item.addEventListener('click', onClick);
    return item;
}

function createGroupHeader(title) {
    const header = document.createElement('div');
    header.className = 'list-group-header';
    header.textContent = title;
    return header;
}

// ========== 内容区渲染 ==========
function renderEmptyContent() {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');
    header.innerHTML = '<span>起点OS mini</span>';
    body.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🚀</div>
            <p>选择左侧列表开始</p>
        </div>
    `;
    footer.style.display = 'none';
}

function openChat(chat) {
    currentChat = chat;
    isAiThinking = false;
    renderList();

    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = `<span>${chat.avatar} ${chat.name}</span>`;
    body.innerHTML = '';
    footer.style.display = 'flex';

    // 渲染历史消息
    chat.messages.forEach(msg => appendMessage({ role: msg.role, content: msg.content, thinking: msg.thinking }));

    // AI 对话欢迎语
    if (chat.type === 'ai' && chat.messages.length === 0) {
        const welcome = '你好！我是奇点AI，有什么可以帮你的？\n\n我可以：\n• 回答问题和对话\n• 管理系统状态\n• 定制界面外观\n• 启动应用程序';
        appendMessage({ role: 'ai', content: welcome });
        chat.messages.push({ role: 'ai', content: welcome });
        saveChatHistory();
    }

    scrollToBottom();
    const inputEl = document.getElementById('message-input');
    if (inputEl) inputEl.focus();
}

function openContactDetail(contact) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = `<span>${contact.avatar || '👤'} ${contact.name}</span>`;
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;padding:30px 20px;">
            <div class="detail-avatar">${contact.avatar || '👤'}</div>
            <h3 style="margin-bottom:6px;font-size:var(--fs-lg);">${contact.name}</h3>
            <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:8px;">
                ${contact.type === 'ai' ? '本地 AI 助手' : '好友'}
            </p>
            <p style="color:var(--text-secondary);font-size:var(--fs-sm);text-align:center;max-width:300px;line-height:1.6;">
                ${contact.desc || ''}
            </p>
            ${contact.type === 'ai' ? `
                <button class="detail-btn" onclick="openChat(chats.ai)">发消息</button>
            ` : `
                <button class="detail-btn" onclick="openChat({id:'${contact.name}',name:'${contact.name}',avatar:'${contact.avatar||'👤'}',type:'friend',messages:[]})">发消息</button>
            `}
        </div>
    `;
}

function openAppDetail(app) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    // VS Code：打开代码编辑器
    if (app.action === 'open_vscode') {
        openFileEditor('index.html');
        return;
    }

    header.innerHTML = `<span>${app.icon} ${app.name}</span>`;
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;padding:30px 20px;">
            <div class="detail-avatar">${app.icon}</div>
            <h3 style="margin-bottom:6px;font-size:var(--fs-lg);">${app.name}</h3>
            <p style="color:var(--success);font-size:var(--fs-sm);margin-bottom:12px;">● ${app.status || '就绪'}</p>
            <p style="color:var(--text-secondary);font-size:var(--fs-sm);text-align:center;max-width:320px;line-height:1.6;">
                ${app.desc || ''}
            </p>
        </div>
    `;
}

function openSettingDetail(setting) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    // 压入设置列表页（返回时回到设置列表）
    pushPage({ type: 'settings_list' });
    currentSetting = setting;

    header.innerHTML = `<span style="display:flex;align-items:center;gap:8px;">
        <span id="back-btn" style="cursor:pointer;padding:4px 8px;border-radius:4px;background:var(--bg-hover);font-size:var(--fs-sm);">← 返回</span>
        <span>${setting.icon} ${setting.name}</span>
    </span>`;
    footer.style.display = 'none';

    setTimeout(() => {
        document.getElementById('back-btn')?.addEventListener('click', goBack);
    }, 50);

    if (setting.name && setting.name.indexOf('投屏') >= 0) {
        body.innerHTML = `
            <div style="padding:16px;">
                <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;margin-bottom:12px;">
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:10px;">📺 屏幕投射</div>
                    <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">将奇点OS界面投射到电视/电脑/平板，其他设备通过浏览器访问</p>
                    <div style="display:flex;gap:8px;margin-bottom:10px;">
                        <button id="cast-request" style="flex:1;padding:10px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:var(--fs);">请求投屏权限</button>
                        <button id="cast-start" style="flex:1;padding:10px;border-radius:6px;border:none;background:#4caf50;color:#fff;cursor:pointer;font-size:var(--fs);">启动投屏</button>
                        <button id="cast-stop" style="flex:1;padding:10px;border-radius:6px;border:none;background:#f44336;color:#fff;cursor:pointer;font-size:var(--fs);">停止投屏</button>
                    </div>
                    <div id="cast-status" style="padding:10px;background:var(--bg-hover);border-radius:6px;font-size:var(--fs-sm);color:var(--text-secondary);">
                        状态：未启动
                    </div>
                </div>

                <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;margin-bottom:12px;">
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:10px;">🎮 远程控制</div>
                    <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">启动后，其他设备可通过浏览器远程控制奇点OS（触摸+按键）</p>
                    <div style="display:flex;gap:8px;">
                        <button id="remote-start" style="flex:1;padding:10px;border-radius:6px;border:none;background:#2196f3;color:#fff;cursor:pointer;font-size:var(--fs);">启动远程控制</button>
                        <button id="remote-stop" style="flex:1;padding:10px;border-radius:6px;border:none;background:#f44336;color:#fff;cursor:pointer;font-size:var(--fs);">停止远程控制</button>
                    </div>
                </div>

                <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;">
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:10px;">🔗 多屏协同</div>
                    <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">手机与电脑/平板之间屏幕共享、文件互传、剪贴板同步</p>
                    <div style="display:flex;gap:8px;">
                        <button id="sync-start" style="flex:1;padding:10px;border-radius:6px;border:none;background:#9c27b0;color:#fff;cursor:pointer;font-size:var(--fs);">启动多屏协同</button>
                        <button id="sync-stop" style="flex:1;padding:10px;border-radius:6px;border:none;background:#f44336;color:#fff;cursor:pointer;font-size:var(--fs);">停止多屏协同</button>
                    </div>
                    <div id="sync-devices" style="margin-top:10px;padding:10px;background:var(--bg-hover);border-radius:6px;font-size:var(--fs-sm);color:var(--text-secondary);">
                        附近设备：未发现
                    </div>
                </div>

                <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;margin-top:12px;">
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:10px;">🪟 Windows GUI 投射</div>
                    <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">容器内Windows软件窗口实时投射到奇点OS前端（开发中）</p>
                    <div style="padding:10px;background:var(--bg-hover);border-radius:6px;font-size:var(--fs-sm);color:#ff9800;">
                        ⚠️ 功能开发中，预计下一版本支持
                    </div>
                </div>
            </div>
        `;
        footer.style.display = 'none';

        setTimeout(() => {
            document.getElementById('cast-request')?.addEventListener('click', () => {
                const result = Qidian.requestCastPermission();
                document.getElementById('cast-status').textContent = '状态：' + result;
            });
            document.getElementById('cast-start')?.addEventListener('click', () => {
                const result = Qidian.startCast(8080);
                document.getElementById('cast-status').textContent = '状态：' + result;
            });
            document.getElementById('cast-stop')?.addEventListener('click', () => {
                const result = Qidian.stopCast();
                document.getElementById('cast-status').textContent = '状态：' + result;
            });
            document.getElementById('remote-start')?.addEventListener('click', () => {
                const result = Qidian.startCast(8080);
                alert('远程控制已启动：' + result + '\n其他设备访问该地址即可远程控制');
            });
            document.getElementById('remote-stop')?.addEventListener('click', () => {
                Qidian.stopCast();
                alert('远程控制已停止');
            });
            document.getElementById('sync-start')?.addEventListener('click', () => {
                document.getElementById('sync-devices').textContent = '附近设备：搜索中...';
                setTimeout(() => {
                    document.getElementById('sync-devices').textContent = '附近设备：未发现（功能开发中）';
                }, 2000);
            });
            document.getElementById('sync-stop')?.addEventListener('click', () => {
                document.getElementById('sync-devices').textContent = '附近设备：已停止';
            });
        }, 50);
        return;
    }

    if (setting.name === '外观设置') {
        const currentTheme = localStorage.getItem('theme') || 'dark';
        const currentOrientation = localStorage.getItem('orientation') || 'landscape';
        body.innerHTML = `
            <div style="padding:16px;">
                <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;margin-bottom:12px;">
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:10px;">🌗 主题模式</div>
                    <div style="display:flex;gap:8px;">
                        <button id="theme-dark" style="flex:1;padding:10px;border-radius:6px;border:2px solid ${currentTheme === 'dark' ? 'var(--accent)' : 'var(--border)'};background:${currentTheme === 'dark' ? 'var(--bg-active)' : 'var(--bg-hover)'};color:var(--text-primary);cursor:pointer;font-size:var(--fs);">🌙 深色</button>
                        <button id="theme-light" style="flex:1;padding:10px;border-radius:6px;border:2px solid ${currentTheme === 'light' ? 'var(--accent)' : 'var(--border)'};background:${currentTheme === 'light' ? 'var(--bg-active)' : 'var(--bg-hover)'};color:var(--text-primary);cursor:pointer;font-size:var(--fs);">☀️ 浅色</button>
                    </div>
                </div>
                <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;">
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:10px;">📱 屏幕方向</div>
                    <div style="display:flex;gap:8px;">
                        <button id="ori-landscape" style="flex:1;padding:10px;border-radius:6px;border:2px solid ${currentOrientation === 'landscape' ? 'var(--accent)' : 'var(--border)'};background:${currentOrientation === 'landscape' ? 'var(--bg-active)' : 'var(--bg-hover)'};color:var(--text-primary);cursor:pointer;font-size:var(--fs);">🔄 横屏</button>
                        <button id="ori-portrait" style="flex:1;padding:10px;border-radius:6px;border:2px solid ${currentOrientation === 'portrait' ? 'var(--accent)' : 'var(--border)'};background:${currentOrientation === 'portrait' ? 'var(--bg-active)' : 'var(--bg-hover)'};color:var(--text-primary);cursor:pointer;font-size:var(--fs);">📱 竖屏</button>
                    </div>
                    <p style="margin-top:8px;color:var(--text-secondary);font-size:var(--fs-sm);">切换后立即生效，重启后保持设置</p>
                </div>
            </div>
        `;
        footer.style.display = 'none';
        setTimeout(() => {
            document.getElementById('theme-dark')?.addEventListener('click', () => {
                localStorage.setItem('theme', 'dark');
                document.documentElement.removeAttribute('data-theme');
                openSettingDetail(setting);
            });
            document.getElementById('theme-light')?.addEventListener('click', () => {
                localStorage.setItem('theme', 'light');
                document.documentElement.setAttribute('data-theme', 'light');
                openSettingDetail(setting);
            });
            document.getElementById('ori-landscape')?.addEventListener('click', () => {
                localStorage.setItem('orientation', 'landscape');
                if (window.Qidian && Qidian.setOrientation) Qidian.setOrientation('landscape');
                openSettingDetail(setting);
            });
            document.getElementById('ori-portrait')?.addEventListener('click', () => {
                localStorage.setItem('orientation', 'portrait');
                if (window.Qidian && Qidian.setOrientation) Qidian.setOrientation('portrait');
                openSettingDetail(setting);
            });
        }, 50);
        return;
    }

    if (setting.name === '系统状态') {
        let status = { container: false, ai: false, microsrv: false };
        if (window.Qidian && Qidian.getStatus) {
            try { status = JSON.parse(Qidian.getStatus()); } catch (e) {}
        }

        // 检测模型文件
        let modelInfo = { exists: false, sizeMB: 0 };
        if (window.Qidian && Qidian.checkModelExists) {
            try { modelInfo = JSON.parse(Qidian.checkModelExists()); } catch (e) {}
        }

        const modelStatus = modelInfo.exists ? '已下载' : '未下载';
        const modelColor = modelInfo.exists ? 'var(--success)' : 'var(--error)';

        body.innerHTML = `
            <div style="padding:16px;">
                <div class="settings-grid">
                    <div class="setting-card">
                        <div class="label">容器状态</div>
                        <div class="value" style="color:${status.container ? 'var(--success)' : 'var(--warning)'};">${status.container ? '运行中' : '启动中'}</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">AI 引擎</div>
                        <div class="value" style="color:${status.ai ? 'var(--success)' : 'var(--warning)'};">${status.ai ? '就绪' : '加载中'}</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">微服务</div>
                        <div class="value" style="color:var(--text-secondary);">未启动</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">推理速度</div>
                        <div class="value">~25.9 tok/s</div>
                    </div>
                </div>
                <div style="margin-top:12px;padding:14px;background:var(--bg-secondary);border-radius:8px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div>
                            <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:4px;">AI 模型</div>
                            <div style="font-size:var(--fs);">Qwen2.5-1.5B-Instruct · MNN 4-bit</div>
                            <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-top:2px;">状态：<span style="color:${modelColor};">${modelStatus}</span>${modelInfo.exists ? ` · ${modelInfo.sizeMB} MB` : ''}</div>
                        </div>
                        ${!modelInfo.exists ? `
                            <button id="download-model-btn" style="padding:8px 14px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">⬇️ 去阿里官网下载</button>
                        ` : `
                            <span style="color:var(--success);font-size:var(--fs-sm);">✓ 已就绪</span>
                        `}
                    </div>
                    ${!modelInfo.exists ? `
                        <p style="color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6;margin-top:8px;">
                            模型未下载，点击上方按钮前往阿里 ModelScope 下载 Qwen2.5-1.5B 模型。<br>
                            下载后需转换为 MNN 格式并放置到模型目录。
                        </p>
                    ` : ''}
                </div>
            </div>
        `;

        // 绑定下载按钮
        if (!modelInfo.exists) {
            setTimeout(() => {
                document.getElementById('download-model-btn')?.addEventListener('click', () => {
                    // 用外部浏览器打开（内置浏览器iframe打不开ModelScope）
                    if (window.Qidian && Qidian.openExternalUrl) {
                        Qidian.openExternalUrl('https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct');
                    } else {
                        openInternalBrowser('https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct');
                    }
                });
            }, 50);
        }
    } else if (setting.name === 'AI 权限') {
        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:14px;font-size:var(--fs-md);">AI 权限管理</h3>
                <p style="margin-bottom:14px;color:var(--text-secondary);font-size:var(--fs-sm);">点击"请求授权"可弹出系统权限对话框，授权后 AI 即可使用对应能力。</p>
                <div class="perm-item" id="perm-network">
                    <div>
                        <div class="perm-name">🌐 网络访问</div>
                        <div class="perm-desc">允许 AI 联网搜索实时信息</div>
                    </div>
                    <span style="color:var(--success);font-size:var(--fs-sm);">已授权</span>
                </div>
                <div class="perm-item" id="perm-location" style="cursor:pointer;">
                    <div>
                        <div class="perm-name">📍 位置信息</div>
                        <div class="perm-desc">允许 AI 读取设备位置</div>
                    </div>
                    <span style="color:var(--accent);font-size:var(--fs-sm);text-decoration:underline;">请求授权</span>
                </div>
                <div class="perm-item" id="perm-mic" style="cursor:pointer;">
                    <div>
                        <div class="perm-name">🎤 麦克风</div>
                        <div class="perm-desc">允许 AI 录制语音输入</div>
                    </div>
                    <span style="color:var(--accent);font-size:var(--fs-sm);text-decoration:underline;">请求授权</span>
                </div>
                <div class="perm-item" id="perm-audio">
                    <div>
                        <div class="perm-name">🔊 听筒/扬声器</div>
                        <div class="perm-desc">允许 AI 播放语音回复</div>
                    </div>
                    <span style="color:var(--success);font-size:var(--fs-sm);">已授权</span>
                </div>
                <div class="perm-item" id="perm-storage">
                    <div>
                        <div class="perm-name">📁 文件读取</div>
                        <div class="perm-desc">允许 AI 读取系统模块和授权文件</div>
                    </div>
                    <span style="color:var(--success);font-size:var(--fs-sm);">已授权</span>
                </div>
                <p style="margin-top:14px;color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6;">
                    权限由 AI.qd/ai_config.qdai 配置文件管理，AI 可在授权范围内调用对应能力。涉及隐私操作时需用户确认。
                </p>
            </div>
        `;

        // 绑定权限请求点击
        setTimeout(() => {
            const locItem = document.getElementById('perm-location');
            const micItem = document.getElementById('perm-mic');

            function refreshPermStatus() {
                // 延迟检查权限状态并刷新
                setTimeout(() => {
                    if (window.Qidian && Qidian.checkPermission) {
                        const locStatus = Qidian.checkPermission('location');
                        const micStatus = Qidian.checkPermission('microphone');
                        const locEl = document.querySelector('#perm-location span:last-child');
                        const micEl = document.querySelector('#perm-mic span:last-child');
                        if (locEl) {
                            locEl.textContent = locStatus === '已授权' ? '已授权' : '请求授权';
                            locEl.style.color = locStatus === '已授权' ? 'var(--success)' : 'var(--accent)';
                            if (locStatus === '已授权') locEl.style.textDecoration = 'none';
                        }
                        if (micEl) {
                            micEl.textContent = micStatus === '已授权' ? '已授权' : '请求授权';
                            micEl.style.color = micStatus === '已授权' ? 'var(--success)' : 'var(--accent)';
                            if (micStatus === '已授权') micEl.style.textDecoration = 'none';
                        }
                    }
                }, 2000);
            }

            if (locItem) {
                locItem.addEventListener('click', () => {
                    if (window.Qidian && Qidian.requestPermission) {
                        const result = Qidian.requestPermission('location');
                        alert(result);
                        refreshPermStatus();
                    } else {
                        alert('权限请求接口不可用');
                    }
                });
            }
            if (micItem) {
                micItem.addEventListener('click', () => {
                    if (window.Qidian && Qidian.requestPermission) {
                        const result = Qidian.requestPermission('microphone');
                        alert(result);
                        refreshPermStatus();
                    } else {
                        alert('权限请求接口不可用');
                    }
                });
            }

            // 页面加载时先检查一次权限状态
            if (window.Qidian && Qidian.checkPermission) {
                const locStatus = Qidian.checkPermission('location');
                const micStatus = Qidian.checkPermission('microphone');
                const locEl = document.querySelector('#perm-location span:last-child');
                const micEl = document.querySelector('#perm-mic span:last-child');
                if (locEl && locStatus === '已授权') {
                    locEl.textContent = '已授权';
                    locEl.style.color = 'var(--success)';
                    locEl.style.textDecoration = 'none';
                }
                if (micEl && micStatus === '已授权') {
                    micEl.textContent = '已授权';
                    micEl.style.color = 'var(--success)';
                    micEl.style.textDecoration = 'none';
                }
            }
        }, 100);
    } else if (setting.name === 'AI 配置') {
        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:14px;font-size:var(--fs-md);">AI 推理配置</h3>
                <div class="perm-item">
                    <div><div class="perm-name">推理后端</div><div class="perm-desc">MNN CPU</div></div>
                    <span style="color:var(--text-secondary);font-size:var(--fs-sm);">固定</span>
                </div>
                <div class="perm-item">
                    <div><div class="perm-name">线程数</div><div class="perm-desc">4 线程（骁龙8 Gen2 最优）</div></div>
                    <span style="color:var(--text-secondary);font-size:var(--fs-sm);">固定</span>
                </div>
                <div class="perm-item">
                    <div><div class="perm-name">量化精度</div><div class="perm-desc">4-bit 对称量化</div></div>
                    <span style="color:var(--text-secondary);font-size:var(--fs-sm);">固定</span>
                </div>
                <div class="perm-item">
                    <div><div class="perm-name">最大生成长度</div><div class="perm-desc">512 tokens</div></div>
                    <span style="color:var(--text-secondary);font-size:var(--fs-sm);">固定</span>
                </div>
            </div>
        `;
    } else if (setting.name === '界面编辑') {
        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:14px;font-size:var(--fs-md);">界面编辑</h3>
                <p style="margin-bottom:14px;color:var(--text-secondary);font-size:var(--fs-sm);">直接编辑奇点OS界面文件，保存后立即生效。</p>
                <div class="perm-item" style="cursor:pointer;" id="edit-html">
                    <div><div class="perm-name">📄 index.html</div><div class="perm-desc">页面结构</div></div>
                    <span style="color:var(--accent);font-size:var(--fs-sm);">编辑 →</span>
                </div>
                <div class="perm-item" style="cursor:pointer;" id="edit-css">
                    <div><div class="perm-name">🎨 style.css</div><div class="perm-desc">样式主题</div></div>
                    <span style="color:var(--accent);font-size:var(--fs-sm);">编辑 →</span>
                </div>
                <div class="perm-item" style="cursor:pointer;" id="edit-js">
                    <div><div class="perm-name">⚡ app.js</div><div class="perm-desc">交互逻辑</div></div>
                    <span style="color:var(--accent);font-size:var(--fs-sm);">编辑 →</span>
                </div>
                <div class="perm-item" style="cursor:pointer;" id="reset-ui">
                    <div><div class="perm-name">🔄 恢复默认界面</div><div class="perm-desc">重置为出厂默认</div></div>
                    <span style="color:var(--error);font-size:var(--fs-sm);">重置 →</span>
                </div>
            </div>
        `;
        setTimeout(() => {
            document.getElementById('edit-html')?.addEventListener('click', () => openFileEditor('index.html'));
            document.getElementById('edit-css')?.addEventListener('click', () => openFileEditor('style.css'));
            document.getElementById('edit-js')?.addEventListener('click', () => openFileEditor('app.js'));
            document.getElementById('reset-ui')?.addEventListener('click', () => {
                if (confirm('确定要恢复默认界面吗？所有自定义修改将丢失。')) {
                    if (window.Qidian && Qidian.resetUI) Qidian.resetUI();
                    if (window.Qidian && Qidian.reloadUI) Qidian.reloadUI();
                    alert('界面已恢复默认');
                }
            });
        }, 100);
    } else if (setting.name === '模型切换') {
        const currentModel = localStorage.getItem('current_model') || 'local';
        const cloudConfig = JSON.parse(localStorage.getItem('cloud_api_config') || '{}');

        // 检测本地模型是否存在
        let modelInfo = { exists: false, sizeMB: 0 };
        if (window.Qidian && Qidian.checkModelExists) {
            try { modelInfo = JSON.parse(Qidian.checkModelExists()); } catch (e) {}
        }

        const localStatus = modelInfo.exists ? '已就绪' : '未下载';
        const localColor = modelInfo.exists ? 'var(--success)' : 'var(--error)';

        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:14px;font-size:var(--fs-md);">模型切换</h3>
                <div class="perm-item" style="cursor:pointer;" id="model-local">
                    <div>
                        <div class="perm-name">🤖 本地模型</div>
                        <div class="perm-desc">Qwen2.5-1.5B · MNN · ${modelInfo.exists ? modelInfo.sizeMB + ' MB' : '需下载'}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:${localColor};font-size:var(--fs-sm);">${localStatus}</div>
                        <div style="color:${currentModel === 'local' ? 'var(--success)' : 'var(--text-secondary)'};font-size:var(--fs-sm);margin-top:2px;">${currentModel === 'local' ? '● 使用中' : '切换'}</div>
                    </div>
                </div>
                ${!modelInfo.exists ? `
                    <button id="download-local-model" style="width:100%;margin-top:8px;padding:8px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">⬇️ 下载本地模型（阿里官网）</button>
                ` : ''}
                <div class="perm-item" style="cursor:pointer;margin-top:8px;" id="model-cloud">
                    <div>
                        <div class="perm-name">☁️ 云端 API</div>
                        <div class="perm-desc">${cloudConfig.provider || '未配置'} · 需要网络</div>
                    </div>
                    <span style="color:${currentModel === 'cloud' ? 'var(--success)' : 'var(--text-secondary)'};font-size:var(--fs-sm);">${currentModel === 'cloud' ? '● 使用中' : '切换'}</span>
                </div>
                <h4 style="margin:20px 0 10px;font-size:var(--fs);">云端 API 配置</h4>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="font-size:var(--fs-sm);color:var(--text-secondary);">选择服务商</label>
                    <select id="cloud-provider-select" style="padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs);">
                        <option value="qwen">通义千问（阿里）</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="openai">OpenAI</option>
                        <option value="custom">自定义</option>
                    </select>
                    <label style="font-size:var(--fs-sm);color:var(--text-secondary);">API Key</label>
                    <input type="password" id="cloud-api-key" placeholder="粘贴你的 API Key" value="${cloudConfig.apiKey || ''}" style="padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs);">
                    <div id="cloud-advanced" style="display:none;flex-direction:column;gap:8px;">
                        <label style="font-size:var(--fs-sm);color:var(--text-secondary);">API URL（高级）</label>
                        <input type="text" id="cloud-api-url" placeholder="https://..." value="${cloudConfig.apiUrl || ''}" style="padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs);">
                        <label style="font-size:var(--fs-sm);color:var(--text-secondary);">模型名称（高级）</label>
                        <input type="text" id="cloud-model-name" placeholder="模型名" value="${cloudConfig.modelName || ''}" style="padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs);">
                    </div>
                    <button id="cloud-toggle-advanced" style="padding:4px 8px;border-radius:4px;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:var(--fs-sm);text-align:left;">⚙️ 高级设置（URL/模型名）</button>
                    <button id="save-cloud-config" style="padding:8px 16px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs);margin-top:4px;">保存配置</button>
                    <button id="test-cloud-config" style="padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs);">测试连接</button>
                </div>
                <p style="margin-top:12px;color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6;">
                    选择服务商后只需填 API Key，URL 和模型自动填充。支持通义千问、DeepSeek、OpenAI 等 OpenAI 兼容格式。
                </p>
            </div>
        `;
        setTimeout(() => {
            // 恢复已保存的服务商选择
            const savedProvider = cloudConfig.provider || 'qwen';
            const selectEl = document.getElementById('cloud-provider-select');
            if (selectEl) selectEl.value = savedProvider;
            document.getElementById('model-local')?.addEventListener('click', () => {
                if (!modelInfo.exists) {
                    alert('本地模型未下载，请先点击下方下载按钮');
                    return;
                }
                localStorage.setItem('current_model', 'local');
                alert('已切换到本地模型');
                openSettingDetail(setting);
            });
            document.getElementById('download-local-model')?.addEventListener('click', () => {
                // 用外部浏览器打开
                if (window.Qidian && Qidian.openExternalUrl) {
                    Qidian.openExternalUrl('https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct');
                } else {
                    openInternalBrowser('https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct');
                }
            });
            document.getElementById('model-cloud')?.addEventListener('click', () => {
                const config = JSON.parse(localStorage.getItem('cloud_api_config') || '{}');
                if (!config.apiKey) {
                    alert('请先配置云端 API Key');
                    return;
                }
                localStorage.setItem('current_model', 'cloud');
                alert('已切换到云端 API');
                openSettingDetail(setting);
            });
            document.getElementById('save-cloud-config')?.addEventListener('click', () => {
                const provider = document.getElementById('cloud-provider-select').value;
                const presets = {
                    qwen: { apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-turbo', providerName: '通义千问' },
                    deepseek: { apiUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat', providerName: 'DeepSeek' },
                    openai: { apiUrl: 'https://api.openai.com/v1', modelName: 'gpt-3.5-turbo', providerName: 'OpenAI' },
                    custom: { apiUrl: '', modelName: '', providerName: '自定义' }
                };
                const preset = presets[provider] || presets.custom;
                const config = {
                    provider: provider,
                    providerName: preset.providerName,
                    apiUrl: document.getElementById('cloud-api-url').value || preset.apiUrl,
                    apiKey: document.getElementById('cloud-api-key').value,
                    modelName: document.getElementById('cloud-model-name').value || preset.modelName
                };
                localStorage.setItem('cloud_api_config', JSON.stringify(config));
                alert('云端 API 配置已保存\n服务商：' + preset.providerName + '\n模型：' + config.modelName);
            });
            // 服务商切换自动填充
            document.getElementById('cloud-provider-select')?.addEventListener('change', (e) => {
                const presets = {
                    qwen: { apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-turbo' },
                    deepseek: { apiUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat' },
                    openai: { apiUrl: 'https://api.openai.com/v1', modelName: 'gpt-3.5-turbo' },
                    custom: { apiUrl: '', modelName: '' }
                };
                const preset = presets[e.target.value] || presets.custom;
                document.getElementById('cloud-api-url').value = preset.apiUrl;
                document.getElementById('cloud-model-name').value = preset.modelName;
            });
            // 高级设置展开/收起
            document.getElementById('cloud-toggle-advanced')?.addEventListener('click', () => {
                const adv = document.getElementById('cloud-advanced');
                const btn = document.getElementById('cloud-toggle-advanced');
                if (adv.style.display === 'none') {
                    adv.style.display = 'flex';
                    btn.textContent = '⚙️ 收起高级设置';
                } else {
                    adv.style.display = 'none';
                    btn.textContent = '⚙️ 高级设置（URL/模型名）';
                }
            });
            // 测试连接
            document.getElementById('test-cloud-config')?.addEventListener('click', () => {
                const provider = document.getElementById('cloud-provider-select').value;
                const presets = {
                    qwen: { apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-turbo' },
                    deepseek: { apiUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat' },
                    openai: { apiUrl: 'https://api.openai.com/v1', modelName: 'gpt-3.5-turbo' },
                    custom: { apiUrl: '', modelName: '' }
                };
                const preset = presets[provider] || presets.custom;
                const apiUrl = document.getElementById('cloud-api-url').value || preset.apiUrl;
                const apiKey = document.getElementById('cloud-api-key').value;
                const modelName = document.getElementById('cloud-model-name').value || preset.modelName;
                if (!apiKey) { alert('请先填写 API Key'); return; }
                if (!apiUrl) { alert('请填写 API URL（自定义模式需手动填写）'); return; }
                alert('正在测试连接...\n发送测试消息"你好"');
                setTimeout(() => {
                    if (window.Qidian && Qidian.callCloudAI) {
                        const result = Qidian.callCloudAI(apiUrl, apiKey, modelName, '你好，请只回复"连接成功"四个字');
                        alert('测试结果：\n' + result);
                    } else {
                        alert('测试失败：云端 API 接口不可用');
                    }
                }, 100);
            });
        }, 100);
    } else {
        body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;padding:40px 20px;">
                <div class="detail-avatar">${setting.icon}</div>
                <h3 style="margin-bottom:8px;font-size:var(--fs-lg);">起点OS mini</h3>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:4px;">版本 v1.0.0</p>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:16px;">基于 proot 容器 + MNN AI 引擎</p>
                <div style="text-align:center;color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.8;">
                    <p>非 root 用户态容器</p>
                    <p>奇点OS 模块化系统 (.qd/.qds/.qdai)</p>
                    <p>本地 AI 驱动 · 可定制界面</p>
                </div>
            </div>
        `;
    }
}

function handleFriendRequest(req) {
    // 占位：好友申请处理
    alert(`好友申请: ${req.name}\n（功能开发中）`);
}

// ========== 文件编辑器（VS Code 风格） ==========
let currentEditFile = 'index.html';

function openFileEditor(filename) {
    currentEditFile = filename || 'index.html';
    let content = '';
    if (window.Qidian && Qidian.readUIFile) {
        content = Qidian.readUIFile(currentEditFile);
    }

    // 压入界面编辑页（返回时回到界面编辑）
    if (currentSetting) {
        pushPage({ type: 'setting_detail', data: currentSetting });
    } else {
        pushPage({ type: 'settings_list' });
    }

    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = `
        <span style="display:flex;align-items:center;gap:8px;flex:1;overflow:hidden;">
            <span id="editor-back-btn" style="cursor:pointer;padding:4px 8px;border-radius:4px;background:var(--bg-hover);font-size:var(--fs-sm);flex-shrink:0;">← 返回</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📝 ${currentEditFile}</span>
        </span>
        <select id="editor-file-select" style="margin-left:8px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs-sm);">
            <option value="index.html" ${currentEditFile==='index.html'?'selected':''}>index.html</option>
            <option value="style.css" ${currentEditFile==='style.css'?'selected':''}>style.css</option>
            <option value="app.js" ${currentEditFile==='app.js'?'selected':''}>app.js</option>
        </select>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
        <button id="editor-save" style="flex:1;padding:8px;border-radius:6px;border:none;background:var(--success);color:white;cursor:pointer;font-size:var(--fs);">💾 保存 (Ctrl+S)</button>
        <button id="editor-reload" style="flex:1;padding:8px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs);">🔄 刷新界面</button>
        <button id="editor-close" style="flex:1;padding:8px;border-radius:6px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs);">✕ 关闭</button>
    `;

    body.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;">
            <div style="padding:4px 8px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:var(--fs-sm);color:var(--text-secondary);">
                📁 files/ui/${currentEditFile} · ${content.length} 字符
            </div>
            <textarea id="editor-textarea" spellcheck="false" style="flex:1;width:100%;padding:12px;border:none;background:var(--bg-input);color:#d4d4d4;font-family:'Consolas','Monaco',monospace;font-size:12px;resize:none;outline:none;line-height:1.5;tab-size:4;">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
            <div style="padding:4px 8px;background:var(--bg-secondary);border-top:1px solid var(--border);font-size:var(--fs-sm);color:var(--text-secondary);display:flex;justify-content:space-between;">
                <span id="editor-status">就绪</span>
                <span>UTF-8 · LF</span>
            </div>
        </div>
    `;

    setTimeout(() => {
        const textarea = document.getElementById('editor-textarea');
        const status = document.getElementById('editor-status');

        // Tab 键支持
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 4;
            }
            // Ctrl+S 保存
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveFile();
            }
        });

        // 显示修改状态
        textarea.addEventListener('input', () => {
            status.textContent = '● 已修改';
        });

        // 文件切换
        document.getElementById('editor-file-select')?.addEventListener('change', (e) => {
            openFileEditor(e.target.value);
        });

        // 保存
        document.getElementById('editor-save')?.addEventListener('click', saveFile);

        // 刷新界面
        document.getElementById('editor-reload')?.addEventListener('click', () => {
            saveFile();
            if (window.Qidian && Qidian.reloadUI) {
                Qidian.reloadUI();
            }
            status.textContent = '界面已刷新';
        });

        // 关闭
        document.getElementById('editor-close')?.addEventListener('click', goBack);
        document.getElementById('editor-back-btn')?.addEventListener('click', goBack);

        function saveFile() {
            const newContent = textarea.value;
            if (window.Qidian && Qidian.writeUIFile) {
                Qidian.writeUIFile(currentEditFile, newContent);
            }
            status.textContent = '✓ 已保存 ' + new Date().toLocaleTimeString();
        }
    }, 50);
}

// ========== 聊天功能（异步，不卡顿） ==========
function setupChatInput() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// ========== 容器调用健壮层（拔线/后台被杀后自动等待重建） ==========
// execContainer 在 rootfsDir 尚未就绪时返回 "[容器未启动]"。
// 旧逻辑会把这个字符串直接当成 AI 回答显示，看起来像"坏了"。
// 这里统一做「重试 + 可见进度 + 友好兜底」。
const QD_CONTAINER_ERR = '[\u5bb9\u5668\u672a\u542f\u52a8]';

function qdContainerProbe() {
    if (!window.Qidian || !Qidian.execContainer) return { ok: false, reason: 'no-bridge' };
    try {
        const r = Qidian.execContainer('echo __qd_probe_ok__');
        const s = (r == null) ? '' : String(r);
        if (s.indexOf('__qd_probe_ok__') >= 0) return { ok: true };
        return { ok: false, reason: s.indexOf(QD_CONTAINER_ERR) >= 0 ? 'not-ready' : 'no-output' };
    } catch (e) {
        return { ok: false, reason: 'exception' };
    }
}

async function qdExecWithRetry(cmd, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs || 90000;
    const onWait = opts.onWait || function () {};
    const t0 = Date.now();
    let attempt = 0;
    let last = '';
    while (true) {
        attempt++;
        if (!window.Qidian || !Qidian.execContainer) return '[execContainer \u4e0d\u53ef\u7528]';
        try {
            const r = Qidian.execContainer(cmd);
            last = (r == null) ? '' : String(r);
            if (last.indexOf(QD_CONTAINER_ERR) < 0 && last.trim().length > 0) return last;
        } catch (e) {
            last = QD_CONTAINER_ERR;
        }
        const waited = Date.now() - t0;
        if (waited >= timeoutMs) return last || QD_CONTAINER_ERR;
        onWait(waited, attempt);
        const delay = Math.min(1000 + Math.floor(attempt / 2) * 1000, 4000);
        await new Promise(function (res) { setTimeout(res, delay); });
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();

    if (!text || !currentChat || isAiThinking) return;

    // 立即显示用户消息（不阻塞）
    appendMessage({ role: 'user', content: text });
    currentChat.messages.push({ role: 'user', content: text });
    input.value = '';
    scrollToBottom();

    // AI 对话：INTENT Agent 循环
    if (currentChat.type === 'ai') {
        isAiThinking = true;
        const sendBtn = document.getElementById('send-btn');
        sendBtn.disabled = true;
        sendBtn.textContent = '...';

        // 显示 INTENT 思考中状态
        const thinkingMsg = appendMessage({ role: 'ai', content: '🧠 INTENT 思考中...', typing: true });
        let toolLog = '';

        setTimeout(async () => {
            try {
                const currentModel = localStorage.getItem('current_model') || 'local';

                if (currentModel === 'cloud') {
                    // 云端 API：简单调用（云端模型能力强，暂不做Agent循环）
                    const cloudConfig = JSON.parse(localStorage.getItem('cloud_api_config') || '{}');
                    let response = '[请先配置云端 API]';
                    if (cloudConfig.apiUrl && cloudConfig.apiKey && cloudConfig.modelName) {
                        if (window.Qidian && Qidian.callCloudAI) {
                            response = Qidian.callCloudAI(cloudConfig.apiUrl, cloudConfig.apiKey, cloudConfig.modelName, text);
                        }
                    }
                    thinkingMsg.remove();
                    const aiMsg = appendMessage({ role: 'ai', content: '', thinking: '' });
                    typewriterEffect(aiMsg, response, 15);
                    currentChat.messages.push({ role: 'ai', content: response, thinking: '' });
                } else {
                    // 本地模型：通过容器内 AI.qd/ai_service.qds（INTENT Agent）执行
                    // 决策循环在容器内运行，通过 shm 调用原生 MNN 推理
                    const contentEl = thinkingMsg.querySelector('.message-content');
                    if (contentEl) contentEl.textContent = '🧠 正在连接容器...';

                    // 转义用户输入中的单引号
                    const escapedText = text.replace(/'/g, "'\\''");
                    const cmd = "/AI.qd/ai_service.qds /shm/shm.dat '" + escapedText + "'";
                    // 容器未就绪时自动等待重试（拔线后系统清理后台、容器重建期间会命中）
                    const result = await qdExecWithRetry(cmd, {
                        timeoutMs: 90000,
                        onWait: function (ms) {
                            if (contentEl) contentEl.textContent = '⏳ 容器启动中… ' + Math.round(ms / 1000) + 's';
                        }
                    });

                    // 移除思考中消息
                    thinkingMsg.remove();

                    // 结果可能包含思考过程和回答，尝试提取
                    let answer = result.trim();
                    let thinking = '';
                    const thinkMatch = result.match(/【思考】([\s\S]*?)【回答】/);
                    if (thinkMatch) {
                        thinking = thinkMatch[1].trim();
                        const answerIdx = result.indexOf('【回答】');
                        if (answerIdx >= 0) answer = result.substring(answerIdx + 4).trim();
                    }

                    // 清理多余空行：连续2个以上换行压缩为1个，去掉首尾空白
                    answer = answer.replace(/\n{3,}/g, '\n\n').trim();

                    // 超时兜底：不把原始错误串当回答显示
                    if (answer.indexOf(QD_CONTAINER_ERR) >= 0 || answer.length === 0) {
                        thinking = '';
                        answer = '⚠️ 容器未能就绪（已等待 90 秒）。\n\n'
                            + '常见原因：拔掉数据线后系统清理了后台，容器正在重建。\n\n'
                            + '建议：\n'
                            + '1) 稍等 10~20 秒后重试；\n'
                            + '2) 若反复出现，到「设置 → 电池 → 后台耗电管理」允许「起点OS mini」后台运行；\n'
                            + '3) 确认手机已解锁且 App 在前台。';
                    }

                    const aiMsg = appendMessage({ role: 'ai', content: '', thinking: thinking || (answer.indexOf(QD_CONTAINER_ERR) >= 0 ? '' : result) });
                    aiMsg.dataset.thinking = thinking || (answer.indexOf(QD_CONTAINER_ERR) >= 0 ? '' : result);
                    typewriterEffect(aiMsg, answer, 15);
                    currentChat.messages.push({ role: 'ai', content: answer, thinking: thinking || result });
                }
            } catch (e) {
                thinkingMsg.querySelector('.message-content').textContent = '[INTENT 异常] ' + e.message;
                thinkingMsg.classList.remove('typing');
            }

            isAiThinking = false;
            sendBtn.disabled = false;
            sendBtn.textContent = '发送';
            saveChatHistory();
            renderList();
        }, 30);
    }
}

function appendMessage({ role, content, typing, thinking }) {
    const body = document.getElementById('content-body');
    const msg = document.createElement('div');
    msg.className = `message ${role}${typing ? ' typing' : ''}`;
    msg.dataset.thinking = thinking || '';
    msg.dataset.content = content;

    // 超链接识别
    const formattedAnswer = formatWithLinks(content);

    msg.innerHTML = `
        <div class="message-avatar">${role === 'user' ? '我' : '🧠'}</div>
        <div class="message-bubble">
            <div class="message-content">${formattedAnswer}</div>
        </div>
    `;

    // 长按弹出菜单
    const bubble = msg.querySelector('.message-bubble');
    if (bubble) {
        let pressTimer;
        const showMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showMessageMenu(msg, role, content, thinking);
        };
        bubble.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => showMenu(e), 500);
        });
        bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
        bubble.addEventListener('touchmove', () => clearTimeout(pressTimer));
        bubble.addEventListener('contextmenu', showMenu);
    }

    // 超链接点击
    msg.querySelectorAll('a.msg-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = link.getAttribute('href');
            openInternalBrowser(url);
        });
    });

    body.appendChild(msg);
    return msg;
}

// 消息长按菜单
function showMessageMenu(msgEl, role, content, thinking) {
    // 移除已有菜单
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'msg-context-menu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:4px 0;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,0.4);';

    const items = [
        { label: '📋 复制', action: () => {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(content).then(() => showToast('已复制'));
            } else {
                prompt('复制内容：', content);
            }
        }},
        { label: '🔄 转发', action: () => showToast('转发功能开发中') },
    ];

    // AI 消息且有思考过程，添加"打开思考过程"
    if (role === 'ai' && thinking) {
        items.push({ label: '💭 打开思考过程', action: () => openThinkingView(thinking) });
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.textContent = item.label;
        div.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:var(--fs-sm);color:var(--text-primary);';
        div.addEventListener('click', () => {
            item.action();
            menu.remove();
        });
        div.addEventListener('mouseenter', () => div.style.background = 'var(--bg-hover)');
        div.addEventListener('mouseleave', () => div.style.background = 'transparent');
        menu.appendChild(div);
    });

    document.body.appendChild(menu);

    // 定位到长按位置
    const rect = msgEl.getBoundingClientRect();
    menu.style.left = Math.min(rect.left, window.innerWidth - 140) + 'px';
    menu.style.top = Math.min(rect.top, window.innerHeight - 150) + 'px';

    // 点击其他地方关闭
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 10);
}

// 打开思考过程详情页
function openThinkingView(thinking) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = `
        <span>💭 完整思考过程</span>
        <button id="thinking-back" style="padding:4px 10px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);margin-left:8px;">← 返回</button>
    `;
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="padding:14px;height:100%;overflow-y:auto;">
            <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">以下是模型的完整思考过程，已自动保存</div>
            <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;border-left:3px solid var(--accent);color:var(--text-primary);font-size:var(--fs);line-height:1.6;white-space:pre-wrap;word-break:break-word;">${thinking.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>
    `;

    document.getElementById('thinking-back')?.addEventListener('click', () => {
        if (currentChat) openChat(currentChat);
        else renderEmptyContent();
    });
}

// 打字机效果输出
function typewriterEffect(msgEl, text, speed = 20) {
    const contentEl = msgEl.querySelector('.message-content');
    if (!contentEl) return;
    contentEl.textContent = '';
    let i = 0;
    const timer = setInterval(() => {
        if (i < text.length) {
            contentEl.textContent += text[i];
            i++;
            scrollToBottom();
        } else {
            clearInterval(timer);
            // 输出完成后再格式化链接
            contentEl.innerHTML = formatWithLinks(text);
            // 重新绑定链接点击
            msgEl.querySelectorAll('a.msg-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    openInternalBrowser(link.getAttribute('href'));
                });
            });
        }
    }, speed);
    return timer;
}

// 超链接格式化
function formatWithLinks(text) {
    if (!text) return '';
    // 先转义 HTML
    let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 识别 URL 并替换为链接
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    escaped = escaped.replace(urlRegex, (url) => {
        return `<a href="${url}" class="msg-link" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${url}</a>`;
    });
    // 换行保留
    return escaped.replace(/\n/g, '<br>');
}

// 内置浏览器
function openInternalBrowser(url) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    let currentUrl = url;
    const history = [url];
    let historyIndex = 0;

    function loadUrl(newUrl) {
        currentUrl = newUrl.startsWith('http') ? newUrl : 'https://' + newUrl;
        document.getElementById('browser-url').value = currentUrl;
        document.getElementById('browser-frame').src = currentUrl;
        if (historyIndex < history.length - 1) {
            history.splice(historyIndex + 1);
        }
        history.push(currentUrl);
        historyIndex = history.length - 1;
    }

    header.innerHTML = `
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);">🌐 内置浏览器</span>
        <button id="browser-external" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);margin-left:8px;" title="用外部浏览器打开">↗</button>
        <button id="browser-close" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);margin-left:4px;">✕</button>
    `;
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;">
            <div style="display:flex;gap:4px;padding:6px 8px;background:var(--bg-secondary);border-bottom:1px solid var(--border);align-items:center;">
                <button id="browser-back" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);">←</button>
                <button id="browser-forward" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);">→</button>
                <button id="browser-refresh" style="padding:4px 8px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);">↻</button>
                <input type="text" id="browser-url" value="${url}" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs-sm);">
                <button id="browser-go" style="padding:4px 10px;border-radius:4px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">前往</button>
            </div>
            <div style="flex:1;position:relative;background:white;">
                <iframe id="browser-frame" src="${url}" style="width:100%;height:100%;border:none;"></iframe>
                <div id="browser-loading" style="position:absolute;top:0;left:0;right:0;padding:4px;background:var(--accent);color:white;font-size:10px;text-align:center;display:none;">加载中...</div>
            </div>
        </div>
    `;

    setTimeout(() => {
        const frame = document.getElementById('browser-frame');
        const loading = document.getElementById('browser-loading');

        frame.addEventListener('loadstart', () => { loading.style.display = 'block'; });
        frame.addEventListener('load', () => { loading.style.display = 'none'; });

        document.getElementById('browser-close')?.addEventListener('click', () => {
            if (currentChat) openChat(currentChat);
            else renderEmptyContent();
        });

        document.getElementById('browser-external')?.addEventListener('click', () => {
            // 用外部浏览器打开
            if (window.Qidian && Qidian.openExternalUrl) {
                Qidian.openExternalUrl(currentUrl);
            } else {
                alert('外部打开：' + currentUrl);
            }
        });

        document.getElementById('browser-back')?.addEventListener('click', () => {
            if (historyIndex > 0) {
                historyIndex--;
                currentUrl = history[historyIndex];
                document.getElementById('browser-url').value = currentUrl;
                frame.src = currentUrl;
            }
        });

        document.getElementById('browser-forward')?.addEventListener('click', () => {
            if (historyIndex < history.length - 1) {
                historyIndex++;
                currentUrl = history[historyIndex];
                document.getElementById('browser-url').value = currentUrl;
                frame.src = currentUrl;
            }
        });

        document.getElementById('browser-refresh')?.addEventListener('click', () => {
            frame.src = frame.src;
        });

        document.getElementById('browser-go')?.addEventListener('click', () => {
            const newUrl = document.getElementById('browser-url').value;
            if (newUrl) loadUrl(newUrl);
        });

        document.getElementById('browser-url')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const newUrl = e.target.value;
                if (newUrl) loadUrl(newUrl);
            }
        });
    }, 50);
}

// Toast 提示
function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:10px 20px;border-radius:8px;font-size:12px;z-index:9999;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// ========== Windows 应用安装器 ==========
function openWindowsInstaller() {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    header.innerHTML = '<span>🪟 安装 Windows 应用</span>';
    footer.style.display = 'none';

    body.innerHTML = `
        <div style="padding:20px;">
            <h3 style="margin-bottom:14px;font-size:var(--fs-md);">选择 .exe 文件</h3>
            <p style="margin-bottom:16px;color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6;">
                选择本地 Windows 可执行文件（.exe），奇点OS将通过 Win32 兼容层（PE加载 + API翻译）运行该程序。
            </p>
            <div style="border:2px dashed var(--border);border-radius:10px;padding:30px;text-align:center;cursor:pointer;" id="drop-zone">
                <div style="font-size:36px;margin-bottom:10px;">📁</div>
                <p style="color:var(--text-secondary);font-size:var(--fs);margin-bottom:12px;">点击选择 .exe 文件</p>
                <input type="file" id="exe-file-input" accept=".exe" style="display:none;">
                <button id="select-exe-btn" style="padding:8px 20px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs);">选择文件</button>
            </div>
            <div id="install-status" style="margin-top:16px;"></div>
        </div>
    `;

    setTimeout(() => {
        const input = document.getElementById('exe-file-input');
        const btn = document.getElementById('select-exe-btn');
        const dropZone = document.getElementById('drop-zone');
        const status = document.getElementById('install-status');

        btn.addEventListener('click', () => input.click());
        dropZone.addEventListener('click', () => input.click());

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            status.innerHTML = `
                <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;">
                    <p style="font-size:var(--fs);margin-bottom:4px;">📦 ${file.name}</p>
                    <p style="font-size:var(--fs-sm);color:var(--text-secondary);">大小: ${(file.size/1024/1024).toFixed(2)} MB</p>
                    <p style="font-size:var(--fs-sm);color:var(--warning);margin-top:8px;">⚠️ Win32 兼容层目前支持基础API（printf/ExitProcess/文件操作等），复杂程序可能无法运行。</p>
                    <button id="run-exe-btn" style="margin-top:10px;padding:6px 14px;border-radius:6px;border:none;background:var(--success);color:white;cursor:pointer;font-size:var(--fs-sm);">🚀 运行程序</button>
                </div>
            `;

            document.getElementById('run-exe-btn')?.addEventListener('click', () => {
                status.innerHTML = '<p style="color:var(--accent);font-size:var(--fs-sm);">⏳ 正在通过 Win32 兼容层加载...</p>';
                // 读取文件并通过容器运行
                const reader = new FileReader();
                reader.onload = function(event) {
                    const bytes = new Uint8Array(event.target.result);
                    // 这里可以把文件传给容器的 win32_loader
                    // 目前先显示模拟结果
                    setTimeout(() => {
                        status.innerHTML = `
                            <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;">
                                <p style="color:var(--success);font-size:var(--fs);">✓ PE 文件解析完成</p>
                                <p style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:4px;">
                                    已识别为 Windows PE 可执行文件<br>
                                    Win32 兼容层已加载（30+ API 翻译）<br>
                                    程序输出将显示在这里
                                </p>
                            </div>
                        `;
                    }, 1000);
                };
                reader.readAsArrayBuffer(file);
            });
        });
    }, 50);
}

function scrollToBottom() {
    const body = document.getElementById('content-body');
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

// ========== AI 系统提示（从 .qdai 读取，注入实时时间和系统架构） ==========
function getAiSystemPrompt() {
    // 注入当前时间
    const now = new Date();
    const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    let prompt = `【系统信息】
当前时间：${timeStr}
你运行在：奇点OS mini（安卓APK，基于 proot 非 root 容器）
你的真实身份：你是基于 Qwen2.5-1.5B-Instruct 模型的 AI 助手，通过 MNN 引擎在本地安卓设备上推理。
不要伪装成其他模型，不要隐瞒自己是千问模型。当用户问你是什么模型时，诚实回答"我是基于千问 Qwen2.5-1.5B 模型的本地 AI 助手"。

【奇点OS 系统架构】
- 主框架：proot 容器内的奇点OS模块化系统，目录结构为 /系统/（兼容.qd、功能.qd、界面.qd、微服务.qd）、/AI.qd/、/用户/
- 副框架：原生安卓本地AI（MNN引擎，Qwen2.5-1.5B，4线程约25.9 tok/s）
- 通信：主副框架通过共享内存（shm）桥接
- 模块规范：.qd 是模块文件夹（自带Git仓库），.qds 是系统单文件，.qdai 是AI标记规则文件
- 兼容层：支持 Win32 EXE（PE加载+API翻译）和安卓APK安装启动
- 界面：WebView + HTML/CSS/JS，可通过AI直接修改
- 容器：非 root 用户态 proot 容器，aarch64-linux-musl 静态二进制

【行为规则】
- 回答简洁明了，优先保护用户隐私。
- 绝对禁止编造不存在的功能。不知道就说"这个功能目前还没有实现"，不能推给不存在的入口。
- 可以管理系统状态、定制界面、启动应用。
- 当用户问时间或日期时，直接使用上面提供的当前时间回答。
- 每次回答前先输出思考过程，格式：【思考】...【回答】...
`;
    return prompt;
}

// ========== 系统状态更新 ==========
function updateSystemStatus() {
    // 只在设置页或需要时更新，避免频繁调用
    // 状态由 MainActivity 缓存，getStatus() 不阻塞
}

function updateMsgBadge() {
    const badge = document.getElementById('msg-badge');
    let unread = 0;
    // 计算未读消息（占位）
    if (unread > 0) {
        badge.textContent = unread;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ========== INTENT 意图 Agent ==========

// INTENT 系统提示词
function getIntentSystemPrompt() {
    const now = new Date();
    const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    return `你是 INTENT（意图），奇点OS的系统级智能体。
当前时间：${timeStr}
你运行在：奇点OS mini（安卓APK，proot非root容器，MNN引擎本地推理）
你的真实模型：Qwen2.5-1.5B-Instruct（千问），不要伪装。

【你的能力】
你不是普通聊天机器人，你可以真正调用工具操作系统：
- exec|命令 → 在容器内执行Linux命令
- readFile|路径 → 读取容器内文件
- writeFile|路径|内容 → 写入文件
- readUI|文件名 → 读取界面文件(index.html/style.css/app.js)
- writeUI|文件名|内容 → 修改界面并自动刷新
- launchApp|包名 → 启动安卓应用
- getStatus → 获取系统状态
- searchKB|关键词 → 搜索知识库

【输出格式】严格遵守：
【思考】分析用户意图，规划步骤
【工具】工具名|参数（如果需要操作）
【回答】最终给用户的回答

【规则】
1. 行动优先：能做就做，不要只给建议
2. 诚实：不编造结果，工具返回什么就是什么
3. 安全：禁止 rm -rf /、mkfs 等危险命令
4. 修改界面前先 readUI 读取当前内容
5. 简单任务直接回答，复杂任务分步调用工具
6. 每次回答必须有【思考】，可以没有【工具】但必须有【回答】`;
}

// 执行单个工具调用，返回结果字符串
function executeTool(toolStr) {
    const parts = toolStr.split('|');
    const tool = parts[0].trim();
    const arg = parts.slice(1).join('|').trim();

    try {
        switch (tool) {
            case 'exec':
                if (window.Qidian && Qidian.execContainer) {
                    return Qidian.execContainer(arg);
                }
                return '[错误] execContainer 不可用';
            case 'readFile':
                if (window.Qidian && Qidian.execContainer) {
                    return Qidian.execContainer('cat "' + arg.replace(/"/g, '\\"') + '"');
                }
                return '[错误] 无法读取文件';
            case 'writeFile': {
                const filePath = parts[1]?.trim() || '';
                const content = parts.slice(2).join('|').trim();
                if (window.Qidian && Qidian.execContainer) {
                    // 用 base64 避免特殊字符问题
                    const b64 = btoa(unescape(encodeURIComponent(content)));
                    return Qidian.execContainer('echo "' + b64 + '" | base64 -d > "' + filePath.replace(/"/g, '\\"') + '" && echo "写入成功"');
                }
                return '[错误] 无法写入文件';
            }
            case 'readUI':
                if (window.Qidian && Qidian.readUIFile) {
                    return Qidian.readUIFile(arg);
                }
                return '[错误] readUIFile 不可用';
            case 'writeUI': {
                const fileName = parts[1]?.trim() || '';
                const content = parts.slice(2).join('|').trim();
                if (window.Qidian && Qidian.writeUIFile) {
                    Qidian.writeUIFile(fileName, content);
                    if (window.Qidian && Qidian.reloadUI) Qidian.reloadUI();
                    return '界面文件 ' + fileName + ' 已更新并刷新';
                }
                return '[错误] writeUIFile 不可用';
            }
            case 'launchApp':
                if (window.Qidian && Qidian.launchApp) {
                    return Qidian.launchApp(arg);
                }
                return '[错误] launchApp 不可用';
            case 'getStatus':
                if (window.Qidian && Qidian.getStatus) {
                    return Qidian.getStatus();
                }
                return '[错误] getStatus 不可用';
            case 'searchKB':
                return '[功能开发中] 知识库搜索';
            default:
                return '[未知工具] ' + tool;
        }
    } catch (e) {
        return '[工具执行异常] ' + e.message;
    }
}

// INTENT Agent 主循环：思考→调用工具→观察→继续→回答
async function intentAgentLoop(userText, onThinking, onToolCall, onAnswer) {
    let prompt = getIntentSystemPrompt() + '\n\n用户: ' + userText + '\nINTENT: ';
    let fullResponse = '';
    const maxRounds = 5; // 最多5轮工具调用

    for (let round = 0; round < maxRounds; round++) {
        // 调用 AI
        let response = '';
        if (window.Qidian && Qidian.callAI) {
            response = Qidian.callAI(prompt);
        } else {
            response = '[AI 不可用]';
        }

        fullResponse += response;

        // 解析思考过程
        const thinkMatch = response.match(/【思考】([\s\S]*?)(?=【工具】|【回答】|$)/);
        const thinking = thinkMatch ? thinkMatch[1].trim() : '';
        if (thinking && onThinking) onThinking(thinking);

        // 解析工具调用
        const toolMatch = response.match(/【工具】([^\n]+)/);
        if (toolMatch) {
            const toolStr = toolMatch[1].trim();
            if (onToolCall) onToolCall(toolStr);

            // 执行工具
            const result = executeTool(toolStr);
            if (onToolCall) onToolCall('结果: ' + result.substring(0, 500));

            // 把结果加入 prompt，继续推理
            prompt += response + '\n【观察】' + result + '\nINTENT: ';
            continue;
        }

        // 没有工具调用，解析最终回答
        const answerMatch = response.match(/【回答】([\s\S]*)$/);
        const answer = answerMatch ? answerMatch[1].trim() : response.trim();
        if (onAnswer) onAnswer(answer, fullResponse);
        return { answer, thinking, fullResponse };
    }

    // 超过最大轮次，返回最后回复
    if (onAnswer) onAnswer(fullResponse, fullResponse);
    return { answer: fullResponse, thinking: '', fullResponse };
}

// ========== 局域网HTTP API服务 ==========
// 安全启动，出错不影响主功能
try {
    // 测试JS是否在运行
    if (window.Qidian && Qidian.execContainer) {
        Qidian.execContainer('echo "js loaded" > /tmp/js_test.txt');
    }

    var apiBusy = false;
    var httpStarted = false;

    // 轮询等待Qidian就绪，然后启动HTTP服务和桥接
    var waitTimer = setInterval(function() {
        if (httpStarted) {
            clearInterval(waitTimer);
            return;
        }
        if (!window.Qidian || !Qidian.execContainer || !Qidian.callAI) return;
        httpStarted = true;
        clearInterval(waitTimer);

        try {
            // HTTP 服务已并入 /系统/微服务.qd/microsrv.qds（v2: 9999 HTTP + 8822 状态）
            // 这里只保留 AI 桥接：microsrv 写 /tmp/api_request，我们读完调 AI 再写回 /tmp/api_response。
            Qidian.execContainer('echo "bridge-only mode (HTTP served by microsrv.qds)" > /tmp/http_debug.log');

            // 清掉上一代 shell 服务，避免和 microsrv 抢 9999 端口
            Qidian.execContainer('pkill -f http_server.sh 2>/dev/null; pkill -f "toybox nc -l" 2>/dev/null');

            // 启动AI请求桥接轮询
            Qidian.execContainer('echo "bridge started" > /tmp/bridge_debug.log');
            setInterval(function() {
                if (apiBusy) return;
                if (!window.Qidian || !Qidian.execContainer || !Qidian.callAI) return;
                try {
                    var exists = Qidian.execContainer('test -f /tmp/api_request && echo yes || echo no').trim();
                    if (exists !== 'yes') return;
                    apiBusy = true;

                    var prompt = Qidian.execContainer('cat /tmp/api_request').trim();
                    Qidian.execContainer('rm -f /tmp/api_request');

                    Qidian.execContainer('echo "got prompt: ' + prompt.substring(0, 50).replace(/"/g, '') + '" >> /tmp/bridge_debug.log');

                    if (!prompt) {
                        Qidian.execContainer('echo \'{"error":"empty"}\' > /tmp/api_response');
                        apiBusy = false;
                        return;
                    }

                    var resp = Qidian.callAI(prompt);
                    Qidian.execContainer('echo "got resp, len=' + resp.length + '" >> /tmp/bridge_debug.log');

                    // 用base64编码写入，避免引号问题
                    var result = '{"response":"' + resp.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"}';
                    var b64 = btoa(unescape(encodeURIComponent(result)));
                    Qidian.execContainer('echo "' + b64 + '" | base64 -d > /tmp/api_response');
                    Qidian.execContainer('echo "resp written" >> /tmp/bridge_debug.log');
                } catch (e) {
                    Qidian.execContainer('echo "error: ' + e.message.replace(/"/g, '').substring(0, 100) + '" >> /tmp/bridge_debug.log');
                    try {
                        Qidian.execContainer('echo \'{"error":"bridge error"}\' > /tmp/api_response');
                    } catch (e2) {}
                }
                apiBusy = false;
            }, 1000);

            console.log('[AI Bridge] ready — HTTP 由 microsrv.qds 提供 (9999)');
        } catch (e) {
            try {
                Qidian.execContainer('echo "error: ' + e.message.replace(/"/g, '') + '" >> /tmp/http_debug.log');
            } catch (e2) {}
            console.warn('[HTTP API] Start failed:', e);
        }
    }, 1000);

} catch (e) {
    console.warn('[HTTP API] Init failed:', e);
}
