// 签到核心状态机：探测页面 -> 判定状态 -> 触发签到 -> 校验回调 -> 输出明确结论。

import { CdpClient, clickPoint, evaluate, findTarget, listTargets, waitForTarget } from './cdp.mjs';

/** 页面内使用的锚点。优先用语义化的 data-* 属性，避免依赖构建后带哈希的 class 名。 */
export const ANCHORS = {
  /** 每日签到卡片 */
  signinCard: '[data-reward-code="daily_signin"]',
  /** 已签到后出现的对勾标记 */
  rewardedMark: '[class*="rewarded-"]',
  /** 积分数字 */
  pointsValue: '[class*="pointsValue"]',
  /** 签到按钮文案 */
  signinButtonText: '立即签到',
  /** 签到页 URL 特征 */
  pageUrl: 'pc/agent-explore',
  /** 账号菜单里的签到页入口文案 */
  signinEntryText: '免费领额度',
  /** 签到接口 */
  checkinApi: '/alice/ug/campaign/landing/checkin',
  /** 活动接口所在前缀（含签到后的详情刷新） */
  campaignApi: '/alice/ug/campaign/',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读取当前页面签到状态。 */
export async function readSigninState(client) {
  const raw = await evaluate(
    client,
    `(() => {
      const card = document.querySelector(${JSON.stringify(ANCHORS.signinCard)});
      const button = card ? card.querySelector('button') : null;
      const rewarded = card ? !!card.querySelector(${JSON.stringify(ANCHORS.rewardedMark)}) : false;
      const points = [...document.querySelectorAll(${JSON.stringify(ANCHORS.pointsValue)})]
        .map((el) => Number(String(el.textContent || '').replace(/[^0-9]/g, '')))
        .filter((n) => Number.isFinite(n));
      return JSON.stringify({
        url: location.href,
        title: document.title,
        nodeCount: document.getElementsByTagName('*').length,
        frameCount: window.frames.length,
        hasCard: !!card,
        cardText: card ? card.textContent.trim() : null,
        hasButton: !!button,
        buttonText: button ? button.textContent.trim() : null,
        buttonDisabled: button ? !!button.disabled : null,
        hasRewardedMark: rewarded,
        points,
        signedWords: /已签到|今日已签到/.test(document.body.innerText || ''),
        loginWords: /扫码登录|登录后|请登录/.test(document.body.innerText || ''),
      });
    })()`,
  );
  return JSON.parse(raw);
}

/** 依据页面快照判定状态。 */
export function classifyState(state) {
  if (!state.hasCard) {
    if (state.loginWords) return 'not_logged_in';
    return 'no_card';
  }
  if (state.hasButton && state.buttonText && state.buttonText.includes(ANCHORS.signinButtonText) && !state.buttonDisabled) {
    return 'pending';
  }
  if (state.hasRewardedMark || (!state.hasButton && state.signedWords)) return 'checked_in';
  if (state.hasButton && state.buttonDisabled) return 'disabled';
  return 'unknown';
}

/**
 * 定位左下角账号按钮：带菜单、含头像、位于侧栏底部。
 * 不依赖昵称文案，换账号也能命中。
 */
const LOCATE_ACCOUNT = `(() => {
  const vh = innerHeight;
  const footer = [...document.querySelectorAll('button[aria-haspopup="menu"]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 100 && r.height > 24 && r.y > vh - 140 && r.y < vh - 2;
  });
  if (!footer.length) return null;
  const withAvatar = footer.filter((el) => el.querySelector('img'));
  const el = withAvatar[0] || footer.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)[0];
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`;

/** 在已打开的菜单里定位「免费领额度」入口。 */
const LOCATE_ENTRY = `(() => {
  const entry = ${JSON.stringify(ANCHORS.signinEntryText)};
  const menus = [...document.querySelectorAll('[role="menu"]')].filter((m) => {
    const r = m.getBoundingClientRect();
    return r.width > 20 && r.height > 20;
  });
  for (const menu of menus) {
    if (!(menu.innerText || '').includes(entry)) continue;
    const nodes = [...menu.querySelectorAll('*')].filter((el) => (el.textContent || '').trim() === entry);
    const visible = nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });
    if (!visible.length) continue;
    const el = visible.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    })[0];
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
})()`;

/** 通过左下角账号菜单打开「免费领额度」页。 */
async function openSigninPageViaMenu(chatClient, { log = () => {}, readyTimeoutMs = 25000 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 菜单可能已经开着（用户或上一次操作留下的），先用现成的
    let entryPoint = await evaluate(chatClient, LOCATE_ENTRY).catch(() => null);
    if (!entryPoint) {
      // 冷启动时界面渲染慢，先等账号按钮出现
      let accountPoint = null;
      const readyDeadline = Date.now() + readyTimeoutMs;
      while (Date.now() < readyDeadline && !accountPoint) {
        accountPoint = await evaluate(chatClient, LOCATE_ACCOUNT).catch(() => null);
        if (!accountPoint) await sleep(500);
      }
      if (!accountPoint) throw new Error('未找到左下角账号按钮');
      await clickPoint(chatClient, accountPoint);
      log('clicked account button');
      for (let i = 0; i < 12 && !entryPoint; i++) {
        await sleep(300);
        entryPoint = await evaluate(chatClient, LOCATE_ENTRY).catch(() => null);
      }
    }
    if (entryPoint) {
      await clickPoint(chatClient, entryPoint);
      log('clicked "免费领额度"');
      return true;
    }
    // 菜单被误关或未响应，下一轮重试
    log('account menu not open yet, retrying');
    await sleep(400);
  }
  throw new Error('账号菜单里没有找到「免费领额度」入口');
}

/**
 * 确保签到页已打开。
 * 已打开则直接复用；未打开则通过客户端 UI 进入。
 */
export async function ensureSigninPage(port, { log = () => {}, timeoutMs = 25000 } = {}) {
  const targets = await listTargets(port);
  const existing = findTarget(targets, { urlIncludes: ANCHORS.pageUrl });
  if (existing) return { target: existing, opened: false };

  const chat =
    findTarget(targets, { urlIncludes: 'doubao-chat/chat' }) ||
    findTarget(targets, { urlIncludes: 'doubao://', types: ['page'] }) ||
    findTarget(targets, { titleIncludes: '豆包', types: ['page'] });
  if (!chat) throw new Error('未找到豆包主界面，无法进入签到页');

  const chatClient = await CdpClient.connect(chat.webSocketDebuggerUrl);
  try {
    await chatClient.send('Runtime.enable');
    await openSigninPageViaMenu(chatClient, { log });
  } finally {
    chatClient.close();
  }

  const target = await waitForTarget(port, { urlIncludes: ANCHORS.pageUrl }, { timeoutMs });
  return { target, opened: true };
}

/** 挂载签到相关接口监听，返回收集器。 */
function attachCheckinNetwork(client) {
  const records = [];
  const byId = new Map();
  const pendingBodies = [];

  client.on('Network.requestWillBeSent', (p) => {
    // 覆盖签到接口与随后的活动详情刷新
    if (!p.request?.url?.includes(ANCHORS.campaignApi)) return;
    byId.set(p.requestId, {
      url: p.request.url.split('?')[0],
      method: p.request.method,
      postData: p.request.postData || null,
      status: null,
      body: null,
      at: Date.now(),
    });
  });

  client.on('Network.responseReceived', (p) => {
    const rec = byId.get(p.requestId);
    if (!rec) return;
    rec.status = p.response.status;
  });

  client.on('Network.loadingFinished', (p) => {
    const rec = byId.get(p.requestId);
    if (!rec || rec.body !== null) return;
    const task = client
      .send('Network.getResponseBody', { requestId: p.requestId }, { timeoutMs: 3000 })
      .then((res) => {
        rec.body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
        records.push(rec);
      })
      .catch(() => {
        rec.body = null;
        records.push(rec);
      });
    pendingBodies.push(task);
  });

  return {
    enabled: false,
    async enable() {
      await client.send('Network.enable', { maxPostDataSize: 200000 });
      this.enabled = true;
    },
    /** 等所有响应体落地后返回记录。 */
    async take() {
      await Promise.allSettled(pendingBodies);
      return records.slice();
    },
  };
}

/** 从接口返回体里提取业务码与提示语。 */
function parseApiResult(body) {
  if (!body) return null;
  try {
    const json = JSON.parse(body);
    const code = json.status_code ?? json.code ?? json.err_no ?? null;
    const message = json.status_msg ?? json.message ?? json.msg ?? null;
    return { code, message, keys: Object.keys(json).slice(0, 12) };
  } catch {
    return null;
  }
}

/**
 * 执行签到。
 * @returns {Promise<object>} 结构化结果
 */
export async function runCheckin({ port = 9222, dryRun = false, log = () => {}, timeoutMs = 20000 } = {}) {
  const { target, opened } = await ensureSigninPage(port, { log });
  log(`signin page: ${target.url}`);

  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  const net = attachCheckinNetwork(client);
  const result = {
    page: { url: target.url, opened },
    before: null,
    after: null,
    action: 'none',
    status: 'unknown',
    message: '',
    reward: null,
    api: null,
    network: [],
  };

  try {
    await client.send('Runtime.enable');
    await net.enable();

    // 等页面既有卡片又有结论状态
    await waitForSigninReady(client, { timeoutMs });
    const before = await readSigninState(client);
    result.before = before;
    const state = classifyState(before);
    log(`state before: ${state}`);

    if (state === 'checked_in') {
      result.status = 'already_checked_in';
      result.action = 'skipped';
      result.after = before;
      result.message = `今日已签到，无需重复签到（签到按钮已替换为对勾图标，页面无可点击签到入口）`;
      return result;
    }

    if (state === 'not_logged_in') {
      throw new Error('客户端未登录，请先登录豆包后再执行签到');
    }
    if (state === 'no_card') {
      throw new Error('页面上没有找到「每日签到」卡片，可能页面未加载完成或活动未开放');
    }
    if (state === 'disabled') {
      throw new Error('「立即签到」按钮处于禁用状态，无法触发签到');
    }
    if (state !== 'pending') {
      throw new Error(`签到状态无法判定（button=${before.hasButton}, rewarded=${before.hasRewardedMark}）`);
    }

    if (dryRun) {
      result.status = 'dry_run';
      result.action = 'detected';
      result.after = before;
      result.message = '已定位「立即签到」按钮，按 --dry-run 要求不执行点击';
      return result;
    }

    // 真实点击
    const point = await evaluate(
      client,
      `(() => {
        const card = document.querySelector(${JSON.stringify(ANCHORS.signinCard)});
        const button = card && card.querySelector('button');
        if (!button) return null;
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`,
    );
    if (!point) throw new Error('「立即签到」按钮已消失，可能状态刚刚变化');

    await clickPoint(client, point);
    result.action = 'clicked';
    log('clicked "立即签到"');

    // 等状态收敛
    const deadline = Date.now() + timeoutMs;
    let after = before;
    let finalState = 'pending';
    while (Date.now() < deadline) {
      await sleep(400);
      after = await readSigninState(client).catch(() => after);
      finalState = classifyState(after);
      if (finalState !== 'pending' && finalState !== 'unknown') break;
    }
    // 再等接口返回体和积分刷新
    await sleep(600);
    result.after = await readSigninState(client).catch(() => after);
    result.network = await net.take();

    const checkinCall = result.network.find((r) => r.url.includes(ANCHORS.checkinApi)) || null;
    if (checkinCall) {
      result.api = { status: checkinCall.status, ...(parseApiResult(checkinCall.body) || {}) };
    }

    const pointsBefore = before.points[0] ?? null;
    const pointsAfter = result.after.points[0] ?? null;
    result.reward = {
      pointsBefore,
      pointsAfter,
      delta: pointsBefore !== null && pointsAfter !== null ? pointsAfter - pointsBefore : null,
    };

    const settled = classifyState(result.after);
    if (settled === 'checked_in') {
      result.status = 'checked_in';
      const deltaText =
        result.reward.delta !== null && result.reward.delta > 0
          ? `，额度 ${result.reward.pointsBefore} → ${result.reward.pointsAfter}`
          : '';
      result.message = `签到成功${deltaText}`;
      return result;
    }

    // 接口成功但 UI 未收敛，允许按接口结果判定
    if (checkinCall && checkinCall.status === 200) {
      result.status = 'checked_in';
      result.message = '签到接口返回成功，但页面状态未刷新，请打开签到页确认';
      return result;
    }

    const apiText = result.api ? `，签到接口 HTTP ${result.api.status ?? '-'}` : '，未捕获到签到接口请求';
    result.status = 'failed';
    result.message = `点击后签到状态未变为已签到（当前判定：${settled}${apiText}）`;
    return result;
  } finally {
    client.close();
  }
}

/** 等页面出现签到卡片或明确状态。 */
async function waitForSigninReady(client, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readSigninState(client).catch(() => null);
    if (state && (state.hasCard || state.loginWords)) return state;
    await sleep(400);
  }
  return null;
}
