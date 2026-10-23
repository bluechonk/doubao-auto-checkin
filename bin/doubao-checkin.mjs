#!/usr/bin/env node
// 命令行入口：发现客户端 -> 带调试端口启动 -> 探测签到 -> 输出结论。

import process from 'node:process';
import { isDebugPortAlive } from '../src/cdp.mjs';
import { discoverDoubao } from '../src/discover.mjs';
import { ensureClient } from '../src/launch.mjs';
import { runCheckin } from '../src/checkin.mjs';
import { buildSummary, renderJson, renderText } from '../src/report.mjs';

const HELP = `豆包自动签到（doubao-auto-checkin）

用法:
  node bin/doubao-checkin.mjs [选项]

选项:
  --port <n>       CDP 调试端口，默认 9222
  --dry-run        只探测签到按钮，不点击
  --json           以 JSON 输出结果
  --no-launch      不重启客户端，要求调试端口已经开启
  --doctor         只做环境诊断（客户端路径、调试端口）
  --timeout <ms>   等待签到结果的时间，默认 20000
  --quiet          只输出最终结论
  -h, --help       显示帮助

退出码:
  0  签到成功 / 今日已签到 / dry-run 探测成功
  1  签到失败或执行异常
  2  参数错误

环境变量:
  DOUBAO_EXE_PATH  手动指定豆包客户端可执行文件路径（跳过自动发现）
`;

/** 解析命令行参数。 */
function parseArgs(argv) {
  const options = {
    port: 9222,
    dryRun: false,
    json: false,
    noLaunch: false,
    doctor: false,
    timeout: 20000,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port':
        options.port = Number(argv[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--no-launch':
        options.noLaunch = true;
        break;
      case '--doctor':
        options.doctor = true;
        break;
      case '--timeout':
        options.timeout = Number(argv[++i]);
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error('--port 需要 1-65535 的整数');
  }
  return options;
}

/** 统一日志：技术日志走 stderr，保持英文。 */
function createLogger({ quiet = false, json = false } = {}) {
  return (message) => {
    if (quiet || json) return;
    process.stderr.write(`[doubao-checkin] ${message}\n`);
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const log = createLogger(options);

  const envExe = process.env.DOUBAO_EXE_PATH;
  const discovery = await discoverDoubao();
  if (envExe) {
    discovery.exePath = envExe;
    discovery.source = 'env:DOUBAO_EXE_PATH';
    log(`using exe from env: ${envExe}`);
  }

  if (options.doctor) {
    const portAlive = await isDebugPortAlive(options.port);
    const lines = [
      '豆包客户端诊断',
      '-'.repeat(52),
      `可执行文件  ${discovery.exePath || '未找到'}`,
      `安装目录    ${discovery.appDir || '-'}`,
      `客户端版本  ${discovery.version || '-'}`,
      `发现方式    ${discovery.source || '-'}`,
      `调试端口    ${options.port}（${portAlive ? '已开启' : '未开启'}）`,
      `运行进程    ${discovery.running?.length || 0} 个`,
      `候选数量    ${discovery.candidates?.length || 0} 个`,
    ];
    for (const candidate of discovery.candidates || []) {
      lines.push(`  - [${candidate.source}] ${candidate.exePath}`);
    }
    lines.push('-'.repeat(52));
    process.stdout.write(lines.join('\n') + '\n');
    return discovery.exePath ? 0 : 1;
  }

  if (!discovery.exePath) {
    process.stderr.write(
      [
        '[doubao-checkin] Doubao client not found.',
        '请确认已安装豆包客户端，或用 DOUBAO_EXE_PATH 指定可执行文件路径。',
        discovery.candidates?.length ? '已探测到的候选：' : '',
        ...(discovery.candidates || []).map((c) => `  - ${c.exePath}`),
      ]
        .filter(Boolean)
        .join('\n') + '\n',
    );
    return 1;
  }

  if (options.noLaunch && !(await isDebugPortAlive(options.port))) {
    process.stderr.write(`[doubao-checkin] debug port ${options.port} is closed; drop --no-launch to restart the client.\n`);
    return 1;
  }

  const ensure = await ensureClient({
    exePath: discovery.exePath,
    port: options.port,
    log,
  });

  const result = await runCheckin({
    port: options.port,
    dryRun: options.dryRun,
    log,
    timeoutMs: options.timeout,
  });

  const summary = buildSummary({ discovery, ensure, result, port: options.port, dryRun: options.dryRun });
  if (options.json) {
    process.stdout.write(renderJson(summary) + '\n');
  } else if (options.quiet) {
    process.stdout.write(`${summary.message}\n`);
  } else {
    process.stdout.write(renderText(summary) + '\n');
  }
  return summary.exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`[doubao-checkin] error: ${err?.message || err}\n`);
    process.exitCode = 1;
  });
