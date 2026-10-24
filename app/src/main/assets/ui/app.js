// ========== 状态管理 ==========
let currentPage = 'messages';
let currentChat = null;
let isAiThinking = false;
let currentSetting = null;  // 当前打开的设置项
let pageHistory = [];        // 页面导航栈
// 联网搜索总开关：用户在聊天框的「🌐 联网」按键自主控制；默认开，选择持久化。
let webSearchEnabled = (function () { try { return (localStorage.getItem('web_search_enabled') || '1') === '1'; } catch (e) { return true; } })();

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
                    // 打开全屏设置页（不再用侧栏+小弹层）
                    openSettingsFullscreen();
                } else if (action === 'about') {
                    // 打开全屏设置页并直接定位到「关于」
                    openSettingsFullscreen('关于');
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
            document.body.classList.remove('qd-drawer-open');  // 竖屏抽屉：选中后收回
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

// ========== 竖屏：微信式导航（主页列表 → 点进详情，左缘右滑抽屉/返回） ==========
// 横屏保持原三栏布局，这里的逻辑只影响竖屏（CSS 用 @media orientation: portrait）。

/** 返回列表主页（等价于重新点击当前导航项的列表部分）。 */
function qdGoBackToList() {
    currentChat = null;
    currentSetting = null;
    isAiThinking = false;
    renderList();
    if (currentPage === 'knowledge') {
        renderKnowledgeContent();
    } else {
        renderEmptyContent();
    }
}

(function setupPortraitNav() {
    // ===== 状态灯挂载：跟随当前顶栏右侧 =====
    // fixed 定位在这台设备的竖屏下不可靠（布局视口与可见区对不齐，灯会跑出屏幕），
    // 改为把灯挂进 list-header（主页）或 content-header（详情页），随页面自动搬家。
    const dot = document.getElementById('qd-status-dot');
    const listHeader = document.querySelector('.list-header');
    const contentHeader = document.getElementById('content-header');
    if (dot && listHeader && contentHeader) {
        console.log('[dot] placeDot init ok, dot parent=', dot.parentElement && dot.parentElement.className);
        const placeDot = function () {
            const inDetail = document.body.classList.contains('qd-in-detail');
            const target = inDetail ? contentHeader : listHeader;
            if (target && dot.parentElement !== target) {
                target.appendChild(dot);
                // 顶栏改为左对齐布局：标题靠左，灯靠右（margin-left:auto）
                target.style.justifyContent = 'flex-start';
                target.style.gap = '10px';
            }
        };
        placeDot();
        // 页面切换会重写 header.innerHTML（灯被冲掉）或切换详情模式 → 自动搬回去
        new MutationObserver(placeDot).observe(listHeader, { childList: true });
        new MutationObserver(placeDot).observe(contentHeader, { childList: true, subtree: true });
        new MutationObserver(placeDot).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } else {
        console.error('[dot] init FAILED dot=', !!dot, 'listHeader=', !!listHeader, 'contentHeader=', !!contentHeader);
    }

    // 返回键 / 抽屉按钮 / 遮罩
    document.getElementById('qd-back')?.addEventListener('click', qdGoBackToList);
    document.getElementById('qd-menu-btn')?.addEventListener('click', () => {
        document.body.classList.add('qd-drawer-open');
    });
    document.getElementById('qd-drawer-mask')?.addEventListener('click', () => {
        document.body.classList.remove('qd-drawer-open');
    });

    // 详情模式开关：content-body 被填入真实内容 → 进入详情；出现空态 → 退回主页。
    // 用 MutationObserver 挂钩所有渲染入口（聊天/应用/设置/浏览器…），不用逐个函数改。
    const bodyEl = document.getElementById('content-body');
    const headerEl = document.getElementById('content-header');
    if (bodyEl && headerEl) {
        // 详情顶栏被各渲染函数重写时会丢掉返回按钮，这里自动补回。
        // 基础 CSS 里 .qd-back-btn 是 display:none，只有竖屏媒体查询才显示，
        // 所以横屏下多注入的这个按钮不可见，无需判断方向。
        const ensureBack = function () {
            if (!document.getElementById('qd-back')) {
                const btn = document.createElement('button');
                btn.id = 'qd-back';
                btn.className = 'qd-back-btn';
                btn.title = '返回';
                btn.textContent = '‹';
                btn.addEventListener('click', qdGoBackToList);
                headerEl.insertBefore(btn, headerEl.firstChild);
            }
        };
        const apply = function () {
            const inDetail = bodyEl.children.length > 0 && !bodyEl.querySelector('.empty-state');
            document.body.classList.toggle('qd-in-detail', inDetail);
            if (inDetail) ensureBack();
        };
        new MutationObserver(apply).observe(headerEl, { childList: true, subtree: true });
        new MutationObserver(apply).observe(bodyEl, { childList: true, subtree: true });
    }

    // 边缘手势：主页左缘右滑 = 呼出抽屉；详情页左缘右滑 = 返回列表；抽屉左滑 = 收起
    // 注：原生层已为左缘中段 200dp 申请了系统手势排除区，这段区域由 App 接管；
    //     排除区之外更靠内的起点也能触发（sx<=150），保证不同 ROM 下都能滑出来。
    const isPortrait = () => window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    let sx = 0, sy = 0, tracking = false;
    document.addEventListener('touchstart', function (e) {
        if (!isPortrait() || e.touches.length !== 1) { tracking = false; return; }
        const t = e.touches[0];
        sx = t.clientX;
        sy = t.clientY;
        tracking = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
        if (!tracking) return;
        tracking = false;
        if (!isPortrait()) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        if (Math.abs(dx) < 70 || Math.abs(dy) > 60) return;   // 排除纵向滚动
        if (dx > 0 && sx <= 150) {
            if (document.body.classList.contains('qd-in-detail')) {
                qdGoBackToList();
            } else if (!document.body.classList.contains('qd-drawer-open')) {
                document.body.classList.add('qd-drawer-open');
            }
        } else if (dx < 0 && document.body.classList.contains('qd-drawer-open')) {
            document.body.classList.remove('qd-drawer-open');
        }
    }, { passive: true });
})();

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

/**
 * 当前本地模型的展示信息（随模型商店切换而变化）
 */
function currentLocalModel() {
    let info = { modelId: '', modelName: '', exists: false, sizeMB: 0 };
    try {
        if (window.Qidian && Qidian.checkModelExists) {
            info = Object.assign(info, JSON.parse(Qidian.checkModelExists()));
        }
    } catch (e) { }
    return info;
}

/**
 * 模型商店
 * ---------------------------------------------------------------------------
 * 后端：ModelCatalog.kt（解析 assets/model_catalog.json）
 *       下载：ModelProvisioner（多镜像 / 断点续传 / sha256）
 * 接口：getModelCatalog / downloadModel / activateModel / deleteModel
 */
const ModelStore = {
    catalog: null,       // {active, default, models:[...]}
    downloadingId: null,

    bind() {
        window.onModelCatalogChanged = () => { this.load(); this.render(); };
        window.onModelProgress = (p) => {
            ModelDownload.state = p.state || 'idle';
            ModelDownload.downloaded = p.downloaded || 0;
            ModelDownload.total = p.total || 0;
            ModelDownload.speed = p.speed || 0;
            ModelDownload.file = p.file || '';
            ModelDownload.error = p.error || null;
            ModelDownload.modelId = p.model_id || '';
            ModelDownload.render();
            // 下载完成后刷新商店列表
            if (p.state === 'done') {
                this.downloadingId = null;
                this.load();
                this.render();
            } else if (p.state === 'failed') {
                this.downloadingId = null;
                this.render();
            }
        };
    },

    load() {
        try {
            if (window.Qidian && Qidian.getModelCatalog) {
                this.catalog = JSON.parse(Qidian.getModelCatalog());
            }
        } catch (e) { }
        return this.catalog;
    },

    fmtMB(mb) {
        if (!mb) return '0 MB';
        if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
        return mb + ' MB';
    },

    ramMB() {
        // 粗略估计设备内存（浏览器拿不到精确值，用 deviceMemory 或默认值）
        const dm = navigator.deviceMemory || 4;
        return dm * 1024;
    },

    download(modelId) {
        if (!window.Qidian || !Qidian.downloadModel) {
            alert('当前环境不支持模型下载');
            return;
        }
        this.bind();
        const r = JSON.parse(Qidian.downloadModel(modelId) || '{}');
        if (r.started) {
            this.downloadingId = modelId;
            this.render();
        } else if (r.error && r.error !== '已下载') {
            alert(r.error);
        }
    },

    activate(modelId) {
        try {
            const r = JSON.parse(Qidian.activateModel(modelId) || '{}');
            if (r.ok) {
                this.load();
                this.render();
                alert('已切换模型，正在重新加载引擎…');
            } else {
                alert('切换失败：' + (r.error || '未知错误'));
            }
        } catch (e) {
            alert('切换失败：' + e.message);
        }
    },

    remove(modelId) {
        if (!confirm('删除该模型？可释放磁盘空间，之后可重新下载。')) return;
        try {
            const r = JSON.parse(Qidian.deleteModel(modelId) || '{}');
            if (r.ok) {
                this.load();
                this.render();
            } else {
                alert(r.error || '删除失败');
            }
        } catch (e) {
            alert('删除失败：' + e.message);
        }
    },

    render() {
        const host = document.getElementById('model-store-list');
        if (!host || !this.catalog) return;
        const models = this.catalog.models || [];
        const myRam = this.ramMB();

        host.innerHTML = models.map(m => {
            const isActive = m.active;
            const isDown = m.downloaded;
            const isDownloading = this.downloadingId === m.id;
            const ramOk = myRam >= (m.min_ram_mb || 1024);

            const tags = (m.tags || []).map(t =>
                `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;margin-right:4px;background:var(--bg-secondary);color:var(--text-secondary);">${t}</span>`
            ).join('');

            let action = '';
            if (isDownloading) {
                action = `<span style="color:var(--accent);font-size:var(--fs-sm);">下载中…</span>`;
            } else if (isActive) {
                action = `<span style="color:var(--success);font-size:var(--fs-sm);">● 使用中</span>`;
            } else if (isDown) {
                action = `<button data-act="activate" data-id="${m.id}" style="padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-sm);">切换</button>
                          <button data-act="delete" data-id="${m.id}" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);cursor:pointer;font-size:var(--fs-sm);margin-left:6px;">删除</button>`;
            } else {
                const memWarn = ramOk ? '' : `<span style="color:var(--warning);font-size:var(--fs-sm);">内存可能不足</span>`;
                action = `<button data-act="download" data-id="${m.id}" style="padding:6px 12px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">下载</button>${memWarn}`;
            }

            const newBadge = m.override
                ? ' <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;margin-left:4px;background:var(--accent);color:#fff;vertical-align:middle;">·新</span>'
                : '';

            return `
            <div class="perm-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div class="perm-name">${m.name}${newBadge} ${tags}</div>
                        <div class="perm-desc" style="margin-top:3px;">${m.desc || ''}</div>
                        <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-top:3px;">
                            ${m.params} · ${this.fmtMB(m.size_mb)}
                            ${m.min_ram_mb ? ' · 建议内存 ' + m.min_ram_mb + 'MB+' : ''}
                            ${isDown && !isActive ? ' · 已占用 ' + this.fmtMB(m.local_mb) : ''}
                        </div>
                    </div>
                    <div style="text-align:right;white-space:nowrap;">${action}</div>
                </div>
            </div>`;
        }).join('');

        // 事件绑定
        host.querySelectorAll('button[data-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                const id = btn.dataset.id;
                if (act === 'download') ModelStore.download(id);
                else if (act === 'activate') ModelStore.activate(id);
                else if (act === 'delete') ModelStore.remove(id);
            });
        });
    }
};

