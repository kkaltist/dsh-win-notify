# dsh-win-notify —— 通知被点击时被 Windows 拉起（dsh-notify:// 协议）
#
# 形如：
#   dsh-notify://<port>/<secret>/<id>/open?u=<DSH地址>&f=<标题提示词，用|分隔>
#   dsh-notify://<port>/<secret>/<id>/reply?t=<输入框文本>&u=..&f=..
#   dsh-notify://<port>/<secret>/<id>/option?v=<取值>&u=..&f=..
#
# 干两件事：把动作 POST 回 DSH 主机；需要露出界面时，**先找任务栏/桌面里已经开着的
# DSH 页面并切过去**（focus.ps1），找不到才新开一个。全程无窗口。

param([Parameter(Mandatory = $true)][string]$Uri)

$ErrorActionPreference = 'SilentlyContinue'

function Decode([string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return '' }
  try { return [System.Uri]::UnescapeDataString($value.Replace('+', ' ')) } catch { return $value }
}

$u = [System.Uri]::new($Uri.Replace('dsh-notify://', 'http://'))
$port = $u.Authority
$parts = $u.AbsolutePath.Trim('/').Split('/')
$secret = if ($parts.Count -ge 1) { $parts[0] } else { '' }
$id = if ($parts.Count -ge 2) { $parts[1] } else { '' }
$action = if ($parts.Count -ge 3) { $parts[2] } else { 'open' }

$query = @{}
foreach ($pair in $u.Query.TrimStart('?').Split('&')) {
  if ($pair -eq '') { continue }
  $kv = $pair.Split('=', 2)
  $query[(Decode $kv[0])] = if ($kv.Count -gt 1) { Decode $kv[1] } else { '' }
}

$fallback = if ($query.ContainsKey('u')) { $query['u'] } else { '' }
$titles = if ($query.ContainsKey('f') -and $query['f'] -ne '') { $query['f'] } else { 'DeepSeek Harness' }

# 先把已经开着的 DSH 页面叫到前台；叫不动才打开新页面。
function Show-Dsh {
  $focus = Join-Path $PSScriptRoot 'focus.ps1'
  if (Test-Path -LiteralPath $focus) {
    & $focus -Titles $titles -Quiet | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
  }
  if ($fallback -ne '') { Start-Process $fallback | Out-Null }
}

if ($action -eq 'open') {
  Show-Dsh
  exit 0
}

$body = @{ id = $id; action = $action }
if ($query.ContainsKey('v')) { $body['value'] = $query['v'] }
if ($query.ContainsKey('t')) {
  # 协议激活拿不到输入框里的字时，Windows 会把占位符原样送过来
  $text = $query['t']
  if ($text -match '^\{.*\}$') { $text = '' }
  if ($text -ne '') { $body['text'] = $text }
}

# 点了「发送」但字没带回来：与其丢消息，不如把人带回 DSH
if ($action -eq 'reply' -and -not $body.ContainsKey('text')) {
  Show-Dsh
  exit 0
}

$json = $body | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$endpoint = "http://127.0.0.1:$port/reply/$secret"

try {
  $req = [System.Net.HttpWebRequest]::Create($endpoint)
  $req.Proxy = $null
  $req.Method = 'POST'
  $req.ContentType = 'application/json; charset=utf-8'
  $req.Timeout = 4000
  $req.ContentLength = $bytes.Length
  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
  $resp = $req.GetResponse()
  $resp.Close()
} catch {
  # DSH 已经关了或端口变了：把界面露出来，别让人干等
  Show-Dsh
}
