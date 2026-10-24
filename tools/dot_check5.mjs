const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/3A84B1B9984AA1B39DA6C9B21AC958DD');
const expr = `(() => {
  const item = document.querySelector('.list-item');
  if (!item) return 'no item';
  const cs = getComputedStyle(item);
  // 逐个子元素测 min-content：临时设 item width:100px 看谁撑住
  item.style.width = '100px';
  item.style.minWidth = '0';
  const after = {};
  [...item.children].forEach(c => {
    after[c.className || c.tagName] = Math.round(c.getBoundingClientRect().width);
  });
  const info = item.querySelector('.list-item-info');
  let infoChildren = {};
  if (info) [...info.children].forEach(c => infoChildren[c.className || c.tagName] = Math.round(c.getBoundingClientRect().width));
  item.style.width = ''; item.style.minWidth = '';
  return JSON.stringify({display: cs.display, html: item.innerHTML.replace(/\\s+/g,' ').substring(0, 300), after100px: after, infoChildren});
})()`;
let id = 0;
ws.onopen = () => ws.send(JSON.stringify({id: ++id, method: 'Runtime.evaluate', params: {expression: expr, returnByValue: true}}));
ws.onmessage = (ev) => { console.log(JSON.parse(ev.data).result?.result?.value || ev.data); ws.close(); process.exit(0); };
ws.onerror = () => { console.error('WS error'); process.exit(1); };
setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
