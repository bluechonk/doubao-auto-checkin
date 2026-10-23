# CDP 取证与节点结构

记录时间：2026-10-23，客户端 2.32.6（Electron 147.0.7727.149）。

## 一、如何拿到调试端口

客户端默认不带调试端口。查看正在运行的进程命令行：

```
"C:\Users\bluechonk\AppData\Local\Doubao\Application\app\Doubao.exe" --start_time=1792711765589
```

主进程只有一个（带 `--start_time`），其余是 renderer / gpu / utility 子进程。
必须先结束所有 `Doubao.exe`，再带参数启动，端口才会生效：

```powershell
$exe = "$env:LOCALAPPDATA\Doubao\Application\app\Doubao.exe"
Get-Process Doubao -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process $exe -ArgumentList '--remote-debugging-port=9222'
```

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
# Browser: Chrome/147.0.7727.149
```

## 二、目标（target）类型

`GET /json/list` 返回的目标里要注意两种：

```
page    | 豆包                    | doubao://doubao-chat/chat
webview | 免费领额度              | https://www.doubao.com/pc/agent-explore
```

签到页是 **webview**，不是 page。只筛 `page` 会找不到它。

## 三、节点取证

页面 DOM 规模：签到页约 440 个节点（`document.getElementsByTagName('*').length`）。

### 未签到

签到卡片的原始 HTML：

```html
<div class="card-BH6tCr" data-reward-code="daily_signin" data-reward-source="task_panel">
  <div class="main-J0ZkcI">
    <div class="titleRow-ZouaEt">
      <div class="title-MoEIh2">每日签到</div>
      <span class="reward-kcKiJn">+200 额度</span>
    </div>
  </div>
  <button type="button" class="action-mMDQ_e">立即签到</button>
</div>
```

同页整张活动页还带这些 `data-reward-code`，可用于确认页面已加载：
`select_work_fields`、`pc_task_generate_document_v2`、`browser_tool`、`pc_task_generate_excel_v2`、
`pc_task_generate_ppt_v2`、`pc_task_complete_computer_task_v2`、`pc_task_use_skill_v2`、
`points_milestone_500` / `points_milestone_2000` / `points_milestone_5000`。

### 已签到

点击后按钮节点被整体移除，替换为对勾：

```html
<div class="card-BH6tCr" data-reward-code="daily_signin" data-reward-source="task_panel">
  <div class="main-J0ZkcI">
    <div class="titleRow-ZouaEt">
      <div class="title-MoEIh2">每日签到</div>
      <span class="reward-kcKiJn">+200 额度</span>
    </div>
  </div>
  <div class="rewarded-nPpEuG">
    <svg width="24" height="24" class="rewardedIcon-NKqNlH" aria-hidden="true">…</svg>
  </div>
</div>
```

要点：

- 没有 `<button>`，没有文本，没有 `aria-label`，`aria-disabled` 也不存在（不是「禁用按钮」，是「没有按钮」）。
- 卡片 `textContent` 从 `每日签到+200 额度立即签到` 变成 `每日签到+200 额度`。
- 因此「已签到」的稳定判据是：卡片存在 + 无 button + 有 `[class*="rewarded-"]`。

## 四、agent-browser 使用记录

连接与切换：

```bash
agent-browser --cdp 9222 tab list        # t1 背景页 / t2 豆包 / t5 免费领额度
agent-browser --cdp 9222 tab t2
agent-browser --cdp 9222 snapshot --interactive --compact
```

坑一：tab 参数不接受数字，必须用 `t2` 这种 tab id。
坑二：`-i` 会被 PowerShell 当成公共参数名解析，要写 `--interactive`。
坑三：agent-browser 的常驻 daemon 会继承 stdout 管道，直接被调用时命令不返回。
必须把输出重定向到文件，再读文件。仓库已提供现成包装脚本：

```powershell
pwsh -File scripts/ab-wrap.ps1 --cdp 9222 tab list
pwsh -File scripts/ab-wrap.ps1 --cdp 9222 snapshot --interactive --compact
```

脚本内部通过 `npm root -g` 定位 CLI（不写死安装路径），并把输出落到 `.tmp/ab.out`。
核心就是这一段：

```powershell
$p = Start-Process -FilePath (Get-Command node).Source `
  -ArgumentList (@("`"$cli`"") + $AbArgs) `
  -RedirectStandardOutput $out -RedirectStandardError $err `
  -PassThru -NoNewWindow
$p.WaitForExit(90000) | Out-Null
Get-Content $out -Raw
```

坑四：`agent-browser eval` 的 JS 里带空格和双引号时，经 `Start-Process` 传参会断词，
复杂表达式改写进文件、用本项目自带的 CDP 客户端跑更省事。

## 五、坐标坑

截图是 1398x942，但页面 `innerWidth/innerHeight` 是 1118x754。
`deviceScaleFactor = 1.25`，鼠标事件的坐标必须用 **CSS 像素**（`getBoundingClientRect`），
不能拿截图像素直接点。
