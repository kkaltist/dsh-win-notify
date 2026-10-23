# dsh-win-notify —— 共用 Win32 助手（窗口查找 / 抢前台 / 读前台标题）
#
# 被 focus.ps1 与 toast.ps1 点源引用：
#   . "$PSScriptRoot\dshwin.ps1"
#
# C# 编译结果缓存成 dll：这两支脚本每次点击都要跑，不能每次都等编译。

$cacheDir = Join-Path $env:LOCALAPPDATA 'dsh-win-notify'
$cacheDll = Join-Path $cacheDir 'DshWin.dll'

if (-not ('DshWin' -as [type])) {
  $code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DshWin
{
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    public static string TitleOf(IntPtr h)
    {
        int len = GetWindowTextLength(h);
        if (len <= 0) return "";
        StringBuilder sb = new StringBuilder(len + 2);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string ForegroundTitle()
    {
        return TitleOf(GetForegroundWindow());
    }

    public static IntPtr Find(string[] hints)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            if (!IsWindowVisible(h)) return true;
            string title = TitleOf(h);
            if (title.Length == 0) return true;
            for (int i = 0; i < hints.Length; i++)
            {
                if (hints[i].Length > 0 && title.IndexOf(hints[i], StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    found = h;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Activate(IntPtr h)
    {
        if (h == IntPtr.Zero) return false;
        if (IsIconic(h)) ShowWindow(h, 9);

        uint pid;
        uint other = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        uint self = GetCurrentThreadId();
        bool attached = false;
        try
        {
            if (other != 0 && other != self) attached = AttachThreadInput(other, self, true);
            SetForegroundWindow(h);
            BringWindowToTop(h);
            SwitchToThisWindow(h, true);
        }
        finally
        {
            if (attached) AttachThreadInput(other, self, false);
        }
        return GetForegroundWindow() == h;
    }
}
'@
  if (Test-Path -LiteralPath $cacheDll) {
    try { Add-Type -Path $cacheDll } catch { Add-Type -TypeDefinition $code }
  } else {
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    try {
      Add-Type -TypeDefinition $code -OutputAssembly $cacheDll
      Add-Type -Path $cacheDll
    } catch {
      Add-Type -TypeDefinition $code
    }
  }
}

function Get-DshForegroundTitle { [DshWin]::ForegroundTitle() }
function Find-DshWindow([string[]]$Hints) { [DshWin]::Find($Hints) }
function Show-DshWindow([IntPtr]$Handle) { [DshWin]::Activate($Handle) }
