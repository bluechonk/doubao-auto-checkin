// 豆包客户端安装位置发现：完全动态，不写死任何绝对路径。
// 依次尝试：运行中的进程 -> 卸载注册表项 -> 常见根目录扫描，最后统一做 Electron 应用目录校验。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const EXE_NAME = 'Doubao.exe';
// Electron 应用目录的判定特征文件
const ELECTRON_MARKERS = ['icudtl.dat', 'resources.pak'];
// 产品别名，用于按名称筛目录 / 注册表项
const PRODUCT_NAME_RE = /豆包|doubao/i;

let cachedShell = null;

/** 选一个可用的 PowerShell：优先 pwsh 7，退回系统自带 powershell。 */
export async function detectPowerShell() {
  if (cachedShell) return cachedShell;
  for (const candidate of ['pwsh', 'powershell']) {
    try {
      await execFileAsync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
        timeout: 15000,
        windowsHide: true,
      });
      cachedShell = candidate;
      return candidate;
    } catch {
      // 换下一个
    }
  }
  return null;
}

/** 用 -EncodedCommand 执行 PowerShell，彻底规避引号与中文转义问题。 */
async function runPowerShell(script, { timeoutMs = 30000 } = {}) {
  const shell = await detectPowerShell();
  if (!shell) return null;
  const prelude = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='Stop';";
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout.replace(/^\uFEFF/, '').trim();
  } catch {
    return null;
  }
}

/** 解析 PowerShell 输出的 JSON（单对象会被包成数组）。 */
function parseJsonList(text) {
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return [];
  } catch {
    return [];
  }
}

/** 读取正在运行的豆包进程。 */
export async function getRunningProcesses() {
  const script = `
$items = Get-CimInstance Win32_Process -Filter "Name='${EXE_NAME}'" |
  ForEach-Object { [pscustomobject]@{ path = $_.ExecutablePath; cmd = $_.CommandLine; pid = $_.ProcessId } }
ConvertTo-Json -InputObject @($items) -Depth 3 -Compress`;
  return parseJsonList(await runPowerShell(script));
}

/** 读取卸载注册表项里的安装线索。 */
export async function getRegistryCandidates() {
  const script = `
$roots = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$items = foreach ($root in $roots) {
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p -and $p.DisplayName -match '${'豆包|Doubao'}') {
      [pscustomobject]@{
        key = $_.PSChildName
        name = $p.DisplayName
        version = $p.DisplayVersion
        icon = $p.DisplayIcon
        uninstall = $p.UninstallString
        location = $p.InstallLocation
      }
    }
  }
}
ConvertTo-Json -InputObject @($items) -Depth 3 -Compress`;
  return parseJsonList(await runPowerShell(script));
}

/** 去掉命令行里可能带的外层引号与参数。 */
function stripQuotes(value) {
  if (!value) return null;
  const text = String(value).trim();
  const quoted = text.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  return text.split(/\s+--?/)[0].trim();
}

/** 判断目录是否是真正的 Electron 应用目录。 */
export function isElectronAppDir(dir) {
  if (!dir || !existsSync(dir)) return false;
  const exe = path.join(dir, EXE_NAME);
  if (!existsSync(exe)) return false;
  try {
    if (statSync(exe).size < 2 * 1024 * 1024) return false;
  } catch {
    return false;
  }
  return ELECTRON_MARKERS.some((marker) => existsSync(path.join(dir, marker)));
}

/**
 * 从一个目录推导出可执行的 Electron 应用入口。
 * 兼容三种布局：
 *   <dir>/app/Doubao.exe            （Doubao.ini 指向 app）
 *   <dir>/<子目录>/Doubao.exe       （Doubao.ini 内容为任意子目录名）
 *   <dir>/Doubao.exe                （直接就是应用目录）
 */
export function resolveAppDir(dir) {
  if (!dir) return null;
  const candidates = [];
  const ini = path.join(dir, 'Doubao.ini');
  if (existsSync(ini)) {
    try {
      const sub = readFileSync(ini, 'utf8').replace(/^\uFEFF/, '').trim();
      if (sub) candidates.push(path.join(dir, sub));
    } catch {
      // 读取失败则忽略
    }
  }
  candidates.push(path.join(dir, 'app'), dir);

  for (const candidate of candidates) {
    if (isElectronAppDir(candidate)) return candidate;
  }
  // 兜底：扫一层子目录
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(dir, entry.name);
      if (isElectronAppDir(candidate)) return candidate;
    }
  } catch {
    // 目录不可读则忽略
  }
  return null;
}

