# dsh-win-notify —— 卸载前清理（把插件在系统里留下的东西擦干净）
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File unregister.ps1
#
# 只动当前用户（HKCU）与开始菜单里的那一个快捷方式：
#   · 开始菜单「DSH 桌面通知.lnk」
#   · HKCU\SOFTWARE\Classes\dsh-notify（协议）
#   · HKCU\SOFTWARE\Classes\AppUserModelId\<AUMID>（应用身份）
#   · HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\<AUMID>（通知开关）
# 不碰 DSH 本体，也不碰你自己的音频文件。

param([string]$Aumid = 'DeepSeek.Harness')

$ErrorActionPreference = 'SilentlyContinue'

$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DSH 桌面通知.lnk'
if (Test-Path -LiteralPath $lnk) {
  Remove-Item -LiteralPath $lnk -Force
  "removed $lnk"
}

foreach ($key in @(
    'HKCU:\SOFTWARE\Classes\dsh-notify',
    "HKCU:\SOFTWARE\Classes\AppUserModelId\$Aumid",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\$Aumid"
  )) {
  if (Test-Path -LiteralPath $key) {
    Remove-Item -LiteralPath $key -Recurse -Force
    "removed $key"
  }
}

# 缓存的编译产物
$cache = Join-Path $env:LOCALAPPDATA 'dsh-win-notify'
if (Test-Path -LiteralPath $cache) {
  Remove-Item -LiteralPath $cache -Recurse -Force
  "removed $cache"
}

'已清理。接下来从 profile 里卸包：dsh plugin remove dsh-win-notify --profile web'