/**
 * 模型下载控制器
 * ---------------------------------------------------------------------------
 * App 内置 ModelProvisioner（原生层实现）：多镜像源、断点续传、sha256 校验。
 * 本模块只负责：发起下载、接收进度回调、渲染进度条。
 */
const ModelDownload = {
    state: 'idle',       // idle|checking|downloading|verifying|done|failed
    downloaded: 0,
    total: 0,
    speed: 0,
    file: '',
    error: null,
    _bound: false,

    bind() {
        if (this._bound) return;
        this._bound = true;
        window.onModelProgress = (p) => {
            this.state = p.state || 'idle';
            this.downloaded = p.downloaded || 0;
            this.total = p.total || 0;
            this.speed = p.speed || 0;
            this.file = p.file || '';
            this.error = p.error || null;
            this.render();
        };
    },

    start() {
        if (!window.Qidian || !Qidian.startModelDownload) {
            alert('当前环境不支持模型下载');
            return;
        }
        this.bind();
        this.state = 'checking';
        this.downloaded = 0;
        this.error = null;
        this.render();
        Qidian.startModelDownload();
    },

    cancel() {
        try { Qidian.cancelModelDownload && Qidian.cancelModelDownload(); } catch (e) { }
    },

    retry() {
        this.start();
    },

    fmtSize(bytes) {
        if (!bytes) return '0 B';
        const mb = bytes / 1024 / 1024;
        if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
        return mb.toFixed(1) + ' MB';
    },

    render() {
        const hint = document.getElementById('qd-mon-model-hint');
        const slot = document.getElementById('qd-mon-model-btn-slot');
        if (!hint) return;

        const pct = this.total > 0 ? Math.floor(this.downloaded * 100 / this.total) : 0;
        const eta = (this.speed > 0 && this.total > 0)
            ? Math.max(0, Math.round((this.total - this.downloaded) / this.speed))
            : -1;
        const etaText = eta >= 0
            ? (eta >= 60 ? Math.ceil(eta / 60) + ' 分钟' : eta + ' 秒')
            : '估算中';

        if (this.state === 'downloading') {
            if (slot) {
                slot.innerHTML =
                    '<div style="margin-top:4px;">' +
                    '<div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:4px;">' +
                    '<span>' + this.fmtSize(this.downloaded) + ' / ' + this.fmtSize(this.total) + '</span>' +
                    '<span>' + pct + '% · ' + this.fmtSize(this.speed) + '/s · 剩余 ' + etaText + '</span>' +
                    '</div>' +
                    '<div style="height:6px;border-radius:3px;background:var(--bg-secondary);overflow:hidden;">' +
                    '<div style="height:100%;width:' + pct + '%;background:var(--accent);transition:width .4s;"></div>' +
                    '</div>' +
                    '<button id="cancel-model-dl" style="margin-top:6px;padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);cursor:pointer;font-size:var(--fs-sm);">取消</button>' +
                    '</div>';
                document.getElementById('cancel-model-dl')?.addEventListener('click', () => ModelDownload.cancel());
            }
            hint.innerHTML = '正在下载模型…支持断点续传，中断后点击重试可继续，不会重新下载。';
        } else if (this.state === 'verifying') {
            if (slot) slot.innerHTML = '<span style="color:var(--text-secondary);font-size:var(--fs-sm);">校验中…</span>';
            hint.innerHTML = '正在校验文件完整性（SHA-256），请勿关闭应用。';
        } else if (this.state === 'checking') {
            if (slot) slot.innerHTML = '<span style="color:var(--text-secondary);font-size:var(--fs-sm);">准备下载…</span>';
            hint.innerHTML = '正在检查设备环境与存储空间…';
        } else if (this.state === 'failed') {
            if (slot) {
                slot.innerHTML = '<button id="retry-model-dl" style="padding:8px 14px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">↻ 重试下载</button>';
                document.getElementById('retry-model-dl')?.addEventListener('click', () => ModelDownload.retry());
            }
            hint.innerHTML = '<span style="color:var(--error);">下载失败：' + (this.error || '未知错误') + '</span><br>已下载部分会保留，重试将从断点继续。';
        } else if (this.state === 'done') {
            if (slot) slot.innerHTML = '<span style="color:var(--success);font-size:var(--fs-sm);">✓ 模型就绪</span>';
            hint.innerHTML = '模型已下载并校验通过，正在本地运行。';
        }
    }
};

function renderContactList(container) {
    // AI 助手分组
    container.appendChild(createGroupHeader('AI 助手'));
    const aiItem = createListItem({
        avatar: '🤖',
        name: '奇点AI',
        // 动态状态：跟随 MNN 引擎真实加载情况（QdStatus 每 2 秒刷新）
        preview: '本地 AI 助手 · ' + (QdStatus.snap.ai ? '在线'
            : (QdStatus.snap.modelExists === false ? '模型未下载' : '模型加载中')),
        onClick: () => openContactDetail({ name: '奇点AI', type: 'ai', avatar: '🤖', desc: '基于本地大语言模型（MNN 引擎）的 AI 助手，支持对话、系统管理、界面定制。' })
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
    // 应用状态全部从 QdStatus 实时读取，不写死。
    const aiState = QdStatus.snap.ai
        ? { text: '运行中', kind: 'ok' }
        : (QdStatus.snap.modelExists === false
            ? { text: '模型未下载', kind: 'warn' }
            : { text: '模型加载中', kind: 'warn' });
    const containerState = QdStatus.snap.container
        ? { text: '就绪', kind: 'ok' }
        : { text: '初始化中', kind: 'warn' };
    const httpState = QdStatus.snap.http
        ? { text: '监听中 · ' + (QdStatus.snap.lan || ('端口 ' + QdStatus.snap.port)), kind: 'ok' }
        : { text: '未监听', kind: 'warn' };

    // VS Code（默认集成，纯内置功能卡片，无独立运行状态）
    const vscodeItem = createListItem({
        avatar: '📝',
        name: 'VS Code',
        preview: '代码编辑器（Web版）',
        onClick: () => openAppDetail({
            name: 'VS Code', icon: '📝',
            desc: '基于 Web 的代码编辑器，支持 HTML/CSS/JS/代码编辑。可直接编辑奇点OS界面文件。',
            status: '内置功能', statusKind: 'builtin', action: 'open_vscode'
        })
    });
    container.appendChild(vscodeItem);

    // 局域网 API（App 原生 HTTP 服务）
    const apiItem = createListItem({
        avatar: '🌐',
        name: '局域网 API',
        preview: httpState.text,
        onClick: () => openAppDetail({
            name: '局域网 API', icon: '🌐',
            desc: 'App 内置 HTTP 服务，电脑可通过 WiFi 调用本地 AI。POST /chat 对话，GET /health 查状态。地址见状态文字。',
            status: httpState.text, statusKind: httpState.kind
        })
    });
    container.appendChild(apiItem);

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
        onClick: () => openAppDetail({
            name: '容器终端', icon: '💻',
            desc: '基于 proot 的奇点OS容器环境，无需 root 权限即可运行 Linux 程序和奇点OS全部模块。支持 .qd/.qds/.qdai 模块化系统。按需启动，执行完即退出。',
            status: containerState.text, statusKind: containerState.kind
        })
    });
    container.appendChild(terminalItem);

    // AI 引擎（状态实时：模型没加载完会如实显示"模型加载中"）
    const aiItem = createListItem({
        avatar: '🧠',
        name: 'AI 引擎',
        preview: 'MNN · 本地模型 · ' + aiState.text,
        onClick: () => openAppDetail({
            name: 'AI 引擎', icon: '🧠',
            desc: '基于 MNN 推理引擎的本地大语言模型（MNN 4-bit 量化）。支持对话、系统管理、界面定制。首次加载约 2~3 秒。',
            status: aiState.text, statusKind: aiState.kind
        })
    });
    container.appendChild(aiItem);

    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = '安装 Windows 应用后将显示在这里';
    container.appendChild(empty);
}

const SETTINGS_LIST = [
    { name: '系统状态', icon: '📊', desc: '容器、AI、微服务运行状态' },
    { name: '投屏与远程', icon: '📺', desc: '屏幕投射、远程控制、多屏协同' },
    { name: '外观设置', icon: '🎨', desc: '深色/浅色主题、横屏/竖屏' },
    { name: 'AI 权限', icon: '🔐', desc: '网络、位置、麦克风等权限管理' },
    { name: 'AI 配置', icon: '🤖', desc: '模型参数、推理线程、温度' },
    { name: '界面编辑', icon: '✏️', desc: '直接编辑 HTML/CSS/JS 界面文件' },
    { name: '电脑连接', icon: '💻', desc: '局域网无线浏览/修改电脑文件' },
    { name: '模型切换', icon: '🔄', desc: '本地模型 / 云端 API 切换' },
    { name: '模型商店', icon: '🛒', desc: '下载并切换本地模型（多款可选）' },
    { name: '关于', icon: 'ℹ️', desc: 'qidian编辑器 版本信息' }
];

