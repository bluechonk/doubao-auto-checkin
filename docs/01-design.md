# 设计与模块划分

## 目标

在 Windows 上给豆包 PC 客户端做「每日签到」自动化，要求：

1. 客户端路径动态获取，不写死盘符与用户名。
2. 零 npm 依赖，靠 Node 内置能力与 Windows 自带命令完成。
3. 签到前先判定状态，已签到时不产生副作用。
4. 输出人类可读的明确结论。

## 为什么走 CDP

豆包的界面是 Electron（Chromium），主界面是 `doubao://doubao-chat/chat`，
签到页是内嵌浏览器标签页 `https://www.doubao.com/pc/agent-explore`。
Electron 自带 Chromium 调试协议，只要启动时带上 `--remote-debugging-port`，
就能用 `Runtime.evaluate` 读 DOM、用 `Input.dispatchMouseEvent` 真实点击。

相比 OCR / 屏幕坐标 / UI Automation：

- 不受缩放、主题、分辨率影响（本机 `deviceScaleFactor=1.25`，截图坐标和 CSS 坐标差 1.25 倍）。
- 能拿到节点的 `data-*` 语义属性，选择器比截图像素稳定。
- 能顺带监听 Network，拿到签到接口的真实返回。

## 模块

| 文件 | 职责 |
|---|---|
| `src/discover.mjs` | 动态发现客户端：运行进程 → 卸载注册表 → 常见目录扫描；统一做 Electron 目录校验 |
| `src/launch.mjs` | 结束客户端、带调试端口重启、等待端口就绪 |
| `src/cdp.mjs` | 零依赖 CDP 客户端：WebSocket 连接、命令收发、事件订阅、真实鼠标点击 |
| `src/checkin.mjs` | 签到状态机：打开签到页、读状态、点击、等收敛、核对接口 |
| `src/report.mjs` | 结论渲染（中文文本 / JSON） |
| `bin/doubao-checkin.mjs` | CLI 入口、参数解析、退出码 |
| `test/state.test.mjs` | 状态判定单元测试（`node --test`） |

## 路径发现的顺序与理由

1. **运行中的进程**（`Get-CimInstance Win32_Process`）：最权威，用户实际在跑的那个就是正主。
2. **卸载注册表项**：`HKCU/HKLM\...\Uninstall` 里 `DisplayName` 命中「豆包 / Doubao」的项，
   取其 `DisplayIcon`、`UninstallString`、`InstallLocation` 反推安装根目录。
3. **目录扫描**：`LOCALAPPDATA` / `APPDATA` / `ProgramFiles` / `ProgramFiles(x86)` / `ProgramData` / `USERPROFILE`
   下的同名目录（含 `Programs\` 一级）。

得到候选目录后统一用 `resolveAppDir` 归一：

- 优先读安装根目录的 `Doubao.ini`，其内容就是应用子目录名（本机是 `app`），
  这样版本升级换了目录名也不会失效。
- 再试 `<root>/app`、`<root>`、`<root>/*` 一层。

Electron 目录校验：`Doubao.exe` 存在且大于 2MB，并且同目录有 `icudtl.dat` 或 `resources.pak`。
本机 `Application\Doubao.exe` 只是 1.8MB 的启动壳，真正应用在 `Application\app\Doubao.exe`（5.4MB），
用大小 + 特征文件可以稳定区分。

## 零依赖怎么实现

| 需求 | 做法 |
|---|---|
| WebSocket | Node 22+ 全局 `WebSocket` |
| HTTP 调 CDP | 全局 `fetch` |
| 读写进程 / 注册表 | `execFile` 调 PowerShell，脚本用 `-EncodedCommand` 传，避开引号与中文编码问题 |
| 结束 / 启动进程 | `taskkill`、`child_process.spawn`（分离启动） |
| 测试 | 内置 `node:test` |

`package.json` 里没有任何 `dependencies`，换机器只需要 Node，不需要 `npm install`。

## 跨机器复用

- 不写死用户名：所有路径来自环境变量、注册表、进程。
- 不写死端口：`--port` 可换，默认 9222。
- 不写死密码/凭据：完全不碰账号信息。
- 支持 `DOUBAO_EXE_PATH` 覆盖，用于绿色版或非常规安装。
