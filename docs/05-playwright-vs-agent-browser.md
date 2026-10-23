# Playwright 与 agent-browser 的可行性对比（豆包客户端签到）

测试时间：2026-10-23。客户端：豆包 2.32.6（Electron 147.0.7727.149）。
Playwright：1.62.1（`lackeyjb/playwright-skill` v5.0.0，MIT，仅用于本次实验，未内置进本仓库）。

## 一、结论速览

| 能力 | agent-browser | Playwright |
|---|---|---|
| 连上正在运行的豆包（CDP） | 可以，`--cdp 9222` | 可以，`chromium.connectOverCDP` |
| 看到并操作签到页（Electron `webview`） | **可以** | **不可以**（目标被过滤） |
| 操作主界面（账号菜单等） | 可以 | 可以，`getByRole` 定位很顺手 |
| 由工具自己启动豆包 | 不需要 | 不可以（`_electron` 挂载超时） |
| 完成「每日签到」 | **可以** | **不可以** |
| 安装成本 | 一个 CLI | 需 `npm i playwright`（本实验跳过浏览器下载，仅 2 个包） |

一句话：**签到 UI 在 Electron 的 `webview` 里，Playwright 的 CDP 集成不暴露 `webview` 目标，
所以四条路都到不了签到卡片；agent-browser 走原始 CDP，目标可见可点，因此能完成签到。**

## 二、Playwright 四条路线实测

### A. `connectOverCDP` 连浏览器端点

```js
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
browser.contexts()[0].pages().map((p) => p.url());
```

结果：只拿到 3 个 `page`，签到页不在其中。

```
pages: [doubao-launcher/chat?viewId=101, doubao-background/, doubao-chat/chat]
cdp targets: [webview:https://www.doubao.com/pc/agent-explore, page:..., iframe:..., other:...]
```

CDP 的 `/json/list` 里明确有 `webview:https://www.doubao.com/pc/agent-explore`，
Playwright 侧却看不到——它按目标类型过滤，只接管 `page`。

### B. `_electron.launch`（由 Playwright 启动客户端）

```js
const app = await electron.launch({ executablePath: DOUBAO_EXE, args: ['--remote-debugging-port=9223'] });
```

结果：`TimeoutError: Timeout 60000ms exceeded`。
豆包主进程是定制启动器（`Doubao.dll` + 自定义沙箱），不满足 Playwright Electron 支持所需的挂载握手。

### C. 先连 CDP，再让应用新开签到页

先用 Playwright 在主界面点「账号菜单 → 免费领额度」（**这两步是成功的**），
再轮询 `context.pages()` 找签到页。

```
clicked account button
clicked 免费领额度
pages after open: [doubao-launcher/chat?viewId=101, doubao-background/, doubao-chat/chat]
RESULT: NOT reachable as Playwright page
```

说明：**后创建的 `webview` 同样不会被接管**，不是「连接时机太早」的问题。

### D. 直连签到页自己的 ws 端点

```js
await chromium.connectOverCDP('ws://127.0.0.1:9222/devtools/page/E89B642535667BF4CCF0D5ADA102C9F4');
```

结果：`connected: true`，但 `pages: []`——连上了却拿不到任何 Page 对象，
后续 `locator` 直接 `Cannot read properties of undefined`。类型过滤在端点层面依然生效。

## 三、agent-browser 为什么可以

agent-browser 不经过 Playwright 的目标抽象，直接：

1. `GET /json/list` 拿全部目标（含 `webview`、`iframe`、`other`）；
2. 取目标自己的 `webSocketDebuggerUrl` 建原始 CDP 连接；
3. 用 `Runtime.evaluate` 读 DOM、用 `Input.dispatchMouseEvent` 派发真实鼠标事件。

本项目交付的 `doubao-checkin` 用的是同一套原始 CDP 逻辑（零依赖，Node 22+ 内置 `WebSocket`），
不依赖 agent-browser 运行时。

## 四、什么时候用哪个

| 场景 | 建议 |
|---|---|
| 操作豆包客户端（含签到页这类 webview） | agent-browser / 原始 CDP |
| 普通网页的端到端测试、断言、截图对比 | Playwright 更合适（locator 自动等待、断言、trace） |
| 需要「连上用户正在用的 Electron 应用」 | Playwright 目前做不到 webview 层 |
| 零依赖、可被计划任务调用的脚本 | 本项目自带 CDP 实现 |

## 五、复现实验

```powershell
# 1. 取技能（MIT，仅实验用）
git clone --depth 1 https://github.com/lackeyjb/playwright-skill.git
cd playwright-skill/skills/playwright-skill
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'; npm install   # 连现成 Electron，不需要浏览器二进制

# 2. 客户端带调试端口启动
& "$env:LOCALAPPDATA\Doubao\Application\app\Doubao.exe" --remote-debugging-port=9222

# 3. 跑上面的 A/C/D 任一脚本
node run.js <script.js>
```

顺带记录：本会话挂载的 Playwright MCP 连的是另一个浏览器实例（当时停在 `modelmux 控制台`），
它的 CDP 端点由启动参数固定，运行期无法改接到豆包的 9222，因此同样无法用于本任务。
