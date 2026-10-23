#!/usr/bin/env node
/**
 * 起点OS mini —— 电脑文件桥（PC File Bridge）
 * =============================================
 * 让手机在同一局域网内无线浏览 / 读取 / 修改 / 上传 / 下载电脑文件。
 * 零依赖，Node 12+ 直接运行：node pc_bridge.js
 *
 * 安全模型：
 *  - 首次运行自动生成随机 token 存到脚本同目录 pc_bridge.token，
 *    手机端必须携带该 token（Authorization: Bearer <token> 或 ?token=）才能访问
 *  - 所有响应带 CORS 头（手机 WebView 直接 fetch）
 *  - 可选 --root <目录> 参数把访问范围限制在某个目录树内（默认全盘）
 *
 * API 一览（均需 token，除 /api/ping 外）：
 *  GET  /api/ping                  → 连通性测试 + 电脑信息
 *  GET  /api/list?path=<目录>      → 列目录（path 为空 = 列出所有盘符）
 *  GET  /api/read?path=<文件>      → 读文本文件（≤8MB）
 *  POST /api/write  {path,content} → 写文本文件
 *  GET  /api/download?path=<文件>  → 下载二进制文件
 *  POST /api/upload?path=<目标>    ← 上传二进制文件（body 为原始字节）
 *  POST /api/mkdir  {path}         → 新建目录
 *  POST /api/delete {path}         → 删除文件/空目录（移入回收站不可用，直接删，慎用）
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PC_BRIDGE_PORT || 8899;
const SCRIPT_DIR = __dirname;

// ---- root 限制（可选）----
let ROOT = null;
{
    const i = process.argv.indexOf('--root');
    if (i >= 0 && process.argv[i + 1]) ROOT = path.resolve(process.argv[i + 1]);
}

// ---- token ----
const tokenFile = path.join(SCRIPT_DIR, 'pc_bridge.token');
let TOKEN;
try {
    TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
    if (!TOKEN) throw new Error('empty');
} catch (e) {
    TOKEN = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(tokenFile, TOKEN, 'utf8');
}

// ---- 工具 ----
function log(...a) { console.log(new Date().toLocaleTimeString('zh-CN'), ...a); }

function lanIPs() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const it of ifs[name] || []) {
            if (it.family === 'IPv4' && !it.internal) out.push(it.address);
        }
    }
    return out;
}

/** 路径安全检查：解析后必须落在 ROOT 内（若设置） */
function safePath(p) {
    if (!p) return ROOT || null;
    const abs = path.resolve(p);
    if (ROOT && !(abs === ROOT || abs.startsWith(ROOT + path.sep))) {
        throw new Error('超出允许访问的根目录: ' + ROOT);
    }
    return abs;
}