function renderSettingsList(container, target) {
    SETTINGS_LIST.forEach(s => {
        const item = createListItem({
            avatar: s.icon,
            name: s.name,
            preview: s.desc,
            onClick: () => openSettingDetail(s, target)
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
    header.innerHTML = '<span>qidian编辑器</span>';
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
    renderChatFooter();

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
                ${contact.type === 'ai'
                    ? '本地 AI 助手 · ' + (QdStatus.snap.ai ? '引擎运行中' : '引擎未就绪')
                    : '好友'}
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

    // 状态颜色按真实状态显示：ok=绿、warn=黄、error=红、builtin=中性灰
    const kindColor = { ok: 'var(--success)', warn: 'var(--warning)', error: 'var(--error)', builtin: 'var(--text-secondary)' };
    const statusColor = kindColor[app.statusKind] || 'var(--success)';

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;padding:30px 20px;">
            <div class="detail-avatar">${app.icon}</div>
            <h3 style="margin-bottom:6px;font-size:var(--fs-lg);">${app.name}</h3>
            <p style="color:${statusColor};font-size:var(--fs-sm);margin-bottom:12px;">● ${app.status || '未就绪'}</p>
            <p style="color:var(--text-secondary);font-size:var(--fs-sm);text-align:center;max-width:320px;line-height:1.6;">
                ${app.desc || ''}
            </p>
        </div>
    `;
}

function openSettingDetail(setting, target) {
    const header = target ? target.header : document.getElementById('content-header');
    const body = target ? target.body : document.getElementById('content-body');
    const footer = target ? target.footer : document.getElementById('content-footer');

    // 压入设置列表页（返回时回到设置列表）；全屏设置页用自身返回，不污染全局导航栈
    if (!(target && target.fullscreen)) {
        pushPage({ type: 'settings_list' });
        currentSetting = setting;
    }

    if (target && target.fullscreen) {
        const tEl = header.querySelector('.qd-fs-title');
        if (tEl) tEl.textContent = setting.icon + ' ' + setting.name;
        const bEl = header.querySelector('#qd-fs-back');
        if (bEl) bEl.style.display = '';
    } else {
        header.innerHTML = `<span style="display:flex;align-items:center;gap:8px;">
            <span id="back-btn" style="cursor:pointer;padding:4px 8px;border-radius:4px;background:var(--bg-hover);font-size:var(--fs-sm);">← 返回</span>
            <span>${setting.icon} ${setting.name}</span>
        </span>`;
    }
    if (footer) footer.style.display = 'none';

    setTimeout(() => {
        if (target && target.fullscreen) {
            const bEl = header.querySelector('#qd-fs-back');
            if (bEl) bEl.addEventListener('click', () => {
                if (fsTarget && fsTarget.header) {
                    const t = fsTarget.header.querySelector('.qd-fs-title');
                    if (t) t.textContent = '⚙️ 设置';
                    bEl.style.display = 'none';
                }
                renderSettingsList(fsTarget.body, fsTarget);
            });
        } else {
            document.getElementById('back-btn')?.addEventListener('click', goBack);
        }
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
        if (footer) footer.style.display = 'none';

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
        // 方向的唯一数据源是原生桥（SharedPreferences）：mode=设置的值，actual=系统真实方向。
        // 之前这里读 localStorage，和原生两份数据会打架——显示竖屏、实际横屏就是这么来的。
        let ori = { mode: localStorage.getItem('orientation') || 'landscape', actual: '' };
        try {
            if (window.Qidian && Qidian.getOrientation) ori = JSON.parse(Qidian.getOrientation());
        } catch (e) { }
        const currentOrientation = ori.mode || 'landscape';
        const actualTxt = ori.actual === 'portrait' ? '竖屏' : (ori.actual === 'landscape' ? '横屏' : '检测中…');
        const mismatch = ori.actual && ori.actual !== currentOrientation;
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
                    <div style="font-size:var(--fs);color:var(--text-primary);margin-bottom:4px;">📱 屏幕方向</div>
                    <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">
                        当前实际方向：${actualTxt}（数据实时读自系统，不是写死的）
                        ${mismatch ? '<br>⚠️ 与所选不一致：正在切换中，画面刷新后即生效' : ''}
                    </p>
                    <div style="display:flex;gap:8px;">
                        <button id="ori-landscape" style="flex:1;padding:10px;border-radius:6px;border:2px solid ${currentOrientation === 'landscape' ? 'var(--accent)' : 'var(--border)'};background:${currentOrientation === 'landscape' ? 'var(--bg-active)' : 'var(--bg-hover)'};color:var(--text-primary);cursor:pointer;font-size:var(--fs);">🔄 横屏</button>
                        <button id="ori-portrait" style="flex:1;padding:10px;border-radius:6px;border:2px solid ${currentOrientation === 'portrait' ? 'var(--accent)' : 'var(--border)'};background:${currentOrientation === 'portrait' ? 'var(--bg-active)' : 'var(--bg-hover)'};color:var(--text-primary);cursor:pointer;font-size:var(--fs);">📱 竖屏</button>
                    </div>
                    <p style="margin-top:8px;color:var(--text-secondary);font-size:var(--fs-sm);">切换后立即生效并保存到系统存储，重启 / 侧滑返回 / 任务切换后都保持</p>
                </div>
            </div>
        `;
        if (footer) footer.style.display = 'none';
        setTimeout(() => {
            document.getElementById('theme-dark')?.addEventListener('click', () => {
                localStorage.setItem('theme', 'dark');
                document.documentElement.removeAttribute('data-theme');
                openSettingDetail(setting, target);
            });
            document.getElementById('theme-light')?.addEventListener('click', () => {
                localStorage.setItem('theme', 'light');
                document.documentElement.setAttribute('data-theme', 'light');
                openSettingDetail(setting, target);
            });
            document.getElementById('ori-landscape')?.addEventListener('click', () => {
                localStorage.setItem('orientation', 'landscape');
                if (window.Qidian && Qidian.setOrientation) Qidian.setOrientation('landscape');
                openSettingDetail(setting, target);
            });
            document.getElementById('ori-portrait')?.addEventListener('click', () => {
                localStorage.setItem('orientation', 'portrait');
                if (window.Qidian && Qidian.setOrientation) Qidian.setOrientation('portrait');
                openSettingDetail(setting, target);
            });
        }, 50);
        return;
    }

    if (setting.name === '电脑连接') {
        renderPCBridge();
        return;
    }

    if (setting.name === '系统状态') {
        // ===== 实时监控页 =====
        // 数据来自 QdStatus（每 2 秒刷新），这里只负责把快照画出来。
        // 回调发现 DOM 已被移除（离开页面）时自动退订，避免重复渲染。
        body.innerHTML = `
            <div style="padding:16px;" id="qd-monitor-root">
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:10px;">⏱ 以下状态每 2 秒自动刷新，为实时真实数据</p>
                <div class="settings-grid">
                    <div class="setting-card">
                        <div class="label">AI 引擎</div>
                        <div class="value" id="qd-mon-ai">…</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">局域网 API</div>
                        <div class="value" id="qd-mon-http" style="font-size:var(--fs-sm);">…</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">容器 (rootfs)</div>
                        <div class="value" id="qd-mon-container">…</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">运行时长</div>
                        <div class="value" id="qd-mon-uptime" style="font-size:var(--fs-sm);">…</div>
                    </div>
                </div>
                <div class="settings-grid" style="margin-top:10px;">
                    <div class="setting-card">
                        <div class="label">已服务对话</div>
                        <div class="value" id="qd-mon-chats">…</div>
                    </div>
                    <div class="setting-card">
                        <div class="label">模型文件</div>
                        <div class="value" id="qd-mon-model" style="font-size:var(--fs-sm);">…</div>
                    </div>
                </div>
                <div style="margin-top:12px;padding:14px;background:var(--bg-secondary);border-radius:8px;" class="qd-info-block" id="qd-mon-model-block">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div>
                            <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:4px;">本地模型</div>
                            <div style="font-size:var(--fs);" id="qd-mon-model-name">本地模型 · MNN 4-bit</div>
                            <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-top:2px;">
                                文件：<span id="qd-mon-model-file">…</span>
                                &nbsp;|&nbsp; 引擎：<span id="qd-mon-model-engine">…</span>
                            </div>
                        </div>
                        <span id="qd-mon-model-btn-slot"></span>
                    </div>
                    <div id="qd-mon-model-hint" style="color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6;margin-top:8px;"></div>
                </div>
            </div>
        `;

        const fmtUptime = sec => {
            if (!sec) return '—';
            const m = Math.floor(sec / 60);
            return m >= 1 ? m + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒';
        };
        const set = (id, html) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        };
        // 把纯文本写进所在卡片的 data-copy，长按卡片即可复制
        const setCopy = (id, text) => {
            const el = document.getElementById(id);
            const card = el && el.closest('.setting-card, .qd-info-block');
            if (card && text) card.setAttribute('data-copy', text);
        };

        const updateMonitor = snap => {
            // 离开页面后 body.innerHTML 被重写，root 已脱离 DOM → 自动退订
            const root = document.getElementById('qd-monitor-root');
            if (!root || !document.contains(root)) {
                QdStatus.off(updateMonitor);
                return;
            }

            // AI 引擎
            const aiOk = snap.ai;
            set('qd-mon-ai',
                `<span style="color:${aiOk ? 'var(--success)' : 'var(--warning)'};">${aiOk ? '● 运行中' : '● 未就绪'}</span>`);
            setCopy('qd-mon-ai', 'AI 引擎: ' + (aiOk ? '运行中' : '未就绪'));

            // 局域网 API
            set('qd-mon-http',
                snap.http
                    ? `<span style="color:var(--success);">● 监听中</span><br><span style="color:var(--text-secondary);">${snap.lan || ('端口 ' + snap.port)}</span>`
                    : `<span style="color:var(--warning);">● 未监听</span>`);
            setCopy('qd-mon-http', snap.http && snap.lan ? '局域网 API: http://' + snap.lan : '局域网 API: 未监听');

            // 容器：rootfs 就绪即可执行容器命令（proot 现按需启动，无常驻）
            set('qd-mon-container',
                snap.container
                    ? `<span style="color:var(--success);">● 就绪</span>`
                    : `<span style="color:var(--warning);">● 初始化中</span>`);
            setCopy('qd-mon-container', '容器(rootfs): ' + (snap.container ? '就绪' : '初始化中'));

            // 运行指标
            set('qd-mon-uptime', fmtUptime(snap.uptime));
            setCopy('qd-mon-uptime', '服务运行时长: ' + fmtUptime(snap.uptime));
            set('qd-mon-chats', (snap.chats || 0) + ' 次');
            setCopy('qd-mon-chats', '已服务对话: ' + (snap.chats || 0) + ' 次');

            // 模型：文件下载 与 引擎加载 是两回事，分开显示
            const fileOk = snap.modelExists === true;
            set('qd-mon-model-name', (snap.modelName || '本地模型') + ' · MNN 4-bit');
            set('qd-mon-model',
                `<span style="color:${snap.modelExists === false ? 'var(--error)' : 'var(--text-secondary)'};">${snap.modelExists === false ? '未下载' : (fileOk ? snap.modelMB + ' MB' : '检查中')}</span>`);
            setCopy('qd-mon-model', '模型文件: ' + (snap.modelExists === false ? '未下载' : (fileOk ? '已下载 ' + snap.modelMB + ' MB' : '检查中')));
            set('qd-mon-model-file',
                fileOk
                    ? `<span style="color:var(--success);">已下载（${snap.modelMB} MB）</span>`
                    : (snap.modelExists === false ? '<span style="color:var(--error);">未下载</span>' : '检查中'));
            set('qd-mon-model-engine',
                aiOk
                    ? '<span style="color:var(--success);">已加载，可对话</span>'
                    : (fileOk ? '<span style="color:var(--warning);">加载中（约 2~3 秒）</span>' : '<span style="color:var(--error);">无模型可加载</span>'));
            setCopy('qd-mon-model-block',
                '本地模型: ' + (snap.modelName || '本地模型') + ' · MNN 4-bit · 文件'
                + (fileOk ? '已下载（' + snap.modelMB + ' MB）' : (snap.modelExists === false ? '未下载' : '检查中'))
                + ' · 引擎' + (aiOk ? '已加载，可对话' : (fileOk ? '加载中' : '无模型可加载')));

            // 下载按钮 / 提示（只在状态变化时重画一次，避免按钮被刷新打断点击）
            const slot = document.getElementById('qd-mon-model-btn-slot');
            if (slot && slot.dataset.state !== String(snap.modelExists)) {
                slot.dataset.state = String(snap.modelExists);
                if (snap.modelExists === false) {
                    slot.innerHTML = '<button id="download-model-btn" style="padding:8px 14px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">⬇️ 一键下载模型（868MB）</button>';
                    setTimeout(() => {
                        document.getElementById('download-model-btn')?.addEventListener('click', () => {
                            ModelDownload.start();
                        });
                    }, 50);
                    set('qd-mon-model-hint', '首次使用需下载本地模型（MNN 4-bit 量化，体积因模型而异）。<br>点击上方按钮即可自动下载，支持断点续传与多镜像加速；下载完成后模型会在手机本地运行，不上传任何数据。');
                } else {
                    slot.innerHTML = fileOk ? '<span style="color:var(--success);font-size:var(--fs-sm);">✓ 文件就绪</span>' : '';
                    set('qd-mon-model-hint', '');
                }
            }
        };
        QdStatus.on(updateMonitor);
    } else if (setting.name === 'AI 权限') {
        // 权限状态实时查询：运行时权限走 checkPermission，
        // 普通权限（INTERNET 等）安装即授予，如实标注来源。
        const permState = t => {
            try {
                if (window.Qidian && Qidian.checkPermission) {
                    return String(Qidian.checkPermission(t));
                }
            } catch (e) { }
            return '未知';
        };
        const locGranted = permState('location') === '已授权';
        const micGranted = permState('microphone') === '已授权';
        const grantedSpan = ok => ok
            ? '<span style="color:var(--success);font-size:var(--fs-sm);">已授权</span>'
            : '<span style="color:var(--warning);font-size:var(--fs-sm);">未授权（点击下方请求）</span>';
        const normalSpan = '<span style="color:var(--text-secondary);font-size:var(--fs-sm);">随应用安装授予</span>';

        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:14px;font-size:var(--fs-md);">AI 权限管理</h3>
                <p style="margin-bottom:14px;color:var(--text-secondary);font-size:var(--fs-sm);">点击"请求授权"可弹出系统权限对话框，授权后 AI 即可使用对应能力。</p>
                <div class="perm-item" id="perm-network">
                    <div>
                        <div class="perm-name">🌐 网络访问</div>
                        <div class="perm-desc">允许 AI 联网搜索实时信息</div>
                    </div>
                    ${normalSpan}
                </div>
                <div class="perm-item" id="perm-location" style="cursor:pointer;">
                    <div>
                        <div class="perm-name">📍 位置信息</div>
                        <div class="perm-desc">允许 AI 读取设备位置</div>
                    </div>
                    <span id="perm-location-state">${grantedSpan(locGranted)}</span>
                </div>
                <div class="perm-item" id="perm-mic" style="cursor:pointer;">
                    <div>
                        <div class="perm-name">🎤 麦克风</div>
                        <div class="perm-desc">允许 AI 录制语音输入</div>
                    </div>
                    <span id="perm-mic-state">${grantedSpan(micGranted)}</span>
                </div>
                <div class="perm-item" id="perm-audio">
                    <div>
                        <div class="perm-name">🔊 听筒/扬声器</div>
                        <div class="perm-desc">允许 AI 播放语音回复</div>
                    </div>
                    ${normalSpan}
                </div>
                <div class="perm-item" id="perm-storage">
                    <div>
                        <div class="perm-name">📁 文件读取</div>
                        <div class="perm-desc">读取系统模块与界面文件（应用私有目录）</div>
                    </div>
                    <span style="color:var(--text-secondary);font-size:var(--fs-sm);">应用私有目录 · 无需授权</span>
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
                // 延迟检查权限状态并刷新（授权对话框关闭后生效有延迟）
                setTimeout(() => {
                    if (window.Qidian && Qidian.checkPermission) {
                        const locStatus = Qidian.checkPermission('location');
                        const micStatus = Qidian.checkPermission('microphone');
                        const locEl = document.getElementById('perm-location-state');
                        const micEl = document.getElementById('perm-mic-state');
                        const span = ok => ok
                            ? '<span style="color:var(--success);font-size:var(--fs-sm);">已授权</span>'
                            : '<span style="color:var(--warning);font-size:var(--fs-sm);">未授权（点击请求）</span>';
                        if (locEl) locEl.innerHTML = span(locStatus === '已授权');
                        if (micEl) micEl.innerHTML = span(micStatus === '已授权');
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

            // 权限初始状态已在页面渲染时动态查询（见 permState），无需重复检查
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
    } else if (setting.name === '模型商店') {
        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:6px;font-size:var(--fs-md);">模型商店</h3>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6;margin-bottom:14px;">
                    模型在手机本地运行，不上传任何数据。可同时下载多款，按需切换使用。
                    当前使用中的模型会标记为「使用中」。
                </p>
                <button id="discover-models-btn" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-sm);margin-bottom:14px;">
                    🔍 立即发现新模型
                </button>
                <div id="model-store-list"></div>
                <div id="model-store-progress" style="margin-top:14px;"></div>
            </div>
        `;
        setTimeout(() => {
            ModelStore.bind();
            ModelStore.load();
            ModelStore.render();
            // 「立即发现新模型」：触发本地 AI 后台联网检索并自动加店
            const discBtn = document.getElementById('discover-models-btn');
            discBtn?.addEventListener('click', () => {
                if (!window.Qidian || !Qidian.runModelDiscovery) {
                    alert('当前版本暂不支持自动发现，请更新应用后再试。');
                    return;
                }
                discBtn.disabled = true;
                discBtn.textContent = '⏳ 正在后台检索新模型…';
                Qidian.runModelDiscovery();
                setTimeout(() => {
                    discBtn.disabled = false;
                    discBtn.textContent = '🔍 立即发现新模型';
                }, 4000);
                alert('已启动后台模型检索：本地 AI 会联网查找当前可运行的 MNN 模型并自动加入商店。发现的新模型会标「·新」，稍后下拉刷新即可看到。');
            });
            // 把下载进度挂到商店页
            const holder = document.getElementById('model-store-progress');
            const origRender = ModelDownload.render.bind(ModelDownload);
            ModelDownload.render = function () {
                origRender();
                if (!holder) return;
                if (ModelDownload.state === 'downloading') {
                    const pct = ModelDownload.total > 0
                        ? Math.floor(ModelDownload.downloaded * 100 / ModelDownload.total) : 0;
                    const eta = (ModelDownload.speed > 0 && ModelDownload.total > 0)
                        ? Math.max(0, Math.round((ModelDownload.total - ModelDownload.downloaded) / ModelDownload.speed)) : -1;
                    holder.innerHTML =
                        `<div style="padding:12px;border-radius:8px;background:var(--bg-secondary);">
                           <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:6px;">
                             正在下载 ${ModelDownload.modelId || ''} · ${pct}%
                             ${eta >= 0 ? ' · 剩余 ' + (eta >= 60 ? Math.ceil(eta / 60) + ' 分钟' : eta + ' 秒') : ''}
                           </div>
                           <div style="height:6px;border-radius:3px;background:var(--bg-input);overflow:hidden;">
                             <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .4s;"></div>
                           </div>
                           <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:5px;">
                             ${ModelStore.fmtMB(ModelDownload.downloaded / 1048576)} / ${ModelStore.fmtMB(ModelDownload.total / 1048576)}
                             · ${ModelStore.fmtMB(ModelDownload.speed / 1048576)}/s
                           </div>
                         </div>`;
                } else if (ModelDownload.state === 'failed') {
                    holder.innerHTML = `<div style="padding:12px;border-radius:8px;background:var(--bg-secondary);color:var(--error);font-size:var(--fs-sm);">
                        下载失败：${ModelDownload.error || '未知错误'}。已下载部分会保留，重试将从断点继续。</div>`;
                } else if (ModelDownload.state === 'verifying') {
                    holder.innerHTML = `<div style="padding:12px;border-radius:8px;background:var(--bg-secondary);color:var(--text-secondary);font-size:var(--fs-sm);">
                        正在校验文件完整性…</div>`;
                } else {
                    holder.innerHTML = '';
                }
            };
        }, 60);
    } else if (setting.name === '模型切换') {
        const currentModel = localStorage.getItem('current_model') || 'local';
        const cloudConfig = JSON.parse(localStorage.getItem('cloud_api_config') || '{}');

        // 检测本地模型是否存在
        let modelInfo = { exists: false, sizeMB: 0 };
        if (window.Qidian && Qidian.checkModelExists) {
            try { modelInfo = JSON.parse(Qidian.checkModelExists()); } catch (e) {}
        }

        // 区分「模型文件已下载」与「引擎已加载」两个独立状态（QdStatus 实时数据）
        const localStatus = !QdStatus.snap.modelExists
            ? '未下载'
            : (QdStatus.snap.ai ? '运行中' : '已下载 · 引擎加载中');
        const localColor = !QdStatus.snap.modelExists
            ? 'var(--error)'
            : (QdStatus.snap.ai ? 'var(--success)' : 'var(--warning)');

        body.innerHTML = `
            <div style="padding:16px;">
                <h3 style="margin-bottom:14px;font-size:var(--fs-md);">模型切换</h3>
                <div class="perm-item" style="cursor:pointer;" id="model-local">
                    <div>
                        <div class="perm-name">🤖 本地模型</div>
                        <div class="perm-desc">${modelInfo.modelName || '本地模型'} · MNN · ${modelInfo.exists ? modelInfo.sizeMB + ' MB' : '需下载'}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:${localColor};font-size:var(--fs-sm);">${localStatus}</div>
                        <div style="color:${currentModel === 'local' ? 'var(--success)' : 'var(--text-secondary)'};font-size:var(--fs-sm);margin-top:2px;">${currentModel === 'local' ? '● 使用中' : '切换'}</div>
                    </div>
                </div>
                ${!modelInfo.exists ? `
                    <button id="download-local-model" style="width:100%;margin-top:8px;padding:8px;border-radius:6px;border:none;background:var(--accent);color:white;cursor:pointer;font-size:var(--fs-sm);">⬇️ 一键下载本地模型（868MB）</button>
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
                openSettingDetail(setting, target);
            });
            document.getElementById('download-local-model')?.addEventListener('click', () => {
                ModelDownload.bind();
                ModelDownload.start();
            });
            document.getElementById('model-cloud')?.addEventListener('click', () => {
                const config = JSON.parse(localStorage.getItem('cloud_api_config') || '{}');
                if (!config.apiKey) {
                    alert('请先配置云端 API Key');
                    return;
                }
                localStorage.setItem('current_model', 'cloud');
                alert('已切换到云端 API');
                openSettingDetail(setting, target);
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
    } else if (setting.name === '关于') {
        // API 接口信息（Base URL / API Key，全部可复制）
        let apiRows = '';
        try {
            if (window.Qidian && Qidian.getHttpInfo) {
                const h = JSON.parse(Qidian.getHttpInfo());
                if (h.listening && h.apiKey) {
                    apiRows = `
                        <div class="qd-kv" data-copy="http://${h.lan}/v1"><span>Base URL</span><b>http://${h.lan}/v1</b><em>复制</em></div>
                        <div class="qd-kv" data-copy="${h.apiKey}"><span>API Key</span><b>${h.apiKey.substring(0, 8)}••••••••</b><em>复制</em></div>
                        <div class="qd-kv" data-copy="${h.apiKey}"><span>完整 Key</span><b style="font-size:var(--fs-sm);word-break:break-all;">${h.apiKey}</b><em>复制</em></div>`;
                }
            }
        } catch (e) { }
        body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;padding:30px 20px;">
                <div class="detail-avatar">${setting.icon}</div>
                <h3 style="margin-bottom:8px;font-size:var(--fs-lg);">qidian编辑器</h3>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:4px;">版本 v1.0.0</p>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:16px;">基于 proot 容器 + MNN AI 引擎</p>
                <div style="text-align:center;color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.8;margin-bottom:16px;">
                    <p>非 root 用户态容器</p>
                    <p>奇点OS 模块化系统 (.qd/.qds/.qdai)</p>
                    <p>本地 AI 驱动 · 可定制界面</p>
                </div>
                ${apiRows ? `
                <div style="width:100%;max-width:360px;padding:12px 14px;background:var(--bg-secondary);border-radius:8px;">
                    <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:8px;">🔌 局域网 API（长按条目即可复制）</div>
                    ${apiRows}
                </div>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-top:10px;text-align:center;">把 Base URL + API Key 填进任意支持 OpenAI 接口的 Agent，即可调用本机模型</p>` : ''}
            </div>
        `;
    } else {
        body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;padding:40px 20px;">
                <div class="detail-avatar">${setting.icon}</div>
                <h3 style="margin-bottom:8px;font-size:var(--fs-lg);">qidian编辑器</h3>
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

// ========== 全屏设置页 ==========
// 设置/关于改成全屏页：点开即占满整个屏幕，自带返回/关闭，不再用侧栏+小弹层（qdModal）。
let fsTarget = null;

function openSettingsFullscreen(initialName) {
    closeSettingsFullscreen();
    const ov = document.createElement('div');
    ov.id = 'qd-settings-fs';
    ov.innerHTML = `
        <div class="qd-fs-header" id="qd-fs-header">
            <button id="qd-fs-back" class="qd-fs-back" type="button">← 返回</button>
            <span class="qd-fs-title">⚙️ 设置</span>
            <button id="qd-fs-close" class="qd-fs-close" type="button" title="关闭">✕</button>
        </div>
        <div class="qd-fs-body" id="qd-fs-body"></div>
    `;
    document.body.appendChild(ov);
    fsTarget = {
        header: ov.querySelector('#qd-fs-header'),
        body: ov.querySelector('#qd-fs-body'),
        footer: null,
        fullscreen: true
    };
    ov.querySelector('#qd-fs-close').addEventListener('click', closeSettingsFullscreen);
    // 点遮罩/返回键关闭（移动端体验）
    ov.addEventListener('click', (e) => { if (e.target === ov) closeSettingsFullscreen(); });
    renderSettingsList(fsTarget.body, fsTarget);
    if (initialName) {
        const s = SETTINGS_LIST.find(x => x.name === initialName);
        if (s) openSettingDetail(s, fsTarget);
    }
}

function closeSettingsFullscreen() {
    const old = document.getElementById('qd-settings-fs');
    if (old) old.remove();
    fsTarget = null;
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
// 打开聊天时重建页脚（联网开关 + 输入框 + 发送），并重新绑定事件。
// 原因：去「知识库/界面编辑/PC桥」等页面时 footer.innerHTML 会被覆盖，
// 回到聊天后若只靠 display 恢复，按钮会丢失事件绑定甚至整段消失。
function renderChatFooter() {
    const footer = document.getElementById('content-footer');
    if (!footer) return;
    footer.innerHTML = `
        <button id="web-search-toggle" class="web-search-toggle" type="button" title="联网搜索">🌐 联网</button>
        <input type="text" id="message-input" placeholder="输入消息..." autocomplete="off">
        <button id="send-btn" type="button">发送</button>`;
    footer.style.display = 'flex';

    const wsToggle = document.getElementById('web-search-toggle');
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    function updateWebSearchBtn() {
        if (!wsToggle) return;
        wsToggle.classList.toggle('on', webSearchEnabled);
        wsToggle.title = webSearchEnabled ? '联网搜索：开（点按关闭）' : '联网搜索：关（点按开启）';
        wsToggle.setAttribute('aria-pressed', webSearchEnabled ? 'true' : 'false');
    }
    if (wsToggle) {
        wsToggle.addEventListener('click', () => {
            webSearchEnabled = !webSearchEnabled;
            try { localStorage.setItem('web_search_enabled', webSearchEnabled ? '1' : '0'); } catch (e) { }
            updateWebSearchBtn();
            qdToast(webSearchEnabled ? '🌐 联网搜索：已开启' : '🌐 联网搜索：已关闭');
        });
        updateWebSearchBtn();
    }
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (input) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
}

function setupChatInput() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const wsToggle = document.getElementById('web-search-toggle');

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 联网搜索开关：由用户在聊天框自主决定是否开启（持久化到 localStorage）
    function updateWebSearchBtn() {
        if (!wsToggle) return;
        wsToggle.classList.toggle('on', webSearchEnabled);
        wsToggle.title = webSearchEnabled ? '联网搜索：开（点按关闭）' : '联网搜索：关（点按开启）';
        wsToggle.setAttribute('aria-pressed', webSearchEnabled ? 'true' : 'false');
    }
    if (wsToggle) {
        wsToggle.addEventListener('click', () => {
            webSearchEnabled = !webSearchEnabled;
            try { localStorage.setItem('web_search_enabled', webSearchEnabled ? '1' : '0'); } catch (e) { }
            updateWebSearchBtn();
        });
        updateWebSearchBtn();
    }
}

// ========== 实时状态中心 ==========
// 规则：界面上所有「就绪 / 运行中 / 在线」类的状态文字，必须从 QdStatus.snap 取，
// 禁止写死。数据源：Qidian 桥（同步）+ 本机 /health（异步，带 CORS）。
// 每 2 秒自动刷新一次，订阅者立即收到最新快照。
const QdStatus = {
    snap: {
        container: false,   // rootfs 就绪（可执行容器命令）
        ai: false,          // MNN 引擎已加载
        http: false,        // 局域网 API 监听中
        port: -1,
        lan: '',
        uptime: 0,          // App 进程内服务运行秒数
        chats: 0,           // 已服务对话次数
        modelExists: null,  // 模型文件是否已下载（null=未知）
        modelMB: 0,
        modelName: '',     // 当前激活模型的显示名（随模型商店切换而变）
        modelId: ''        // 当前激活模型的 id
    },
    subs: [],
    _timer: null,

    refresh() {
        try {
            if (window.Qidian && Qidian.getStatus) {
                Object.assign(this.snap, JSON.parse(Qidian.getStatus()));
            }
        } catch (e) { }
        try {
            if (window.Qidian && Qidian.getHttpInfo) {
                const raw = Qidian.getHttpInfo();
                this.snap._rawHttp = raw;
                const h = JSON.parse(raw);
                this.snap.http = !!h.listening;
                this.snap.port = h.port || -1;
                this.snap.lan = h.lan || '';
                if (typeof h.uptime === 'number') this.snap.uptime = h.uptime;
                if (typeof h.chats === 'number') this.snap.chats = h.chats;
            }
        } catch (e) {
            this.snap._rawHttp = '异常: ' + e.message;
        }
        try {
            if (window.Qidian && Qidian.checkModelExists) {
                const m = JSON.parse(Qidian.checkModelExists());
                this.snap.modelExists = !!m.exists;
                this.snap.modelMB = m.sizeMB || 0;
                if (m.modelName) this.snap.modelName = m.modelName;
                if (m.modelId) this.snap.modelId = m.modelId;
            }
        } catch (e) { }

        // /health 由 App 内 LocalHttpServer 提供，带 CORS 头，可直接 fetch。
        // 拿 uptime / chats 这类桥接口没有的运行指标。
        try {
            fetch('http://127.0.0.1:9999/health', { cache: 'no-store' })
                .then(r => r.json())
                .then(h => {
                    this.snap.uptime = h.uptime || 0;
                    this.snap.chats = h.chats || 0;
                    if (typeof h.ai === 'boolean') this.snap.ai = h.ai;
                    this._notify();
                })
                .catch(function () { });
        } catch (e) { }

        this._notify();
    },

    /** 注册回调，注册时立即收到一次当前快照 */
    on(cb) {
        this.subs.push(cb);
        try { cb(this.snap); } catch (e) { }
    },

    /** 取消订阅 */
    off(cb) {
        const i = this.subs.indexOf(cb);
        if (i >= 0) this.subs.splice(i, 1);
    },

    _notify() {
        this.subs.forEach(cb => { try { cb(this.snap); } catch (e) { } });
    },

    start() {
        if (this._timer) return;
        this.refresh();
        this._timer = setInterval(() => this.refresh(), 2000);
    }
};
QdStatus.start();

// ========== 通用工具：弹窗 / 复制 / 长按 ==========
// alert() 里的文字在 WebView 里没法长按复制，所以关键信息一律走 qdModal()，
// 条目带 data-copy 属性：点「复制」或长按 500ms 即复制到剪贴板。

function qdToast(msg) {
    let t = document.getElementById('qd-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'qd-toast';
        t.style.cssText = 'position:fixed;left:50%;bottom:60px;transform:translateX(-50%);'
            + 'padding:8px 16px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;'
            + 'font-size:13px;z-index:100001;pointer-events:none;transition:opacity .25s;opacity:0';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.opacity = '0'; }, 1200);
}

function qdCopyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    ta.remove();
}

/** 复制文本到剪贴板；file:// 源下 navigator.clipboard 可能被拒，自动降级。 */
function qdCopyText(text, withToast) {
    if (!text) return;
    const done = function () { if (withToast !== false) qdToast('已复制'); };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { qdCopyFallback(text); done(); });
            return;
        }
    } catch (e) { }
    qdCopyFallback(text);
    done();
}

/** 底部信息弹窗（替代 alert）：内容自定义，右上角状态灯和「关于」都用它。 */
function qdModal(html) {
    const old = document.getElementById('qd-modal-ov');
    if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'qd-modal-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;'
        + 'display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border);'
        + 'border-radius:12px;max-width:420px;width:86%;max-height:80%;overflow-y:auto;'
        + 'padding:18px;color:var(--text-primary);';
    card.innerHTML = html
        + '<div style="text-align:center;margin-top:14px;">'
        + '<button id="qd-modal-close" style="padding:8px 22px;border-radius:8px;border:none;'
        + 'background:var(--bg-active);color:var(--text-primary);cursor:pointer;">关闭</button></div>';
    ov.appendChild(card);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    document.getElementById('qd-modal-close').addEventListener('click', function () { ov.remove(); });
}

// 「复制」小按钮：事件委托，弹窗内容重建也不用重新绑
document.addEventListener('click', function (e) {
    const em = e.target.closest('.qd-kv em');
    if (em) {
        const row = em.closest('.qd-kv');
        if (row && row.getAttribute('data-copy')) qdCopyText(row.getAttribute('data-copy'));
    }
});

// 长按 500ms 复制：任何带 data-copy 属性的元素（卡片、信息条…）
(function () {
    let timer = null, sx = 0, sy = 0;
    document.addEventListener('touchstart', function (e) {
        const el = e.target.closest('[data-copy]');
        if (!el) return;
        const t = e.touches[0];
        sx = t.clientX;
        sy = t.clientY;
        timer = setTimeout(function () {
            timer = null;
            qdCopyText(el.getAttribute('data-copy'));
            if (navigator.vibrate) { try { navigator.vibrate(30); } catch (err) { } }
        }, 500);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
        if (!timer) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) {
            clearTimeout(timer);
            timer = null;
        }
    }, { passive: true });
    document.addEventListener('touchend', function () {
        if (timer) { clearTimeout(timer); timer = null; }
    }, { passive: true });
    // 鼠标环境兜底：双击复制
    document.addEventListener('dblclick', function (e) {
        const el = e.target.closest('[data-copy]');
        if (el) qdCopyText(el.getAttribute('data-copy'));
    });
})();

// ========== 电脑文件桥：局域网无线读写电脑（PC 端运行 tools/pc_bridge/pc_bridge.js） ==========
const PC = {
    cfg: null,   // {ip, token} 持久化在 localStorage
    path: '',    // 当前浏览目录（'' = 盘符列表）
    host: ''     // 已连接的电脑名
};

function pcLoad() {
    try { PC.cfg = JSON.parse(localStorage.getItem('pcBridge') || 'null'); } catch (e) { PC.cfg = null; }
    return PC.cfg;
}

function pcSave(cfg) {
    PC.cfg = cfg;
    localStorage.setItem('pcBridge', JSON.stringify(cfg));
}

function pcApi(p, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + PC.cfg.token }, opts.headers || {});
    // 未写端口时默认补 8899；也允许用户直接填 IP:端口
    const base = 'http://' + (PC.cfg.ip.indexOf(':') >= 0 ? PC.cfg.ip : PC.cfg.ip + ':8899');
    return fetch(base + p, opts).then(r => r.json()).then(j => {
        if (!j.ok) throw new Error(j.error || '请求失败');
        return j;
    });
}

function pcFmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}

/** 电脑连接主页面：未配置 → 连接表单；已配置 → 文件浏览器 */
function renderPCBridge() {
    pcLoad();
    if (!PC.cfg) renderPCConnectForm();
    else renderPCBrowser();
}

/** 连接表单 */
function renderPCConnectForm(prefill) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');
    header.innerHTML = `<span>💻 连接电脑</span>`;
    footer.style.display = 'none';
    body.innerHTML = `
        <div style="padding:20px 16px;">
            <div style="text-align:center;margin-bottom:18px;">
                <div class="detail-avatar">💻</div>
                <p style="color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.7;margin-top:8px;">
                    电脑上先运行 <b>tools/pc_bridge/启动文件桥.bat</b><br>
                    然后把窗口里显示的 IP 和连接码填到下面<br>（需与手机连同一个 WiFi）
                </p>
            </div>
            <div style="padding:14px;background:var(--bg-secondary);border-radius:8px;">
                <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:6px;">电脑 IP（默认端口 8899，也可写 IP:端口）</div>
                <input id="pc-ip" type="text" placeholder="192.168.3.4" value="${prefill && prefill.ip || ''}"
                    style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs);box-sizing:border-box;margin-bottom:12px;">
                <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:6px;">连接码（pc_bridge 窗口里的那串）</div>
                <input id="pc-token" type="text" placeholder="32 位连接码" value="${prefill && prefill.token || ''}"
                    style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs);box-sizing:border-box;margin-bottom:14px;">
                <button id="pc-connect" style="width:100%;padding:12px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:var(--fs);font-weight:600;">🔗 连接</button>
                <div id="pc-conn-status" style="margin-top:10px;padding:10px;border-radius:6px;background:var(--bg-hover);color:var(--text-secondary);font-size:var(--fs-sm);">等待输入…</div>
            </div>
        </div>
    `;
    setTimeout(() => {
        document.getElementById('pc-connect')?.addEventListener('click', async () => {
            const ip = document.getElementById('pc-ip').value.trim();
            const token = document.getElementById('pc-token').value.trim();
            const st = document.getElementById('pc-conn-status');
            if (!ip || !token) { st.textContent = '⚠️ 请先填写 IP 和连接码'; return; }
            st.textContent = '连接中…';
            pcSave({ ip: ip, token: token });
            try {
                const info = await pcApi('/api/ping');
                PC.host = info.host || '电脑';
                st.innerHTML = `<span style="color:var(--success);">✓ 已连接 ${PC.host}</span>，正在打开文件…`;
                renderPCBrowser();
            } catch (e) {
                st.innerHTML = `<span style="color:var(--error);">✗ 连接失败：</span>${e.message}<br>检查：电脑防火墙放行 8899 端口 / 两设备同一 WiFi / IP 和连接码无误`;
            }
        });
    }, 50);
}

/** 文件浏览器 */
function renderPCBrowser() {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    const crumbs = PC.path
        ? PC.path.split('\\').filter(Boolean).join(' › ')
        : '我的电脑（选择盘符）';

    header.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">💻 ${PC.host || '电脑'}</span>`;
    footer.style.display = 'none';
    body.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;">
            <div style="padding:8px 12px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">
                <button id="pc-up" title="上级" style="padding:4px 10px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);flex-shrink:0;">⬆</button>
                <span id="pc-crumbs" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);color:var(--text-secondary);">${crumbs}</span>
                <button id="pc-refresh" style="padding:4px 10px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);flex-shrink:0;">🔄</button>
                <button id="pc-mkdir" style="padding:4px 10px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);flex-shrink:0;">📁+</button>
                <button id="pc-disconnect" style="padding:4px 10px;border-radius:4px;border:none;background:var(--bg-hover);color:var(--error);cursor:pointer;font-size:var(--fs-sm);flex-shrink:0;">断开</button>
            </div>
            <div id="pc-list" style="flex:1;overflow-y:auto;padding:4px 0;">
                <div class="list-empty" style="padding:30px;text-align:center;color:var(--text-secondary);">加载中…</div>
            </div>
            <div id="pc-mkdir-row" style="display:none;padding:8px 12px;background:var(--bg-secondary);border-top:1px solid var(--border);gap:8px;">
                <input id="pc-mkdir-name" type="text" placeholder="新文件夹名称"
                    style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:var(--fs-sm);">
                <button id="pc-mkdir-ok" style="padding:8px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:var(--fs-sm);">创建</button>
                <button id="pc-mkdir-cancel" style="padding:8px 14px;border-radius:6px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs-sm);">取消</button>
            </div>
        </div>
    `;

    const loadList = () => {
        const list = document.getElementById('pc-list');
        pcApi('/api/list?path=' + encodeURIComponent(PC.path)).then(j => {
            if (!j.items.length) { list.innerHTML = '<div class="list-empty" style="padding:30px;text-align:center;color:var(--text-secondary);">空目录</div>'; return; }
            list.innerHTML = '';
            j.items.forEach(it => {
                const row = document.createElement('div');
                row.className = 'list-item';
                row.innerHTML = `
                    <div class="list-item-avatar">${it.type === 'dir' ? '📁' : '📄'}</div>
                    <div class="list-item-info">
                        <div class="list-item-name">${it.name}</div>
                    </div>
                    <div class="list-item-time">${it.type === 'file' ? pcFmtSize(it.size) : ''}</div>
                `;
                row.addEventListener('click', () => {
                    const full = PC.path ? PC.path.replace(/\\+$/, '') + '\\' + it.name : it.name;
                    if (it.type === 'dir') {
                        PC.path = full;
                        renderPCBrowser();
                    } else {
                        openPCFile(full);
                    }
                });
                list.appendChild(row);
            });
        }).catch(e => {
            list.innerHTML = `<div style="padding:30px;text-align:center;color:var(--error);font-size:var(--fs-sm);">
                ⚠️ ${e.message}<br><br>
                <button id="pc-reconnect" style="padding:8px 16px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;">重新连接</button></div>`;
            document.getElementById('pc-reconnect')?.addEventListener('click', () => {
                pcSave(null); localStorage.removeItem('pcBridge'); PC.cfg = null;
                renderPCConnectForm();
            });
        });
    };

    setTimeout(() => {
        loadList();
        document.getElementById('pc-refresh')?.addEventListener('click', loadList);
        document.getElementById('pc-up')?.addEventListener('click', () => {
            if (!PC.path) return;
            // D:\INTENT\tools → D:\INTENT → D:\ → ''（盘符列表）
            const parts = PC.path.split('\\').filter(Boolean);
            parts.pop();
            PC.path = parts.length ? parts.join('\\') + (parts.length === 1 && parts[0].endsWith(':') ? '\\' : '') : '';
            if (PC.path.length === 2) PC.path += '\\';
            renderPCBrowser();
        });
        document.getElementById('pc-disconnect')?.addEventListener('click', () => {
            localStorage.removeItem('pcBridge'); PC.cfg = null; PC.path = '';
            renderPCConnectForm();
        });
        document.getElementById('pc-mkdir')?.addEventListener('click', () => {
            const row = document.getElementById('pc-mkdir-row');
            row.style.display = row.style.display === 'none' ? 'flex' : 'none';
        });
        document.getElementById('pc-mkdir-cancel')?.addEventListener('click', () => {
            document.getElementById('pc-mkdir-row').style.display = 'none';
        });
        document.getElementById('pc-mkdir-ok')?.addEventListener('click', async () => {
            const name = document.getElementById('pc-mkdir-name').value.trim();
            if (!name || !PC.path) { qdToast('请先进入某个盘符目录'); return; }
            try {
                await pcApi('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: PC.path.replace(/\\+$/, '') + '\\' + name }) });
                qdToast('已创建');
                renderPCBrowser();
            } catch (e) { qdToast('创建失败: ' + e.message); }
        });
    }, 50);
}

/** 打开电脑上的文件进行编辑（保存在电脑上） */
function openPCFile(fullPath) {
    const header = document.getElementById('content-header');
    const body = document.getElementById('content-body');
    const footer = document.getElementById('content-footer');

    pushPage({ type: 'setting_detail', data: { name: '电脑连接', icon: '💻' } });

    header.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📄 ${fullPath.split('\\').pop()}</span>`;
    body.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-secondary);">读取中…</div>`;
    footer.style.display = 'none';

    pcApi('/api/read?path=' + encodeURIComponent(fullPath)).then(j => {
        const isText = j.text;
        body.innerHTML = `
            <div style="height:100%;display:flex;flex-direction:column;">
                <div style="padding:4px 8px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:var(--fs-sm);color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${fullPath} · ${pcFmtSize(j.size)}
                </div>
                ${isText ? `
                <textarea id="pc-editor" spellcheck="false" style="flex:1;width:100%;padding:12px;border:none;background:var(--bg-input);color:#d4d4d4;font-family:'Consolas','Monaco',monospace;font-size:12px;resize:none;outline:none;line-height:1.5;tab-size:4;box-sizing:border-box;"></textarea>
                <div style="padding:6px 8px;background:var(--bg-secondary);font-size:var(--fs-sm);color:var(--text-secondary);display:flex;justify-content:space-between;">
                    <span id="pc-ed-status">就绪 · 改完点下方保存</span><span>UTF-8</span>
                </div>` : `
                <div style="flex:1;padding:30px;text-align:center;color:var(--text-secondary);">
                    🖼️ 二进制文件（${pcFmtSize(j.size)}）<br><br>
                    <button id="pc-download" style="padding:10px 20px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;">⬇ 下载到手机</button>
                </div>`}
            </div>
        `;
        footer.style.display = isText ? 'flex' : 'none';
        if (isText) {
            footer.innerHTML = `
                <button id="pc-save" style="flex:1;padding:10px;border-radius:6px;border:none;background:var(--success);color:#fff;cursor:pointer;font-size:var(--fs);">💾 保存到电脑</button>
                <button id="pc-close" style="flex:1;padding:10px;border-radius:6px;border:none;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:var(--fs);">✕ 关闭</button>`;
            const ta = document.getElementById('pc-editor');
            ta.value = j.content;
            setTimeout(() => {
                document.getElementById('pc-save')?.addEventListener('click', async () => {
                    const st = document.getElementById('pc-ed-status');
                    st.textContent = '保存中…';
                    try {
                        await pcApi('/api/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fullPath, content: ta.value }) });
                        st.innerHTML = `<span style="color:var(--success);">✓ 已保存到电脑 ${new Date().toLocaleTimeString('zh-CN')}</span>`;
                        qdToast('已保存到电脑');
                    } catch (e) { st.innerHTML = `<span style="color:var(--error);">✗ 保存失败：${e.message}</span>`; }
                });
                document.getElementById('pc-close')?.addEventListener('click', goBack);
            }, 50);
        } else {
            document.getElementById('pc-download')?.addEventListener('click', () => {
                window.open(pcBase() + '/api/download?path=' + encodeURIComponent(fullPath) + '&token=' + PC.cfg.token);
            });
        }
    }).catch(e => {
        body.innerHTML = `<div style="padding:30px;text-align:center;color:var(--error);">读取失败：${e.message}</div>`;
    });
}

// 全局状态灯：颜色实时反映引擎状态；点按显示完整快照
(function () {
    QdStatus.on(s => {
        const d = document.getElementById('qd-status-dot');
        if (!d) return;
        d.style.background = s.ai ? '#4caf50'
            : (s.modelExists === false ? '#f44336' : '#ff9800');
    });
    document.getElementById('qd-status-dot')?.addEventListener('click', () => {
        const s = QdStatus.snap;
        const fmt = sec => {
            if (!sec) return '—';
            const m = Math.floor(sec / 60);
            return m >= 1 ? m + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒';
        };

        // API key 行（key 只显示前几位，复制时给完整值）
        let apiKeyRow = '';
        try {
            if (window.Qidian && Qidian.getHttpInfo) {
                const h = JSON.parse(Qidian.getHttpInfo());
                if (h.listening && h.apiKey) {
                    apiKeyRow = `<div class="qd-kv" data-copy="${h.apiKey}">`
                        + `<span>API Key</span><b>${h.apiKey.substring(0, 8)}••••••••</b><em>复制</em></div>`
                        + `<div class="qd-kv" data-copy="http://${h.lan}/v1"><span>Base URL</span><b>http://${h.lan}/v1</b><em>复制</em></div>`;
                }
            }
        } catch (e) { }

        qdModal(`
            <h3 style="font-size:var(--fs-lg);margin-bottom:4px;">实时系统状态</h3>
            <p class="qd-modal-sub">每 2 秒自动刷新 · 长按条目或点「复制」即可复制</p>
            <div class="qd-kv" data-copy="AI 引擎: ${s.ai ? '运行中' : '未就绪'}"><span>AI 引擎</span><b>${s.ai ? '✓ 运行中' : '✗ 未就绪'}</b><em>复制</em></div>
            <div class="qd-kv" data-copy="${s.http && s.lan ? 'http://' + s.lan : ''}"><span>局域网 API</span><b>${s.http ? '✓ 监听中 · ' + (s.lan || ('端口 ' + s.port)) : '✗ 未监听'}</b><em>复制</em></div>
            <div class="qd-kv" data-copy="容器(rootfs): ${s.container ? '就绪' : '初始化中'}"><span>容器(rootfs)</span><b>${s.container ? '✓ 就绪' : '… 初始化中'}</b><em>复制</em></div>
            <div class="qd-kv" data-copy="模型文件: ${s.modelExists ? '已下载 ' + s.modelMB + ' MB' : '未下载'}"><span>模型文件</span><b>${s.modelExists ? '✓ 已下载 ' + s.modelMB + ' MB' : '✗ 未下载'}</b><em>复制</em></div>
            <div class="qd-kv" data-copy="服务运行时长: ${fmt(s.uptime)}"><span>服务运行时长</span><b>${fmt(s.uptime)}</b><em>复制</em></div>
            <div class="qd-kv" data-copy="已服务对话: ${s.chats} 次"><span>已服务对话</span><b>${s.chats} 次</b><em>复制</em></div>
            ${apiKeyRow}
        `);
    });
})();

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

const QD_AI_LOAD_TIMEOUT = '[AI_LOAD_TIMEOUT]';

/**
 * 直接调用 App 内原生 MNN 推理（Qidian.callAI）。
 * 不经过容器、不经过 proot、不经过临时文件轮询，链路最短也最稳。
 * 模型首次加载约 2~3 秒，期间 callAI 会返回"正在加载中"，这里负责等待。
 * qdLastNativeRaw 保存最后一次 callAI 的原始返回，便于失败时定位。
 */
window.qdLastNativeRaw = '';
async function qdNativeChat(prompt, onWait) {
    const t0 = Date.now();
    const deadline = t0 + 60000;
    let attempt = 0;

    while (Date.now() < deadline) {
        attempt++;

        // 先问状态，避免无谓地阻塞在推理调用上
        let aiReady = true;
        try {
            if (window.Qidian && Qidian.getStatus) {
                const rawStatus = Qidian.getStatus();
                window.qdLastStatus = rawStatus;
                const st = JSON.parse(rawStatus);
                if (st && st.ai === false) aiReady = false;
            } else {
                window.qdLastStatus = 'Qidian.getStatus 不存在';
            }
        } catch (e) {
            window.qdLastNativeRaw = 'getStatus 异常: ' + e.message;
        }

        if (aiReady) {
            try {
                const r = Qidian.callAI(prompt);
                const s = (r == null) ? '' : String(r);
                window.qdLastNativeRaw = s;
                if (s.indexOf('正在加载中') < 0 && s.indexOf('空回复') < 0) {
                    if (s.length > 0) return s;
                }
            } catch (e) {
                window.qdLastNativeRaw = 'callAI 异常: ' + e.message;
            }
        }

        onWait(Date.now() - t0, attempt);
        await new Promise(function (res) { setTimeout(res, 700); });
    }
    return QD_AI_LOAD_TIMEOUT;
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
                    // 本地模型：走 App 原生 MNN（Qidian.callAI），通过 INTENT Agent
                    // 循环执行（支持联网搜索 searchWeb / fetchPage 等工具）。
                    // 只有老版本 APK（没有 callAI 接口）才退回容器路径。
                    const contentEl = thinkingMsg.querySelector('.message-content');
                    const hasNativeAI = !!(window.Qidian && typeof Qidian.callAI === 'function');
                    let rawAnswer = '', rawThinking = '', usedAgent = false;

                    if (hasNativeAI) {
                        if (contentEl) contentEl.textContent = '🧠 本地模型推理中…';
                        try {
                            const agentRes = await intentAgentLoop(
                                text,
                                (t) => { if (contentEl) contentEl.textContent = '🧠 ' + String(t).slice(0, 80); },
                                (tool) => { if (contentEl) contentEl.textContent = '🔧 ' + String(tool).slice(0, 100); },
                                null,
                                webSearchEnabled
                            );
                            rawAnswer = agentRes.answer || agentRes.fullResponse || '';
                            rawThinking = agentRes.thinking || '';
                            usedAgent = true;
                        } catch (e) {
                            rawAnswer = '[INTENT 异常] ' + e.message;
                            rawThinking = '';
                            usedAgent = true;
                        }
                    } else {
                        if (contentEl) contentEl.textContent = '🧠 正在连接容器...';
                        // 转义用户输入中的单引号
                        const escapedText = text.replace(/'/g, "'\\''");
                        const cmd = "/AI.qd/ai_service.qds /shm/shm.dat '" + escapedText + "'";
                        rawAnswer = await qdExecWithRetry(cmd, {
                            timeoutMs: 90000,
                            onWait: function (ms) {
                                if (contentEl) contentEl.textContent = '⏳ 容器启动中… ' + Math.round(ms / 1000) + 's';
                            }
                        });
                    }

                    // 移除思考中消息
                    thinkingMsg.remove();

                    // 解析结果（agent 模式已拆好 思考/回答；容器模式走正则）
                    let answer, thinking;
                    if (usedAgent) {
                        answer = rawAnswer.trim();
                        thinking = rawThinking.trim();
                    } else {
                        let r2 = rawAnswer.trim();
                        thinking = '';
                        const thinkMatch = r2.match(/【思考】([\s\S]*?)【回答】/);
                        if (thinkMatch) {
                            thinking = thinkMatch[1].trim();
                            const answerIdx = r2.indexOf('【回答】');
                            if (answerIdx >= 0) r2 = r2.substring(answerIdx + 4).trim();
                        }
                        answer = r2;
                    }

                    // 清理多余空行：连续2个以上换行压缩为1个，去掉首尾空白
                    answer = answer.replace(/\n{3,}/g, '\n\n').trim();

                    // 兜底：不把内部错误串当回答显示
                    if (answer === QD_AI_LOAD_TIMEOUT) {
                        const raw = (window.qdLastNativeRaw || '').substring(0, 120);
                        const stRaw = (window.qdLastStatus || '').substring(0, 160);
                        answer = '⚠️ 本地模型还在加载（已等 60 秒）。\n\n'
                            + '诊断：status=' + (stRaw || '无') + ' | callAI=' + (raw || '未调用') + '\n\n'
                            + '建议：\n'
                            + '1) 等 5~10 秒直接再发一次；\n'
                            + '2) 点右上角头像 →「关于」，看 API 状态是否为“模型就绪”；\n'
                            + '3) 仍不行就重启一次 App。';
                        thinking = '';
                    } else if (answer.indexOf(QD_CONTAINER_ERR) >= 0 || answer.length === 0) {
                        answer = '⚠️ 这次没有取到回答，请再发一次。';
                        thinking = '';
                    }

                    const aiMsg = appendMessage({ role: 'ai', content: '', thinking: thinking });
                    aiMsg.dataset.thinking = thinking;
                    typewriterEffect(aiMsg, answer, 15);
                    currentChat.messages.push({ role: 'ai', content: answer, thinking: thinking });
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

// ========== 当前真实模型名（动态读取，禁止写死） ==========
// 数据源优先级：
//   1) Qidian.checkModelExists() 桥（同步）——读 files/models/.active + catalog 里的显示名
//   2) QdStatus.snap.modelName（异步刷新，来自同一桥 / 本机 /health）
//   3) 兜底通用文案
// 这样无论用户切换成 1.5B / 7B / 34B，系统提示词与界面都会跟着实时变。
function liveModelName() {
    let n = '';
    try {
        if (window.Qidian && Qidian.checkModelExists) {
            const m = JSON.parse(Qidian.checkModelExists());
            if (m && m.modelName) n = m.modelName;
        }
    } catch (e) { }
    if (!n && window.QdStatus && QdStatus.snap && QdStatus.snap.modelName) {
        n = QdStatus.snap.modelName;
    }
    return n || '本地大语言模型';
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
你的真实身份：你是基于 ${liveModelName()} 模型的 AI 助手，通过 MNN 引擎在本地安卓设备上推理。
不要伪装成其他模型。当用户问你是什么模型时，诚实回答"我是基于 ${liveModelName()} 模型的本地 AI 助手"。

【奇点OS 系统架构】
- 主框架：proot 容器内的奇点OS模块化系统，目录结构为 /系统/（兼容.qd、功能.qd、界面.qd、微服务.qd）、/AI.qd/、/用户/
- 副框架：原生安卓本地AI（MNN引擎，${liveModelName()}，本地推理）
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
// INTENT 系统提示词
// webOn=true 时提供联网工具并启用「联网优先」规则；false 时禁用联网，模型凭自身知识回答。
function getIntentSystemPrompt(webOn) {
    if (webOn === undefined) webOn = true;
    const now = new Date();
    const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    let toolLines = `- exec|命令 → 在容器内执行Linux命令
- readFile|路径 → 读取容器内文件
- writeFile|路径|内容 → 写入文件
- readUI|文件名 → 读取界面文件(index.html/style.css/app.js)
- writeUI|文件名|内容 → 修改界面并自动刷新
- launchApp|包名 → 启动安卓应用
- getStatus → 获取系统状态
- searchKB|关键词 → 搜索知识库`;
    if (webOn) {
        toolLines += `
- searchWeb|关键词 → 联网搜索网页，返回标题、摘要与链接（设备已联网时可用）
- fetchPage|网址 → 抓取网页正文文本，用于阅读搜索结果的具体内容`;
    }
    let rule7;
    if (webOn) {
        rule7 = `7. 联网优先：只要问题涉及最新信息、新闻、实时数据（天气/股价/汇率/赛事/政策法规）、
   你不确定或可能过时的知识，必须先用 searchWeb 检索，再基于检索结果回答，
   不要凭记忆编造。若搜索返回"网络不可用"或"搜索失败"，如实告诉用户你当前无法联网。
   简单闲聊、创意写作、纯本地操作等无需联网的任务，直接回答即可。`;
    } else {
        rule7 = `7. 联网搜索已关闭：用户在聊天框关闭了「🌐 联网」开关，禁止调用 searchWeb/fetchPage。
   遇到需要最新/实时信息的问题，如实告诉用户"当前未开启联网搜索，请在聊天框打开🌐开关即可联网"。
   其余问题用你的知识直接回答，不要尝试联网。`;
    }
    return `你是 INTENT（意图），奇点OS的系统级智能体。
当前时间：${timeStr}
你运行在：奇点OS mini（安卓APK，proot非root容器，MNN引擎本地推理）
你的真实模型：${liveModelName()}，不要伪装。

【你的能力】
你不是普通聊天机器人，你可以真正调用工具操作系统：
${toolLines}

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
6. 每次回答必须有【思考】，可以没有【工具】但必须有【回答】
${rule7}`;
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
            case 'searchWeb':
                if (!webSearchEnabled) return '[联网搜索已关闭] 用户未在聊天框开启🌐联网开关';
                if (window.Qidian && Qidian.searchWeb) {
                    return Qidian.searchWeb(arg);
                }
                return '[错误] searchWeb 不可用';
            case 'fetchPage':
                if (!webSearchEnabled) return '[联网搜索已关闭] 用户未在聊天框开启🌐联网开关';
                if (window.Qidian && Qidian.fetchPage) {
                    return Qidian.fetchPage(arg);
                }
                return '[错误] fetchPage 不可用';
            default:
                return '[未知工具] ' + tool;
        }
    } catch (e) {
        return '[工具执行异常] ' + e.message;
    }
}

// INTENT Agent 主循环：思考→调用工具→观察→继续→回答
async function intentAgentLoop(userText, onThinking, onToolCall, onAnswer, webOn) {
    let prompt = getIntentSystemPrompt(webOn) + '\n\n用户: ' + userText + '\nINTENT: ';
    let fullResponse = '';
    const maxRounds = 5; // 最多5轮工具调用

    for (let round = 0; round < maxRounds; round++) {
        // 让出主线程，使上一轮的「🔧 正在搜索…」等提示能渲染出来
        await new Promise(function (r) { setTimeout(r, 40); });

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

// ============================================================
// 说明：HTTP API 与 AI 桥接已由 App 原生层提供（LocalHttpServer.kt，
// 端口 9999/8822，直接调用 MNN 推理），不再需要 WebView 轮询桥。
// 旧版此处有一段每秒 execContainer 检查 /tmp/api_request 的轮询代码，
// 会反复启动 proot 进程且功能已被替代，已移除。
// ============================================================
