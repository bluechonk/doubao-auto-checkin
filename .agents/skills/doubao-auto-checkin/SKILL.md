---
name: doubao-auto-checkin
description: 豆包 PC 客户端每日签到自动化与排障。用 agent-browser（CDP）接管豆包客户端，定位「每日签到」卡片、判定未签到/已签到状态、触发签到并核对结果，输出明确的成功或已签到反馈。当用户提到豆包签到、豆包领额度、每日签到、今天签到没、自动签到脚本，或要调试豆包客户端的签到节点与回调时使用。
allowed-tools: Bash(agent-browser:*), Bash(node:*), Bash(pwsh:*)
---

# 豆包自动签到

操控对象是 **豆包 Windows 客户端**（Electron），走 Chrome DevTools Protocol，
配合 `agent-browser` 做节点探查与手工复现；日常执行直接跑本项目脚本。

## 前置条件

1. Windows 10/11，已安装豆包客户端（安装位置不写死，脚本自动发现）。
2. Node.js >= 22（需要内置 `WebSocket`）。
3. 客户端必须以 `--remote-debugging-port=9222` 启动；脚本会自动结束进程并带参数重启。
4. 客户端保持登录状态（扫码登录由用户本人完成）。

## 最快路径

```bash
# 正常签到（已签到会直接返回「今日已签到」）
node bin/doubao-checkin.mjs

# 只看状态，不点击
node bin/doubao-checkin.mjs --dry-run

# 环境诊断：客户端路径、版本、调试端口
node bin/doubao-checkin.mjs --doctor

# 机器可读
node bin/doubao-checkin.mjs --json
```

退出码：`0` 签到成功 / 今日已签到 / dry-run 命中按钮；`1` 失败；`2` 参数错误。

## 用 agent-browser 手工复现

脚本出问题时按这个顺序排查。
`agent-browser` 的官方技能内容已内置在本仓库 `.agents/skills/agent-browser/`（Apache-2.0），
离线也能查阅命令参考；本机已安装时直接用 CLI 即可。

```bash
# 1. 带调试端口启动客户端（路径来自 --doctor 输出）
"C:\Users\<用户>\AppData\Local\Doubao\Application\app\Doubao.exe" --remote-debugging-port=9222

# 2. 接入
agent-browser --cdp 9222 tab list

# 3. 切到主界面（豆包 - doubao://doubao-chat/chat）后看可交互元素
agent-browser --cdp 9222 tab t2
agent-browser --cdp 9222 snapshot -i -c
```

进入签到页：**左下角账号按钮 → 菜单 → 免费领额度**（`https://www.doubao.com/pc/agent-explore`）。
签到页在 CDP 里表现为 `type=webview` 的目标，不是 `page`。

```bash
agent-browser --cdp 9222 tab            # 找到「免费领额度」的 tab id
agent-browser --cdp 9222 tab t5
agent-browser --cdp 9222 snapshot -i -c # 可见「立即签到」按钮
agent-browser --cdp 9222 find text 立即签到 click
```

### 本机已知坑：agent-browser 调用会挂起

`agent-browser` 的常驻进程会继承调用方 stdout 管道句柄，直接从脚本里调用会一直不返回。
解决办法是把输出重定向到文件（`Start-Process -RedirectStandardOutput`），再读文件内容。
`docs/02-cdp-and-nodes.md` 里有可直接复用的 PowerShell 包装。

## 页面结构与选择器（实测）

签到卡片用语义化 `data-*` 定位，不要用构建后带哈希的 class 名：

| 用途 | 选择器 |
|---|---|
| 每日签到卡片 | `[data-reward-code="daily_signin"]` |
| 卡片内签到按钮 | `[data-reward-code="daily_signin"] button` |
| 已签到标记 | `[data-reward-code="daily_signin"] [class*="rewarded-"]` |
| 积分数字 | `[class*="pointsValue"]` |

### 未签到态

```html
<div class="card-XXX" data-reward-code="daily_signin" data-reward-source="task_panel">
  <div class="main-XXX">
    <div class="titleRow-XXX">
      <div class="title-XXX">每日签到</div>
      <span class="reward-XXX">+200 额度</span>
    </div>
  </div>
  <button type="button" class="action-XXX">立即签到</button>
</div>
```

### 已签到态（按钮消失）

```html
<div class="card-XXX" data-reward-code="daily_signin" data-reward-source="task_panel">
  <div class="main-XXX">…每日签到 / +200 额度…</div>
  <div class="rewarded-XXX">
    <svg class="rewardedIcon-XXX" aria-hidden="true">…对勾路径…</svg>
  </div>
</div>
```

结论：**已签到时没有 `<button>` 节点**，只有一个不可点击的对勾 `div`，也没有文本与 `aria-label`。
所以「已签到再点一次」在 UI 上不存在入口。

## 触发链与回调

点击「立即签到」后的实际链路（Network 面板实测）：

1. `POST /alice/ug/campaign/landing/checkin`，请求体 `{"scene":"pc_incentive_task_mvp_v3"}`，返回 200。
2. 紧接着 `POST /alice/ug/campaign/v3/detail/` 刷新活动详情。
3. 签到卡片按钮节点被移除，替换为对勾图标。
4. 积分数字从 `200` 变成 `400`（+200 额度到账）。

判定顺序：先看 DOM（按钮消失 + 对勾出现），再看签到接口是否 200，最后看积分增量。

## 已签到状态下再次触发

- 卡片内没有任何可点击节点，`button` 查询结果为 `null`。
- 顶部 banner 的「立即领取」仍然可点，但点击后**不发任何请求、DOM 无变化**（实测），属于无副作用的死按钮。
- 脚本行为：识别为 `already_checked_in`，打印「今日已签到，无需重复签到（签到按钮已替换为对勾图标…）」，退出码 `0`。

## 失败对照表

| 现象 | 判定 | 处理 |
|---|---|---|
| 页面没有签到卡片 | `no_card` | 等页面加载；确认活动对当前账号开放 |
| 出现扫码登录/请登录 | `not_logged_in` | 让用户先登录，脚本不代劳 |
| 按钮存在但禁用 | `disabled` | 额度活动可能限时，稍后重试 |
| 点击后仍是「立即签到」 | `failed` | 看 `--json` 里的接口状态与 network 记录 |
| 找不到账号按钮 | 打开签到页失败 | 客户端未渲染完，重跑；或手动点开「免费领额度」再执行 `--no-launch` |

## 边界

- 只做「每日签到」：不领积分里程碑、不做任务、不领任务奖励。
- 只做 UI 点击，不伪造接口签名（`a_bogus` / `msToken` 由客户端生成）。
- 不做登录、不改账号、不批量切号。
- 签到是每日一次，脚本天然幂等：重复执行只会得到「今日已签到」。
- 本技能内容随本仓库以 MIT 分发；内置的 `agent-browser` 内容为 Apache-2.0，
  第三方声明见仓库根目录 `THIRD_PARTY_NOTICES.md`。
