// 客户端启动/重启：豆包是 Electron 应用，必须在启动那一刻带 --remote-debugging-port 才能接入 CDP。
// 只做 Windows 实现：用 taskkill 结束进程，用 spawn 分离启动。

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isDebugPortAlive, listTargets } from './cdp.mjs';

const execFileAsync = promisify(execFile);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 结束所有豆包进程：先温和关闭，再强制结束。 */
export async function stopClient({ log = () => {} } = {}) {
  log('stopping Doubao client...');
  await execFileAsync('taskkill', ['/IM', 'Doubao.exe'], { windowsHide: true, timeout: 15000 }).catch(() => {});
  await sleep(1500);
  // 客户端有托盘常驻，温和关闭通常无效，直接强制结束
  await execFileAsync('taskkill', ['/IM', 'Doubao.exe', '/F'], { windowsHide: true, timeout: 15000 }).catch(() => {});
  await sleep(800);
}

/** 带调试端口启动客户端。 */
export async function startClient(exePath, port, { log = () => {} } = {}) {
  log(`starting client: ${exePath} (debug port ${port})`);
  const child = spawn(exePath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child.pid || null;
}

/** 等待调试端口可用且有页面目标。 */
export async function waitForDebugPort(port, { timeoutMs = 40000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDebugPortAlive(port)) {
      const targets = await listTargets(port).catch(() => []);
      if (targets.length > 0) return targets;
    }
    await sleep(intervalMs);
  }
  return null;
}

/**
 * 确保客户端以可调试方式运行。
 * - 端口已开：直接复用，不打扰用户
 * - 端口未开：结束进程后带调试端口重启
 */
export async function ensureClient({ exePath, port = 9222, timeoutMs = 40000, log = () => {} } = {}) {
  if (await isDebugPortAlive(port)) {
    const targets = await listTargets(port).catch(() => []);
    return { launched: false, reused: true, port, targets };
  }
  await stopClient({ log });
  await startClient(exePath, port, { log });
  const targets = await waitForDebugPort(port, { timeoutMs });
  if (!targets) {
    throw new Error(`debug port ${port} did not become ready within ${timeoutMs}ms`);
  }
  return { launched: true, reused: false, port, targets };
}
