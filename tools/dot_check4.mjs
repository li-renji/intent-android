const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/3A84B1B9984AA1B39DA6C9B21AC958DD');
const expr = `(() => {
  const lc = document.getElementById('list-content');
  const out = { items: [] };
  [...lc.children].forEach(c => {
    out.items.push({cls: c.className, w: Math.round(c.getBoundingClientRect().width), sw: c.scrollWidth, style: c.getAttribute('style') ? c.getAttribute('style').substring(0,80) : ''});
  });
  // 找出最宽的深层元素
  let maxW = 0, maxEl = '';
  lc.querySelectorAll('*').forEach(e => {
    const w = e.getBoundingClientRect().width;
    if (w > maxW) { maxW = w; maxEl = e.className + '|' + (e.textContent || '').substring(0, 40); }
  });
  out.widest = [Math.round(maxW), maxEl];
  return JSON.stringify(out);
})()`;
let id = 0;
ws.onopen = () => ws.send(JSON.stringify({id: ++id, method: 'Runtime.evaluate', params: {expression: expr, returnByValue: true}}));
ws.onmessage = (ev) => { console.log(JSON.parse(ev.data).result?.result?.value || ev.data); ws.close(); process.exit(0); };
ws.onerror = () => { console.error('WS error'); process.exit(1); };
setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