function sendJSON(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(body);
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (limit && size > limit) { reject(new Error('body 太大')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function isTextFile(name) {
    return /\.(txt|md|markdown|json|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|less|xml|yml|yaml|toml|ini|cfg|conf|py|java|kt|kts|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bat|cmd|ps1|gradle|properties|sql|vue|svelte|dart|swift|r|m|pl|lua|vim|gitignore|editorconfig|env|log|csv)$/i.test(name)
        || !path.extname(name); // 无扩展名的大概率是文本（Makefile、LICENSE 等）
}

function listDrives() {
    // Windows: 探测 A-Z 盘符；其他系统返回 /
    if (process.platform !== 'win32') {
        return [{ name: '/', type: 'dir', path: '/' }];
    }
    const drives = [];
    for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i) + ':\\';
        try {
            fs.accessSync(letter, fs.constants.R_OK);
            drives.push({ name: letter, type: 'dir', path: letter });
        } catch (e) { /* 盘符不存在 */ }
    }
    return drives;
}

// ---- 路由 ----
async function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const pathname = u.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        });
        return res.end();
    }

    // token 校验
    const auth = req.headers['authorization'] || '';
    const provided = auth.replace(/^Bearer\s+/i, '') || u.searchParams.get('token') || '';
    const needToken = pathname !== '/api/ping';
    if (needToken && provided !== TOKEN) {
        return sendJSON(res, 401, { ok: false, error: 'token 不匹配，请在手机端重新输入电脑上显示的连接码' });
    }

    try {
        // ---- ping ----
        if (pathname === '/api/ping') {
            return sendJSON(res, 200, {
                ok: true, host: os.hostname(), platform: process.platform,
                user: os.userInfo().username, root: ROOT, hasToken: TOKEN.length > 0
            });
        }

        // ---- list ----
        if (pathname === '/api/list' && req.method === 'GET') {
            const p = safePath(u.searchParams.get('path') || '');
            if (!p) return sendJSON(res, 200, { ok: true, path: '', items: listDrives() });
            const entries = fs.readdirSync(p, { withFileTypes: true });
            const items = [];
            for (const e of entries) {
                if (e.name.startsWith('$')) continue; // 系统垃圾目录
                let size = 0, mtime = 0;
                try {
                    const st = fs.statSync(path.join(p, e.name));
                    size = st.size; mtime = st.mtimeMs;
                } catch (err) { continue; } // 无权限的跳过
                items.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size, mtime });
            }
            items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : (a.type === 'dir' ? -1 : 1)));
            log('LIST', p, `(${items.length} 项)`);
            return sendJSON(res, 200, { ok: true, path: p, items });
        }

        // ---- read ----
        if (pathname === '/api/read' && req.method === 'GET') {
            const p = safePath(u.searchParams.get('path'));
            const st = fs.statSync(p);
            if (st.isDirectory()) return sendJSON(res, 400, { ok: false, error: '这是目录不是文件' });
            if (st.size > 8 * 1024 * 1024) return sendJSON(res, 400, { ok: false, error: '文件超过 8MB，请用下载' });
            const asText = isTextFile(p);
            if (asText) {
                const content = fs.readFileSync(p, 'utf8');
                log('READ', p, `(${st.size} B)`);
                return sendJSON(res, 200, { ok: true, path: p, content, size: st.size, text: true });
            }
            // 二进制：base64（小文件）或提示走 download
            if (st.size > 1 * 1024 * 1024) return sendJSON(res, 400, { ok: false, error: '二进制文件请用 /api/download', size: st.size });
            const b64 = fs.readFileSync(p).toString('base64');
            log('READ(bin)', p, `(${st.size} B)`);
            return sendJSON(res, 200, { ok: true, path: p, content: b64, size: st.size, text: false });
        }

        // ---- write ----
        if (pathname === '/api/write' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req, 12 * 1024 * 1024)).toString('utf8') || '{}');
            const p = safePath(body.path);
            fs.writeFileSync(p, body.content, 'utf8');
            log('WRITE', p, `(${Buffer.byteLength(body.content)} B)`);
            return sendJSON(res, 200, { ok: true, path: p, size: Buffer.byteLength(body.content) });
        }

        // ---- mkdir ----
        if (pathname === '/api/mkdir' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
            const p = safePath(body.path);
            fs.mkdirSync(p, { recursive: true });
            log('MKDIR', p);
            return sendJSON(res, 200, { ok: true, path: p });
        }

        // ---- delete ----
        if (pathname === '/api/delete' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
            const p = safePath(body.path);
            const st = fs.statSync(p);
            if (st.isDirectory()) fs.rmdirSync(p); else fs.unlinkSync(p);
            log('DELETE', p);
            return sendJSON(res, 200, { ok: true });
        }

        // ---- download ----
        if (pathname === '/api/download' && req.method === 'GET') {
            const p = safePath(u.searchParams.get('path'));
            const st = fs.statSync(p);
            if (st.isDirectory()) return sendJSON(res, 400, { ok: false, error: '这是目录' });
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': st.size,
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`,
                'Access-Control-Allow-Origin': '*'
            });
            log('DOWNLOAD', p, `(${st.size} B)`);
            return fs.createReadStream(p).pipe(res);
        }

        // ---- upload ----
        if (pathname === '/api/upload' && req.method === 'POST') {
            const p = safePath(u.searchParams.get('path'));
            const buf = await readBody(req, 512 * 1024 * 1024);
            fs.writeFileSync(p, buf);
            log('UPLOAD', p, `(${buf.length} B)`);
            return sendJSON(res, 200, { ok: true, path: p, size: buf.length });
        }

        return sendJSON(res, 404, { ok: false, error: '未知接口: ' + pathname });
    } catch (e) {
        log('ERROR', e.message);
        return sendJSON(res, 500, { ok: false, error: e.message });
    }
}

const server = http.createServer((req, res) => {
    handle(req, res).catch(e => sendJSON(res, 500, { ok: false, error: e.message }));
});

server.listen(PORT, '0.0.0.0', () => {
    const ips = lanIPs();
    console.log('==============================================');
    console.log('  起点OS mini · 电脑文件桥 已启动');
    console.log('==============================================');
    console.log('  端口      :', PORT);
    console.log('  本机 IP   :');
    ips.forEach(ip => console.log('              http://' + ip + ':' + PORT));
    console.log('  连接码    :', TOKEN);
    console.log('  允许范围  :', ROOT || '整个电脑（所有盘符）');
    console.log('----------------------------------------------');
    console.log('  手机端：设置 → 电脑连接 → 填入上面的 IP 和连接码');
    console.log('  关闭本窗口即停止服务。连接码保存在 pc_bridge.token');
    console.log('==============================================');
});

