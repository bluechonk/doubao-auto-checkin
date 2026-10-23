# 实机验证记录

环境：Windows 11，豆包 2.32.6（Electron 147.0.7727.149），Node v24.21.0，日期 2026-10-23。

## 一、路径发现

```
$ node bin/doubao-checkin.mjs --doctor
可执行文件  C:\Users\bluechonk\AppData\Local\Doubao\Application\app\Doubao.exe
安装目录    C:\Users\bluechonk\AppData\Local\Doubao\Application\app
客户端版本  2.32.6
发现方式    process
调试端口    9222（已开启）
运行进程    17 个
候选数量    2 个
  - [process] C:\Users\bluechonk\AppData\Local\Doubao\Application\app\Doubao.exe
  - [scan] C:\Program Files\Doubao\app\Doubao.exe
```

说明：

- 注册表项 `HKCU\...\Uninstall\Doubao` 与进程路径指向同一个 exe，去重后合并为一条（版本号来自注册表）。
- `C:\Program Files\Doubao` 是另一套安装（Launcher 2.30.4），也被扫描到，但排在运行进程之后。
- `Application\Doubao.exe`（1.8MB 启动壳）被大小校验排除，只认 `app\Doubao.exe`（5.4MB）。

冷启动时进程列表尚为空，此时退回注册表路径，同样命中：

```
发现方式    registry
调试端口    9222（本次启动并开启）
```

## 二、签到触发（真实签到，额度到账）

点击前：

```
BEFORE: {"cardText":"每日签到+200 额度立即签到","btnText":"立即签到","disabled":false}
CLICK: clicked
```

点击后 0.7s 起，按钮节点消失；8 秒内稳定为：

```
{"cardText":"每日签到+200 额度","btnText":null,"disabled":null,
 "cardHTML":"…<div class=\"rewarded-nPpEuG\"><svg class=\"rewardedIcon-NKqNlH\">…</svg></div>",
 "points":["400"]}
```

抓到的请求：

```
POST /alice/ug/campaign/landing/checkin  body {"scene":"pc_incentive_task_mvp_v3"} → 200
POST /alice/ug/campaign/v3/detail/ → 200
```

积分：`200 → 400`，与页面文案「每日签到 +200 额度」一致。

## 三、已签到态再触发

```
BEFORE: {"cardText":"每日签到+200 额度","hasButton":false,"points":["400"],"toasts":[]}
CLICK: clicked-claim        # 点顶部 banner 的「立即领取」
AFTER: 10 次采样（每 0.8s）全部为 hasButton=false, points=400
REQUESTS: []                # 一个请求都没有
```

结论：已签到后卡片无按钮可点；banner 按钮无副作用，不发请求、不改状态。

## 四、脚本端到端

复用已开启端口（签到页已开）：

```
$ node bin/doubao-checkin.mjs
[doubao-checkin] signin page: https://www.doubao.com/pc/agent-explore
[doubao-checkin] state before: checked_in
页面节点    440 个 DOM 节点 / 0 个 iframe
签到前      已签到（按钮已被对勾图标替换，页面无签到按钮）
结论        [今日已签到] 今日已签到，无需重复签到（签到按钮已替换为对勾图标，页面无可点击签到入口）
exit=0
```

签到页未打开时，脚本自己从账号菜单进入：

```
[doubao-checkin] clicked account button
[doubao-checkin] clicked "免费领额度"
[doubao-checkin] signin page: https://www.doubao.com/pc/agent-explore?previous_page=chat&enter_method=fixed_entry
签到页      …（本次打开）
exit=0
```

冷启动（先 `taskkill /F` 杀掉客户端）：

```
[doubao-checkin] stopping Doubao client...
[doubao-checkin] starting client: …\app\Doubao.exe (debug port 9222)
[doubao-checkin] clicked account button
[doubao-checkin] clicked "免费领额度"
结论        [今日已签到] …
exit=0
```

## 五、单元测试

```
$ node --test test/state.test.mjs
✔ 未签到卡片判定为 pending
✔ 按钮被对勾替换后判定为 checked_in
✔ 没有卡片且出现登录提示时判定为未登录
✔ 没有卡片且无登录提示时判定为 no_card
✔ 按钮禁用时判定为 disabled
✔ 卡片存在但既无按钮也无对勾时判定为 unknown
✔ 已签到文案出现且无按钮时判定为 checked_in
7 passed
```

## 六、删除本地后重新克隆的回归（2026-10-23）

做法：删掉本地目录，用 `gh repo clone bluechonk/doubao-auto-checkin` 重新克隆（51 个文件），
再完全按仓库内 `.agents/skills/` 的说明跑一轮。

通过项：

| 检查 | 结果 |
|---|---|
| `npm test`（无 `node_modules`） | 14 passed / 0 failed（状态判定 7 + CLI 7） |
| `--doctor` | 命中 `...\Application\app\Doubao.exe`（2.32.6），端口 9222 |
| `--dry-run` / 实机执行 | 均识别「已签到」，exit 0 |
| 签到页未打开 | 自动经账号菜单打开后给出结论 |
| 冷启动（先杀客户端） | 自行带调试端口启动并完成判定 |
| `--quiet` / `--json` | 输出正常，`status=already_checked_in` |
| `scripts/install-task.ps1` | 克隆后 `logs/` 不存在也能自建并注册/注销成功 |
| `scripts/ab-wrap.ps1` | 通过 `npm root -g` 定位 CLI，`tab list` 正常列出 webview 签到页 |
| agent-browser 手工步骤 | `snapshot --selector` 显示已签到卡片「no interactive elements」；`find text 立即签到 click` 优雅报错 |

发现并修复的问题：

| # | 问题 | 修复 |
|---|---|---|
| 1 | 参数错误退出码是 **1**，与文档写的 **2** 不符（`--port abc`、`--nope`） | 新增 `UsageError`，最外层 catch 映射为退出码 2，并提示 `--help` |
| 2 | `--timeout abc` **静默**变成 `NaN`，未签到路径会直接跳过等待轮询 | 校验为正整数，非法即参数错误 |
| 3 | `--port` / `--timeout` 缺值时报错信息含糊 | `takeValue()` 明确提示「缺少参数值」 |
| 4 | `.githooks/pre-push` 入库但克隆后不生效，README 未说明 | README 增加「克隆后请启用推送门禁」小节 |
| 5 | 技能说「docs/02 里有可直接复用的 PowerShell 包装」，但仓库没有该脚本文件 | 新增 `scripts/ab-wrap.ps1`（用 `npm root -g` 定位，不写死路径），docs/02 与 SKILL.md 同步指向它 |
| 6 | CLI 参数行为无回归测试 | 新增 `test/cli.test.mjs`（7 例，覆盖退出码 2 与 `--help`） |

## 七、已知限制

1. `checkin` 接口的响应体只在真实点击那一刻抓得到；当天已签到就无法再复现，
   因此脚本把响应体当旁证，主判据仍是 DOM。
2. 客户端界面文案若改版（「立即签到」改字），选择器仍有效（走 `data-reward-code`），
   但 `buttonText` 匹配会失败，需要更新 `ANCHORS.signinButtonText`。
3. 账号菜单入口文案「免费领额度」若改名，需要更新 `ANCHORS.signinEntryText`。
