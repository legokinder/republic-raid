import { writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

export const root = new URL('../.local/raids/', import.meta.url);
export async function save(name, value) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid record name');
  await mkdir(root, { recursive: true });
  const target = new URL(name, root);
  const temp = new URL(name + '.tmp', root);
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, target);
}

export async function connect(site, tabId) {
  const { port } = await loadConfig();
  const origin = site === 'republic' ? 'https://republic.legion.cc' : site === 'x' ? 'https://x.com' : null;
  if (!origin) throw new Error('Unknown site');
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  const matches = tabs.filter(t => t.type === 'page' && (t.url === origin || t.url?.startsWith(origin + '/')) && (!tabId || t.id === tabId));
  if (matches.length > 1) throw new Error(`${site} has multiple tabs; specify the observed tab ID`);
  const tab = matches[0];
  if (!tab) throw new Error(`${site} tab missing`);
  const endpoint = new URL(tab.webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port) throw new Error('Unexpected endpoint');
  const ws = new WebSocket(endpoint);
  let id = 0;
  const pending = new Map();
  function fail(error) {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
  }
  ws.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id); clearTimeout(p.timer);
    if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
  });
  ws.addEventListener('error', () => fail(new Error('CDP connection error')));
  ws.addEventListener('close', () => fail(new Error('CDP connection closed')));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once:true});
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection error')); }, {once:true});
  });
  function send(method, params = {}) {
    return new Promise((resolve,reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out; verify before retrying`)); }, 20000);
      pending.set(key, {resolve,reject,timer});
      ws.send(JSON.stringify({id:key,method,params}));
    });
  }
  return {
    id: tab.id, send,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async navigate(url) {
      if (new URL(url).origin !== origin) throw new Error('Unexpected navigation origin');
      const r = await send('Page.navigate', {url});
      if (r.errorText) throw new Error(r.errorText);
      return r;
    },
    async screenshot(name) {
      if (!/^[a-zA-Z0-9_.-]+\.png$/.test(name)) throw new Error('Invalid screenshot name');
      await mkdir(root, {recursive:true});
      await send('Page.bringToFront');
      const r = await send('Page.captureScreenshot', {format:'png'});
      const path = new URL(name, root);
      await writeFile(path, Buffer.from(r.data,'base64'));
      return fileURLToPath(path);
    },
    close() { ws.close(); },
  };
}
