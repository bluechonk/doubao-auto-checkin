# 注册/注销 Windows 计划任务：每天定时执行豆包签到。
# 用法：
#   pwsh -File scripts/install-task.ps1                 # 默认每天 09:10
#   pwsh -File scripts/install-task.ps1 -Time 08:30
#   pwsh -File scripts/install-task.ps1 -Uninstall

param(
  [string]$Time = '09:10',
  [string]$TaskName = 'DoubaoAutoCheckin',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw 'require PowerShell 7 (pwsh)'
}

if ($Uninstall) {
  $existing = schtasks /Query /TN $TaskName 2>$null
  if (-not $existing) {
    Write-Output "task not found: $TaskName"
    exit 0
  }
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Output "removed task: $TaskName"
  exit 0
}

$projectRoot = Split-Path $PSScriptRoot -Parent
$entry = Join-Path $projectRoot 'bin\doubao-checkin.mjs'
if (-not (Test-Path $entry)) { throw "entry not found: $entry" }

$node = (Get-Command node -ErrorAction Stop).Source
$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'checkin.log'

# 用 cmd 串一层，把输出追加进日志文件
$action = "`"$node`" `"$entry`" --quiet >> `"$logFile`" 2>&1"
$actionFile = Join-Path $logDir 'run-checkin.cmd'
Set-Content -Path $actionFile -Value "@echo off`r`n$action" -Encoding ascii

schtasks /Create /TN $TaskName /TR "`"$actionFile`"" /SC DAILY /ST $Time /F | Out-Null
Write-Output "created task: $TaskName at $Time"
Write-Output "action: $node `"$entry`" --quiet"
Write-Output "log: $logFile"
Write-Output "提示：任务以当前用户身份运行，需保持客户端已登录。"
