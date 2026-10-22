// 通用 CDP 检查脚本：从 /json 自动取第一个 page
import net from 'net';
import http from 'http';

const list = await new Promise((res, rej) => {
  http.get('http://127.0.0.1:9222/json', r => {
    let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});
const page = list.find(t => t.type === 'page');
if (!page) { console.error('no page'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
const expr = process.argv[2] || `document.title`;
let id = 0;
ws.onopen = () => ws.send(JSON.stringify({id: ++id, method: 'Runtime.evaluate', params: {expression: expr, returnByValue: true}}));
ws.onmessage = (ev) => {
  const d = JSON.parse(ev.data);
  console.log(d.result?.result?.value ?? JSON.stringify(d));
  ws.close(); process.exit(0);
};
ws.onerror = (e) => { console.error('WS error', e.message || e); process.exit(1); };
setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
