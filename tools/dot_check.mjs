// CDP 检查状态灯真实状态
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/3A84B1B9984AA1B39DA6C9B21AC958DD');
const expr = `(() => {
  const d = document.getElementById('qd-status-dot');
  if (!d) return 'NO DOT ELEMENT';
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const lh = document.querySelector('.list-header');
  return JSON.stringify({
    parent: d.parentElement && (d.parentElement.className || d.parentElement.tagName),
    rect: {x: r.x, y: r.y, w: r.width, h: r.height},
    display: cs.display, bg: cs.backgroundColor, opacity: cs.opacity, visibility: cs.visibility,
    orient: window.innerWidth + 'x' + window.innerHeight + ' ' + (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
    listHeaderChildren: lh ? [...lh.children].map(c => c.id || c.className || c.tagName) : null
  });
})()`;
let id = 0;
ws.onopen = () => ws.send(JSON.stringify({id: ++id, method: 'Runtime.evaluate', params: {expression: expr, returnByValue: true}}));
ws.onmessage = (ev) => { console.log(ev.data); ws.close(); process.exit(0); };
ws.onerror = (e) => { console.error('WS error', e.message); process.exit(1); };
setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
