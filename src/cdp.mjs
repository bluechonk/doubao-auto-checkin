// 零依赖 Chrome DevTools Protocol 客户端。
// 依赖 Node 22+ 内置的全局 WebSocket 与 fetch，不需要 ws / puppeteer / playwright。

/** CDP 调用失败时抛出的错误。 */
export class CdpError extends Error {
  constructor(message, { method, code } = {}) {
    super(message);
    this.name = 'CdpError';
    this.method = method;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 请求 CDP 的 HTTP 端点并解析 JSON。 */
export async function fetchJson(port, path, { timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    if (!res.ok) throw new CdpError(`HTTP ${res.status} for ${path}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new CdpError(`timeout after ${timeoutMs}ms: ${path}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 调试端口是否在线。 */
export async function isDebugPortAlive(port) {
  try {
    await fetchJson(port, '/json/version', { timeoutMs: 1500 });
    return true;
  } catch {
    return false;
  }
}

/** 读取浏览器版本信息。 */
export function getBrowserVersion(port) {
  return fetchJson(port, '/json/version');
}

/** 列出全部可调试目标（页面、webview、iframe 等）。 */
export function listTargets(port) {
  return fetchJson(port, '/json/list');
}

/**
 * 按条件查找目标。
 * @param {Array} targets /json/list 返回的数组
 * @param {{ urlIncludes?: string|RegExp, titleIncludes?: string, types?: string[] }} query
 */
export function findTarget(targets, { urlIncludes, titleIncludes, types = ['page', 'webview'] } = {}) {
  return targets.find((t) => {
    if (!types.includes(t.type)) return false;
    if (urlIncludes) {
      const hit = urlIncludes instanceof RegExp ? urlIncludes.test(t.url) : t.url.includes(urlIncludes);
      if (!hit) return false;
    }
    if (titleIncludes && !String(t.title || '').includes(titleIncludes)) return false;
    return Boolean(t.webSocketDebuggerUrl);
  });
}

/** 轮询等待满足条件的目标出现。 */
export async function waitForTarget(port, query, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await listTargets(port).catch(() => []);
    const hit = findTarget(last, query);
    if (hit) return hit;
    await sleep(intervalMs);
  }
  const seen = last.map((t) => `${t.type}:${t.url}`).join('\n  ');
  throw new CdpError(`target not found within ${timeoutMs}ms (url=${query.urlIncludes})\n  ${seen}`);
}

/** 单条 CDP 连接。 */
export class CdpClient {
  #ws;
  #seq = 0;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(ws) {
    this.#ws = ws;
  }

  /** 建立连接。 */
  static async connect(wsUrl, { timeoutMs = 8000 } = {}) {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError(`websocket open timeout: ${wsUrl}`)), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new CdpError(`websocket error: ${wsUrl}`));
      });
    });

    const client = new CdpClient(ws);
    ws.addEventListener('message', (ev) => client.#handleMessage(ev));
    ws.addEventListener('close', () => {
      client.#closed = true;
      for (const { reject } of client.#pending.values()) {
        reject(new CdpError('websocket closed'));
      }
      client.#pending.clear();
    });
    return client;
  }

  #handleMessage(ev) {
    const handle = (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        const entry = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new CdpError(msg.error.message, { method: entry.method, code: msg.error.code }));
        } else {
          entry.resolve(msg.result);
        }
        return;
      }
      if (msg.method) {
        const handlers = this.#listeners.get(msg.method);
        if (handlers) for (const fn of handlers) fn(msg.params, msg);
      }
    };

    if (typeof ev.data === 'string') {
      handle(ev.data);
    } else if (ev.data instanceof ArrayBuffer) {
      handle(new TextDecoder().decode(ev.data));
    } else if (ev.data && typeof ev.data.text === 'function') {
      ev.data.text().then(handle).catch(() => {});
    }
  }

  /** 发送 CDP 命令并等待结果。 */
  send(method, params = {}, { timeoutMs = 20000 } = {}) {
    if (this.#closed) return Promise.reject(new CdpError('websocket closed', { method }));
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`CDP timeout after ${timeoutMs}ms: ${method}`, { method }));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new CdpError(`send failed: ${err.message}`, { method }));
      }
    });
  }

  /** 订阅 CDP 事件。返回取消订阅函数。 */
  on(method, handler) {
    const set = this.#listeners.get(method) || new Set();
    set.add(handler);
    this.#listeners.set(method, set);
    return () => set.delete(handler);
  }

  close() {
    this.#closed = true;
    try {
      this.#ws.close();
    } catch {
      // 忽略重复关闭
    }
  }
}

/**
 * 在页面里执行 JS 并返回结果值。
 * @returns 执行结果（returnByValue），异常时抛错。
 */
export async function evaluate(client, expression, { awaitPromise = true, timeoutMs = 15000, userGesture = true } = {}) {
  const res = await client.send(
    'Runtime.evaluate',
    { expression, awaitPromise, returnByValue: true, userGesture, includeCommandLineAPI: false },
    { timeoutMs },
  );
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails;
    const text = detail.exception?.description || detail.text || 'evaluate failed';
    throw new CdpError(text);
  }
  return res.result?.value;
}

/** 轮询页面表达式，直到返回真值。 */
export async function waitForExpression(client, expression, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression).catch(() => undefined);
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new CdpError(`expression not satisfied within ${timeoutMs}ms: ${expression.slice(0, 120)}`);
}

/**
 * 用真实鼠标事件点击元素中心点。
 * 说明：Electron 里大量“按钮”是 div[role=button]，Element.click() 不一定触发，
 * 因此统一走 Input.dispatchMouseEvent；失败再回退到 DOM click。
 * @param {string} locateExpression 返回 {x, y} 的页面表达式
 */
export async function clickPoint(client, { x, y }) {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y, button: 'none', clickCount: 0 });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}

/** 定位元素并点击：找到返回矩形，点中心；不可见或不存在返回 false。 */
export async function clickSelector(client, selector, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  const locate = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const point = await evaluate(client, locate).catch(() => null);
    if (point) {
      await clickPoint(client, point);
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}
