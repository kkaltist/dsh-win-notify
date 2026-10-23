# dsh-win-notify —— 把已经开着的 DSH 页面叫到前台
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File focus.ps1 [-Titles 'DeepSeek Harness|DSH']
#
# 退出码：0 = 已切过去；1 = 没找到 / 抢不到（调用方应退化为「打开新页面」）。

param(
  [string]$Titles = 'DeepSeek Harness',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dshwin.ps1')

$hints = @($Titles.Split('|') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($hints.Count -eq 0) { $hints = @('DeepSeek Harness') }

$handle = Find-DshWindow -Hints $hints
if ($handle -eq [IntPtr]::Zero) {
  if (-not $Quiet) { Write-Output 'not-found' }
  exit 1
}

if (Show-DshWindow -Handle $handle) {
  if (-not $Quiet) { Write-Output ([DshWin]::TitleOf($handle)) }
  exit 0
}

if (-not $Quiet) { Write-Output 'activate-failed' }
exit 1
