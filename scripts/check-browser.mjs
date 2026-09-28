import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { classifyRaid } from './raid-status.mjs';
import { loadConfig } from './config.mjs';

// Read-only smoke test. Never reads cookies, storage, or form input values.
const output = new URL('../.local/checks/', import.meta.url);
let port = 19227;
let expectedXAccount = null;
let expectedRepublicAccount = null;

function safeUrl(value) {
  const url = new URL(value);
  return url.origin + url.pathname;
}

async function inspect(tab, name) {
  const endpoint = new URL(tab.webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port) {
    throw new Error('Unexpected browser debugging endpoint.');
  }
  const socket = new WebSocket(endpoint);
  const pending = new Map();
  let sequence = 0;
  function failPending(message) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  }
  socket.addEventListener('close', () => failPending('Browser connection closed.'));
  socket.addEventListener('error', () => failPending('Browser connection failed.'));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, method === 'Runtime.evaluate' ? 20000 : 10000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser connection timed out.')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser connection failed.')); }, { once: true });
    });
    const evaluated = await send('Runtime.evaluate', {
      expression: `(async () => {
        const page = { url: location.origin + location.pathname, readyState: document.readyState };
        if (location.origin === 'https://x.com') {
          page.xAccount = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.innerText ?? null;
          return page;
        }
        if (location.origin !== 'https://republic.legion.cc') throw new Error('Page origin changed.');
        const auth = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(7000) });
        page.auth = { httpStatus: auth.status };
        if (!auth.ok) return page;
        const user = await auth.json();
        page.auth.username = typeof user.username === 'string' ? user.username : null;
        page.auth.authorized = user.isAuthorized === true;
        page.auth.linkedXAccount = typeof user.twitterUsername === 'string' ? user.twitterUsername : null;
        page.auth.vpAvailable = typeof user.vpUsable === 'number' ? user.vpUsable : null;
        if (user.username !== ${JSON.stringify(expectedRepublicAccount)} || !page.auth.authorized) return page;
        const endpoint = performance.getEntriesByType('resource').map(e => new URL(e.name))
          .filter(u => u.origin === location.origin && u.pathname === '/api/raids').at(-1);
        if (!endpoint) { page.raids = { error: 'Open the Republic raids page and wait for loading to finish.' }; return page; }
        const response = await fetch(endpoint.href, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(7000) });
        page.raids = { httpStatus: response.status };
        if (!response.ok) return page;
        const rows = await response.json();
        if (!Array.isArray(rows)) { page.raids.error = 'Unexpected raid response format.'; return page; }
        const fields = ['id', 'targetName', 'targetHandle', 'tweetUrl', 'expiresAt', 'status', 'hasJoined', 'hasSubmitted', 'submissionStatus', 'viewerRaidStatus', 'feedback', 'requirements'];
        page.raids.rows = rows.map(row => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]])));
        return page;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails || !evaluated.result?.value) throw new Error('Could not read the page or server response.');
    const page = evaluated.result.value;
    // X identity is checked from the visible account switcher, never from a profile page.
    const identity = name === 'x'
      ? (page.xAccount?.match(/@[A-Za-z0-9_]+/g) ?? [])
      : [];
    // Capture Republic only, avoiding X authentication screens and credential entry.
    let screenshot = null;
    if (name === 'republic' && page.url === 'https://republic.legion.cc/raids' && page.auth?.username === expectedRepublicAccount && page.auth.authorized) {
      const capture = await send('Page.captureScreenshot', { format: 'png' });
      const path = new URL(`${name}-${tab.id}.png`, output);
      await writeFile(path, Buffer.from(capture.data, 'base64'));
      screenshot = fileURLToPath(path);
    }
    const accountMatches = name === 'x'
      ? identity.length === 1 && identity[0].toLowerCase() === expectedXAccount
      : page.auth?.httpStatus === 200 && page.auth.username === expectedRepublicAccount && page.auth.authorized === true;
    if (page.raids?.rows) {
      page.raids.rows = page.raids.rows.map(row => ({ ...row, assessment: classifyRaid(row) }));
      page.raids.counts = {};
      for (const row of page.raids.rows) page.raids.counts[row.assessment] = (page.raids.counts[row.assessment] ?? 0) + 1;
    }
    return { tabId: tab.id, ...page, identity, accountMatches, screenshot };
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket.close();
  }
}

const report = {
  checkedAt: new Date().toISOString(), port, mode: 'read-only',
  expectedRepublicAccount, expectedXAccount, status: 'error',
  pages: [], missing: [], localHistory: 'not-imported',
};
try {
  ({ port, expectedXAccount, expectedRepublicAccount } = await loadConfig());
  Object.assign(report, { port, expectedXAccount, expectedRepublicAccount });
  if (!expectedXAccount || !expectedRepublicAccount) {
    throw new Error('Configure both expected accounts in .local/config.json or environment variables before connecting.');
  }
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Browser tab lookup failed: HTTP ${response.status}`);
  const tabs = await response.json();
  await mkdir(output, { recursive: true });
  for (const [name, origin] of [['republic', 'https://republic.legion.cc'], ['x', 'https://x.com']]) {
    const matches = tabs.filter(tab => tab.type === 'page' && (tab.url === origin || tab.url?.startsWith(origin + '/')));
    if (!matches.length) report.missing.push(name);
    // Inspect one relevant tab; never collect text from unrelated pages or X messages.
    const tab = matches.find(t => new URL(t.url).pathname === (name === 'republic' ? '/raids' : '/home')) ?? matches[0];
    if (tab) {
      try {
        report.pages.push({ site: name, ...await inspect(tab, name) });
      } catch (error) {
        report.pages.push({ site: name, tabId: tab.id, url: safeUrl(tab.url), error: error.message });
        process.exitCode = 1;
      }
    }
  }
  const apiFailed = report.pages.some(page => page.site === 'republic' && (
    (page.auth?.httpStatus >= 500) || (page.raids?.httpStatus && page.raids.httpStatus !== 200) ||
    (page.raids?.httpStatus === 200 && !Array.isArray(page.raids.rows))
  ));
  if (apiFailed) process.exitCode = 1;
  if (process.exitCode !== 1) {
    process.exitCode = report.missing.length || report.pages.some(page => !page.accountMatches || (page.site === 'republic' && !page.raids?.rows)) ? 2 : 0;
  }
  report.status = process.exitCode === 1 ? 'error' : process.exitCode === 2 ? 'needs_attention' : 'passed';
} catch (error) {
  report.error = `Browser check failed: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`;
  process.exitCode = 1;
}
await mkdir(output, { recursive: true });
await writeFile(new URL('browser-check.json', output), JSON.stringify(report, null, 2) + '\n');
// Keep full requirements in the private report; print a compact result.
console.log(JSON.stringify({ ...report, pages: report.pages.map(page => ({
  ...page,
  ...(page.raids?.rows ? { raids: { ...page.raids, rows: page.raids.rows.map(({ requirements, ...row }) => ({
    ...row, requirementsMode: requirements?.mode ?? null,
  })) } } : {}),
})) }, null, 2));
