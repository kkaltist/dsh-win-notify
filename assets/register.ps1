# dsh-win-notify —— 一次性注册：让 Windows 认下「DeepSeek Harness」这个通知来源
#
# 做三件事（都可以重复执行，幂等）：
#   1. 在开始菜单建一个快捷方式，并把 AppUserModelID 写到它身上
#      —— 没有这一步，Win10/11 会静默丢掉 toast，不报错、也不显示；
#   2. 写 HKCU\Software\Classes\AppUserModelId\<AUMID>，让设置里能看到并开通知；
#   3. 注册 dsh-notify:// 协议，通知上的输入框/按钮点了以后能回到 DSH。

param(
  [string]$Aumid = 'DeepSeek.Harness',
  [string]$DisplayName = 'DeepSeek Harness',
  [string]$Activate,      # 协议激活脚本绝对路径
  [string]$Icon = ''      # .ico 绝对路径，可选
)

$ErrorActionPreference = 'Stop'

if (-not $Activate) { throw '缺少 -Activate（协议激活脚本路径）' }

# ── 1. 快捷方式 + AUMID ────────────────────────────────────────────────
if (-not ('DshAumid' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DshAumid
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit)]
    struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        uint GetCount(out uint cProps);
        void GetAt(uint iProp, out PropertyKey pkey);
        void GetValue(ref PropertyKey key, out PropVariant pv);
        void SetValue(ref PropertyKey key, ref PropVariant pv);
        void Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr pbc, int flags, ref Guid riid, out IPropertyStore store);

    public static void Set(string shortcutPath, string aumid)
    {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(shortcutPath, IntPtr.Zero, 2, ref iid, out store);
        if (hr != 0) throw new COMException("SHGetPropertyStoreFromParsingName failed: " + hr);

        PropertyKey key = new PropertyKey();
        key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        key.pid = 5; // PKEY_AppUserModel_ID

        PropVariant pv = new PropVariant();
        pv.vt = 31; // VT_LPWSTR
        pv.pointerValue = Marshal.StringToCoTaskMemUni(aumid);
        try
        {
            store.SetValue(ref key, ref pv);
            store.Commit();
        }
        finally
        {
            Marshal.FreeCoTaskMem(pv.pointerValue);
            Marshal.ReleaseComObject(store);
        }
    }
}
'@
}

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
# 名字要跟桌面应用「DeepSeek Harness」区分开：同名会互相覆盖，装过官方桌面端的人
# 会突然发现自己的快捷方式指向了通知脚本。
$lnkPath = Join-Path $startMenu 'DSH 桌面通知.lnk'
$shell = New-Object -ComObject WScript.Shell

# 老版本用的是「DeepSeek Harness.lnk」，确认那条是我们自己写的才删
$legacy = Join-Path $startMenu 'DeepSeek Harness.lnk'
if (Test-Path -LiteralPath $legacy) {
  try {
    $old = $shell.CreateShortcut($legacy)
    if ("$($old.Arguments)" -like '*activate.ps1*') { Remove-Item -LiteralPath $legacy -Force }
  } catch {
    # 读不动就不动它
  }
}

$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$lnk.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" "%1"' -f $Activate
$lnk.WorkingDirectory = Split-Path $Activate -Parent
$lnk.Description = 'DSH 桌面通知'
if ($Icon -ne '' -and (Test-Path $Icon)) { $lnk.IconLocation = $Icon }
$lnk.Save()

[DshAumid]::Set($lnkPath, $Aumid)

# ── 2. 让通知设置里出现这个应用 ────────────────────────────────────────
$appKey = "HKCU:\SOFTWARE\Classes\AppUserModelId\$Aumid"
New-Item -Path $appKey -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'DisplayName' -Value $DisplayName
if ($Icon -ne '' -and (Test-Path $Icon)) {
  Set-ItemProperty -Path $appKey -Name 'IconUri' -Value $Icon
}
New-ItemProperty -Path $appKey -Name 'ShowInSettings' -Value 1 -PropertyType DWord -Force | Out-Null

# ── 3. dsh-notify:// 协议 ──────────────────────────────────────────────
$proto = 'HKCU:\SOFTWARE\Classes\dsh-notify'
New-Item -Path $proto -Force | Out-Null
Set-ItemProperty -Path $proto -Name '(default)' -Value 'URL:DeepSeek Harness Notify'
# 这一个空值才是「这是 URL 协议」的开关：少了它，Windows 会弹
# 「没有可打开此链接的应用」，通知上的按钮永远点不通。
New-ItemProperty -Path $proto -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$proto\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$proto\DefaultIcon" -Name '(default)' -Value ($(if ($Icon -ne '' -and (Test-Path $Icon)) { $Icon } else { 'powershell.exe' }) + ',0')
New-Item -Path "$proto\shell\open\command" -Force | Out-Null
$cmd = '"{0}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" "%1"' -f (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'), $Activate
Set-ItemProperty -Path "$proto\shell\open\command" -Name '(default)' -Value $cmd

"registered: $Aumid -> $lnkPath"