/** 扫描常见根目录下的豆包相关文件夹。 */
export function scanKnownRoots() {
  const roots = [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.USERPROFILE,
  ].filter(Boolean);

  const found = [];
  for (const root of roots) {
    const searchDirs = [root, path.join(root, 'Programs')];
    for (const searchDir of searchDirs) {
      if (!existsSync(searchDir)) continue;
      let entries;
      try {
        entries = readdirSync(searchDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!PRODUCT_NAME_RE.test(entry.name)) continue;
        found.push(path.join(searchDir, entry.name));
      }
    }
  }
  return found;
}

/** 从安装根目录推导用户数据目录。 */
function resolveUserDataDir(installRoot) {
  if (!installRoot) return null;
  const candidate = path.join(path.dirname(installRoot), 'User Data');
  return existsSync(candidate) ? candidate : null;
}

/** 读取 Electron 版本（应用目录下的 *.manifest 文件名即 Chromium 版本）。 */
function readElectronVersion(appDir) {
  try {
    const manifest = readdirSync(appDir).find((name) => name.endsWith('.manifest'));
    return manifest ? manifest.replace(/\.manifest$/, '') : null;
  } catch {
    return null;
  }
}

function toCandidate(appDir, source, extra = {}) {
  if (!appDir) return null;
  const root = path.dirname(appDir);
  return {
    appDir,
    exePath: path.join(appDir, EXE_NAME),
    installRoot: root,
    userDataDir: resolveUserDataDir(root),
    electronVersion: readElectronVersion(appDir),
    source,
    ...extra,
  };
}

/**
 * 发现豆包客户端。
 * @returns {Promise<{exePath:string, appDir:string, installRoot:string, userDataDir:string|null,
 *   electronVersion:string|null, version:string|null, source:string, candidates:Array, running:Array}>}
 */
export async function discoverDoubao() {
  const candidates = [];
  const running = await getRunningProcesses().catch(() => []);

  // 1) 运行中的进程最可信
  for (const proc of running) {
    const exe = stripQuotes(proc.path);
    if (!exe) continue;
    const appDir = isElectronAppDir(path.dirname(exe)) ? path.dirname(exe) : resolveAppDir(path.dirname(exe));
    const candidate = toCandidate(appDir, 'process', { pid: proc.pid });
    if (candidate) candidates.push(candidate);
  }

  // 2) 注册表卸载项
  const registry = await getRegistryCandidates().catch(() => []);
  for (const item of registry) {
    const icon = stripQuotes(item.icon);
    const roots = new Set();
    if (icon) roots.add(path.dirname(icon));
    if (item.uninstall) {
      const un = stripQuotes(item.uninstall);
      if (un) roots.add(path.dirname(un));
    }
    if (item.location) roots.add(String(item.location).replace(/^"|"$/g, ''));
    for (const root of roots) {
      const candidate = toCandidate(resolveAppDir(root), 'registry', { version: item.version || null });
      if (candidate) candidates.push(candidate);
    }
  }

  // 3) 常见目录扫描
  for (const dir of scanKnownRoots()) {
    const candidate = toCandidate(resolveAppDir(dir), 'scan');
    if (candidate) candidates.push(candidate);
  }

  // 去重（按 exe 路径）
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.exePath.toLowerCase();
    if (seen.has(key)) {
      const existed = unique.find((c) => c.exePath.toLowerCase() === key);
      if (existed && !existed.version && candidate.version) existed.version = candidate.version;
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  const best = unique[0] || null;
  return {
    ...(best || {}),
    exePath: best?.exePath || null,
    appDir: best?.appDir || null,
    version: unique.find((c) => c.version)?.version || null,
    running,
    candidates: unique,
  };
}

/** 客户端是否在运行。 */
export function isRunning(discovery) {
  return Array.isArray(discovery?.running) && discovery.running.length > 0;
}
