# agent-browser 包装器：把输出重定向到文件再读取。
#
# 为什么需要它：agent-browser 的常驻 daemon 会继承调用方的 stdout 管道句柄，
# 直接调用会一直不返回（表现为命令挂起）。
#
# 用法：
#   pwsh -File scripts/ab-wrap.ps1 --cdp 9222 tab list
#   pwsh -File scripts/ab-wrap.ps1 --cdp 9222 snapshot --interactive --compact
#
# 前置：已安装 agent-browser（npm i -g agent-browser），且客户端带调试端口运行。

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AbArgs)

$ErrorActionPreference = 'Stop'

if (-not $AbArgs -or $AbArgs.Count -eq 0) {
  throw '用法: pwsh -File scripts/ab-wrap.ps1 <agent-browser 参数...>'
}

# 通过 npm 全局根目录定位 CLI，不写死安装路径
$globalRoot = (& npm root -g).Trim()
$cli = Join-Path $globalRoot 'agent-browser\bin\agent-browser.js'
if (-not (Test-Path $cli)) {
  throw "未找到 agent-browser CLI（$cli），请先执行：npm i -g agent-browser"
}

$node = (Get-Command node -ErrorAction Stop).Source
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) '.tmp'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'ab.out'
$err = Join-Path $outDir 'ab.err'
Remove-Item $out, $err -ErrorAction SilentlyContinue

$argList = @("`"$cli`"") + $AbArgs
$proc = Start-Process -FilePath $node -ArgumentList $argList `
  -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow

if (-not $proc.WaitForExit(90000)) {
  $proc.Kill()
  Write-Output 'TIMEOUT: agent-browser 90s 未返回'
}

Get-Content $out -Raw -ErrorAction SilentlyContinue
$stderrText = Get-Content $err -Raw -ErrorAction SilentlyContinue
if ($stderrText) { Write-Output "[stderr] $stderrText" }
