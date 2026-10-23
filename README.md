# doubao-auto-checkin

豆包 Windows 客户端的每日签到自动化脚本：**npm 零依赖**，路径动态发现，签到前后状态可判定，
已签到时不会重复操作。

## 特性

- **零依赖**：只用 Node 内置能力（`fetch`、`WebSocket`、`node:test`）和 Windows 自带命令，换机器不用 `npm install`。
- **路径不写死**：运行进程 → 卸载注册表 → 常见目录扫描，三级发现 + Electron 目录校验；支持 `DOUBAO_EXE_PATH` 覆盖。
- **只做 Windows**：进程结束用 `taskkill`，启动用分离 `spawn`，注册表查询走 PowerShell。
- **状态优先**：先判定「未签到 / 已签到」，已签到直接返回，绝不重复点击。
- **结论明确**：输出「签到成功，额度 200 → 400」或「今日已签到，无需重复签到」，并带退出码。
- **可核对**：抓取签到接口的状态与响应体、积分前后变化，`--json` 可留证。

## 环境要求

| 项 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 |
| 客户端 | 豆包 PC 客户端（Electron 版） |
| Node | >= 22（需要全局 `WebSocket`） |
| 账号 | 客户端已登录（登录由本人完成，脚本不代劳） |

## 使用

```bash
# 正常签到
node bin/doubao-checkin.mjs

# 只看状态，不点击
node bin/doubao-checkin.mjs --dry-run

# 环境诊断
node bin/doubao-checkin.mjs --doctor

# 机器可读输出
node bin/doubao-checkin.mjs --json
```

参数：

| 参数 | 说明 |
|---|---|
| `--port <n>` | CDP 调试端口，默认 `9222` |
| `--dry-run` | 只探测签到按钮，不点击 |
| `--json` | 输出 JSON |
| `--no-launch` | 不重启客户端，要求调试端口已开 |
| `--doctor` | 只做环境诊断 |
| `--timeout <ms>` | 等待签到结果的时间，默认 `20000` |
| `--quiet` | 只输出最终结论 |
| `-h, --help` | 帮助 |

退出码：

| 码 | 含义 |
|---|---|
| `0` | 签到成功 / 今日已签到 / dry-run 命中按钮 |
| `1` | 签到失败或执行异常 |
| `2` | 参数错误 |

环境变量：

| 变量 | 说明 |
|---|---|
| `DOUBAO_EXE_PATH` | 手动指定客户端可执行文件，跳过自动发现 |

## 每天自动跑

用 Windows 计划任务定时执行（默认每天 09:10，任务名 `DoubaoAutoCheckin`）：

```powershell
pwsh -File scripts/install-task.ps1              # 注册
pwsh -File scripts/install-task.ps1 -Time 08:30  # 改时间
pwsh -File scripts/install-task.ps1 -Uninstall   # 注销
```

日志追加写入 `logs/checkin.log`。任务以当前用户身份运行，要求客户端保持登录。

## 输出示例

本次执行完成签到：

```
豆包自动签到
----------------------------------------------------
客户端      C:\Users\<用户>\AppData\Local\Doubao\Application\app\Doubao.exe
客户端版本  2.32.6（Electron 147.0.7727.149）
发现方式    process
调试端口    9222（本次启动并开启）
签到页      https://www.doubao.com/pc/agent-explore（本次打开）
页面节点    440 个 DOM 节点 / 0 个 iframe
签到前      未签到（按钮「立即签到」，可点击）
签到后      已签到（按钮已被对勾图标替换，页面无签到按钮）
接口回调    POST /alice/ug/campaign/landing/checkin → HTTP 200，业务码 0
额度变化    200 → 400（+200）
结论        [签到成功] 签到成功，额度 200 → 400
----------------------------------------------------
```

今天已经签过：

```
签到前      已签到（按钮已被对勾图标替换，页面无签到按钮）
结论        [今日已签到] 今日已签到，无需重复签到（签到按钮已替换为对勾图标，页面无可点击签到入口）
```

## 工作原理

1. **发现客户端**：查运行进程、卸载注册表、常见目录，用 `Doubao.ini` 归一应用子目录，
   再用 `icudtl.dat` / `resources.pak` 确认是 Electron 应用目录。
2. **接入调试端口**：端口没开就结束客户端并带 `--remote-debugging-port` 重启。
3. **打开签到页**：已有 `pc/agent-explore` 目标直接复用；否则在主界面点左下角账号按钮，
   在菜单里点「免费领额度」，等 webview 目标出现。
4. **判定状态**：读 `[data-reward-code="daily_signin"]` 卡片。有「立即签到」按钮是未签到；
   按钮消失并出现对勾标记是已签到。
5. **触发与核对**：用真实鼠标事件点按钮，轮询到状态收敛，抓签到接口状态与积分增量。

