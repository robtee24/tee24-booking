# Put the kiosk home window directly underneath GSPro and give GSPro the keyboard.
#
# Home has to stay on screen under GSPro (so GSPro closing reveals the kiosk,
# never the desktop), and Electron has no call for "place my window below that
# other program's window". Hiding home and showing it again without activating
# it does NOT do it: Windows puts the re-shown window at the top of the stack,
# over GSPro (seen 15 Nov 2026 on bay 11). This asks Windows for the exact
# order instead. Nothing is hidden, so nothing flashes.
#
# Exit codes: 0 parked, 2 GSPro is gone, 3 GSPro has no visible window (yet),
#             4 the kiosk window handle is not a window, 5 Windows refused.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.
param(
  [Parameter(Mandatory = $true)][int]$GsproPid,
  [Parameter(Mandatory = $true)][long]$HomeHwnd,
  # How long to wait for GSPro to have a visible window before giving up.
  [int]$WaitMs = 5000
)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Tee24 -Name ParkWin -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
'@

$p = Get-Process -Id $GsproPid -ErrorAction SilentlyContinue
if (-not $p) { exit 2 }

# Process.MainWindowHandle is non-zero only once the process has a visible window.
$gspro = [IntPtr]::Zero
$deadline = (Get-Date).AddMilliseconds($WaitMs)
do {
  try { $p.Refresh(); if ($p.HasExited) { exit 2 } } catch { exit 2 }
  $gspro = $p.MainWindowHandle
  if ($gspro -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if ($gspro -eq [IntPtr]::Zero) { exit 3 }

$kiosk = [IntPtr]$HomeHwnd
if (-not [Tee24.ParkWin]::IsWindow($kiosk)) { exit 4 }

# Foreground first: that also raises GSPro, and the kiosk must end up directly
# under wherever GSPro finally sits.
# The player just pressed Play on the kiosk, so the kiosk still has the keyboard.
$fg = 'already'
if ([Tee24.ParkWin]::GetForegroundWindow() -ne $gspro) {
  [void][Tee24.ParkWin]::SetForegroundWindow($gspro)
  $fg = 'set'
  if ([Tee24.ParkWin]::GetForegroundWindow() -ne $gspro) {
    # Windows only lets a program hand over the foreground right after input.
    # A tap of Alt counts as input and is the documented way to earn that right.
    [Tee24.ParkWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [Tee24.ParkWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][Tee24.ParkWin]::SetForegroundWindow($gspro)
    $fg = if ([Tee24.ParkWin]::GetForegroundWindow() -eq $gspro) { 'set after alt' } else { 'refused' }
  }
}

# SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE: change the stacking order only.
if (-not [Tee24.ParkWin]::SetWindowPos($kiosk, $gspro, 0, 0, 0, 0, 0x13)) { exit 5 }

Write-Output ("gspro=0x{0:X} foreground={1}" -f [int64]$gspro, $fg)
exit 0
