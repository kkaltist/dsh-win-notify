# dsh-win-notify —— 真正的 Windows 通知（WinRT Toast）
#
# 由 lib/toast.js 拉起：
#   powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File toast.ps1 -Payload <json>
#
# 载荷（JSON，UTF-8）：
#   aumid       AppUserModelID（通知归属的「应用」）
#   title       第一行：DeepSeek Harness
#   subtitle    第二行：任务完成 · 16:24 · 第 3 轮
#   body        正文（模型回答 / 问题 / 授权理由）
#   launchUri   点通知正文 → dsh-notify://…/open（先切回已开的页面）
#   actions     [{ content, uri }]  底部按钮，uri 是 dsh-notify:// 协议地址
#   input       { placeholder, button, uri } 或 null：通知里的输入框 + 发送按钮
#   tag         同一 tag 的新通知会覆盖旧的（同一个会话不堆卡）
#   audio       { src } 或 { silent: true }
#   skipWhenFocused  为真且前台窗口标题含 focusTitles 时，直接不发
#   focusTitles      窗口标题提示词数组

param([Parameter(Mandatory = $true)][string]$Payload)

$ErrorActionPreference = 'Stop'

$p = Get-Content -Raw -Encoding UTF8 -LiteralPath $Payload | ConvertFrom-Json

# ── 人就在 DSH 前面，就别再弹了 ─────────────────────────────────────────
if ($p.skipWhenFocused) {
  try {
    . (Join-Path $PSScriptRoot 'dshwin.ps1')
    $foreground = Get-DshForegroundTitle
    foreach ($hint in @($p.focusTitles)) {
      if ($null -ne $hint -and [string]$hint -ne '' -and $foreground.IndexOf([string]$hint, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        exit 0
      }
    }
  } catch {
    # 读不到前台窗口就照常发，宁可多一条通知也不能漏
  }
}

function Esc([string]$text) {
  if ($null -eq $text) { return '' }
  return [System.Security.SecurityElement]::Escape($text)
}

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

# ── 组装 adaptive toast ─────────────────────────────────────────────────
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('<toast activationType="protocol" launch="' + (Esc([string]$p.launchUri)) + '" scenario="default">')
[void]$sb.Append('<visual><binding template="ToastGeneric">')
[void]$sb.Append('<text hintMaxLines="1">' + (Esc([string]$p.title)) + '</text>')
if ($p.subtitle) {
  [void]$sb.Append('<text hintMaxLines="1" hintStyle="captionSubtle">' + (Esc([string]$p.subtitle)) + '</text>')
}
# 正文是最重要的一段：给足行数，它是那块「点一下就回 DSH」的空白区
[void]$sb.Append('<text hintMaxLines="6">' + (Esc([string]$p.body)) + '</text>')
[void]$sb.Append('<text placement="attribution">DeepSeek Harness</text>')
[void]$sb.Append('</binding></visual>')

$hasActions = ($p.actions -and @($p.actions).Count -gt 0) -or $p.input
if ($hasActions) {
  [void]$sb.Append('<actions>')
  if ($p.input) {
    $ph = if ($p.input.placeholder) { [string]$p.input.placeholder } else { '回复 DeepSeek Harness' }
    [void]$sb.Append('<input id="reply" type="text" placeHolderContent="' + (Esc $ph) + '" />')
    $btn = if ($p.input.button) { [string]$p.input.button } else { '发送' }
    [void]$sb.Append('<action content="' + (Esc $btn) + '" activationType="protocol" arguments="' + (Esc([string]$p.input.uri)) + '" hintInputId="reply" />')
  }
  foreach ($action in @($p.actions)) {
    [void]$sb.Append('<action content="' + (Esc([string]$action.content)) + '" activationType="protocol" arguments="' + (Esc([string]$action.uri)) + '" />')
  }
  [void]$sb.Append('</actions>')
}

if ($p.audio -and $p.audio.silent) {
  [void]$sb.Append('<audio silent="true" />')
} elseif ($p.audio -and $p.audio.src) {
  [void]$sb.Append('<audio src="' + (Esc([string]$p.audio.src)) + '" loop="false" />')
} else {
  [void]$sb.Append('<audio src="ms-winsoundevent:Notification.Default" />')
}
[void]$sb.Append('</toast>')

$xml = $sb.ToString()

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)

$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
if ($p.tag) { $toast.Tag = [string]$p.tag }
if ($p.group) { $toast.Group = [string]$p.group }

$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier([string]$p.aumid)
$notifier.Show($toast)