更细的取证见 `docs/`：

- `docs/01-design.md` 架构与路径发现
- `docs/02-cdp-and-nodes.md` CDP 取证、节点结构、agent-browser 使用坑
- `docs/03-checkin-flow.md` 触发链、回调、幂等
- `docs/04-verification.md` 实机验证记录
- `docs/05-playwright-vs-agent-browser.md` 为什么用原始 CDP：Playwright 触达不到 Electron webview 的实测记录

## 目录结构

```
doubao-auto-checkin/
├─ bin/doubao-checkin.mjs       CLI 入口
├─ src/
│  ├─ discover.mjs              客户端路径动态发现
│  ├─ launch.mjs                带调试端口重启客户端
│  ├─ cdp.mjs                   零依赖 CDP 客户端
│  ├─ checkin.mjs               签到状态机
│  ├─ report.mjs                结论渲染
│  └─ index.mjs                 对外导出
├─ test/state.test.mjs          状态判定单元测试
├─ scripts/install-task.ps1     每日计划任务注册/注销
├─ .agents/skills/
│  ├─ doubao-auto-checkin/SKILL.md   本项目技能说明（MIT）
│  └─ agent-browser/                 第三方技能内容（Apache-2.0）
├─ docs/                        设计与取证文档
├─ LICENSE                      MIT 许可证
├─ THIRD_PARTY_NOTICES.md       第三方组件与授权声明
└─ package.json
```

## 状态与幂等

| 状态 | 页面特征 | 脚本行为 |
|---|---|---|
| 未签到 | 卡片内有 `<button>立即签到</button>` | 点击并核对结果 |
| 已签到 | 按钮节点消失，出现 `<div class="rewarded-*">` 对勾 | 直接返回「今日已签到」，退出码 0 |
| 未登录 | 页面出现扫码登录 | 报错并提示先登录 |
| 无卡片 | 找不到 `daily_signin` 卡片 | 报错，提示检查页面加载或活动状态 |

已签到状态下不存在可点击的签到按钮；顶部 banner 的「立即领取」虽可点，但实测不发请求、不改状态。
脚本重复执行只会得到「今日已签到」。

## 常见问题

**Q：会杀掉我正在用的豆包吗？**
A：会。`--remote-debugging-port` 必须在启动时带上，所以脚本会结束现有 `Doubao.exe` 再重启。
如果端口已经开着，脚本直接复用，不会重启。

**Q：支持 macOS / Linux 吗？**
A：不支持，本项目只做 Windows 层。核心 CDP 逻辑是跨平台的，但进程管理与注册表查询是 Windows 实现。

**Q：为什么不用截图识别？**
A：本机 `deviceScaleFactor=1.25`，截图坐标与 CSS 坐标差 1.25 倍，且主题、缩放会漂移。
CDP 直接读 DOM 的 `data-*` 语义属性更稳。

**Q：签到失败怎么排查？**
A：先 `--doctor` 看路径与端口，再 `--dry-run` 看能否定位按钮，最后 `--json` 看 `result.network`
里的接口状态与 `result.before/after` 快照。

## 开发

```bash
node --test test/state.test.mjs   # 单元测试
node bin/doubao-checkin.mjs --dry-run
```

选择器与接口路径集中在 `src/checkin.mjs` 的 `ANCHORS` 常量里，客户端改版时只改这一处。

## 边界

- 只做 UI 点击，不伪造接口签名（`a_bogus`、`msToken` 由客户端生成）。
- 不处理登录、不切换账号、不批量操作。
- 只做「每日签到」这一件事：不领里程碑、不做任务、不领任务奖励。
- 签到是每日一次的个人行为，脚本不做任何服务端修改。

## 技能目录

`.agents/skills/` 下有两个技能，供 AI 助手直接读取：

| 目录 | 内容 | 许可 |
|---|---|---|
| `doubao-auto-checkin/` | 本项目自己的技能说明：签到状态模型、选择器、触发链、失败对照表 | MIT（同本仓库） |
| `agent-browser/` | **第三方**：`agent-browser` 官方技能内容，用于人工排障与节点复现 | Apache-2.0（Vercel Inc.） |

`agent-browser` 是**可选**的排障工具，不是运行依赖；日常执行签到只需要 Node。

## 许可证

- 本仓库主体代码：**MIT**，见 [LICENSE](LICENSE)。
- 内置的 `agent-browser` 技能内容：**Apache License 2.0**，版权归 Vercel Inc.，
  许可证全文见 [.agents/skills/agent-browser/LICENSE](.agents/skills/agent-browser/LICENSE)。
- 第三方组件的来源、版本、修改情况与合规说明：见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 「豆包」「Doubao」为字节跳动相关公司商标，本项目与其权利人无关联、未获背书。
