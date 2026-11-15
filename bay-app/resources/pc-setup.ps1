<#
  Tee24 bay PC setup, driven by src/main/pcsetup.ts (Settings -> PC cleanup).

  A bay PC runs three things: the kiosk, the launch-monitor software and GSPro.
  This script removes the apps Windows and the PC maker preinstall that a bay
  never uses, and sets Windows up for that one job.

    -Mode status   Read-only, no elevation. Prints one JSON object on stdout.
    -Mode apply    Elevated. Removes the app groups named in -Groups and, with
                   -Tune, applies the Windows tuning. Result JSON goes to -Out.
    -Mode undo     Elevated. Puts back every setting the tuning changed, from the
                   values recorded before the first apply. Result JSON goes to -Out.
    -Mode define   Defines the functions and does nothing (for testing).

  Removal is by explicit list: anything not named below is left alone. Deliberately
  kept: NVIDIA software, Xbox Game Bar and the Xbox services (removing Game Bar
  makes Windows pop up "you'll need a new app to open this ms-gamingoverlay link"
  over games), OMEN Gaming Hub, HP support and diagnostics, audio and codec
  packages, Microsoft Store, Edge / WebView2, Notepad, Terminal, Snipping Tool,
  Quick Assist, Windows Security and OneDrive (Desktop and Documents are usually
  redirected into it, and GSPro exports live there).

  Also deliberately untouched: SysMain (it runs memory compression, which an 8 GB
  bay PC depends on), Windows Update and Defender.

  Removed apps are not restored by undo; they can be reinstalled from Microsoft Store.
  Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less files as ANSI.
#>
param(
  [ValidateSet('status', 'apply', 'undo', 'define')][string]$Mode = 'status',
  # SID of the Windows user the kiosk runs as. UAC may elevate as a different admin
  # account, so per-user settings are written to HKEY_USERS\<sid>, never HKCU.
  [string]$UserSid = '',
  # Comma-separated app group ids to remove.
  [string]$Groups = '',
  [switch]$Tune,
  [string]$Out = '',
  [string]$ProgressFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------- app lists

# Each app is (package name pattern, name shown to the admin).
$AppGroups = @(
  @{
    id = 'windows'; label = 'Windows extras'
    apps = @(
      @('Microsoft.WindowsCalculator', 'Calculator'),
      @('Microsoft.WindowsAlarms', 'Clock'),
      @('Microsoft.WindowsCamera', 'Camera'),
      @('Microsoft.WindowsSoundRecorder', 'Sound Recorder'),
      @('Microsoft.Paint', 'Paint'),
      @('Microsoft.Windows.Photos', 'Photos'),
      @('Microsoft.ZuneMusic', 'Media Player'),
      @('Microsoft.ZuneVideo', 'Movies & TV'),
      @('Clipchamp.Clipchamp', 'Clipchamp'),
      @('Microsoft.MicrosoftStickyNotes', 'Sticky Notes'),
      @('Microsoft.Todos', 'To Do'),
      @('Microsoft.Whiteboard', 'Whiteboard'),
      @('Microsoft.MicrosoftJournal', 'Journal'),
      @('Microsoft.WindowsMaps', 'Maps'),
      @('Microsoft.BingNews', 'News'),
      @('Microsoft.BingWeather', 'Weather'),
      @('Microsoft.BingSearch', 'Bing Search'),
      @('Microsoft.MicrosoftSolitaireCollection', 'Solitaire'),
      @('Microsoft.Getstarted', 'Tips'),
      @('Microsoft.GetHelp', 'Get Help'),
      @('Microsoft.WindowsFeedbackHub', 'Feedback Hub'),
      @('MicrosoftCorporationII.MicrosoftFamily', 'Family'),
      @('Microsoft.YourPhone', 'Phone Link'),
      @('MicrosoftWindows.CrossDevice', 'Cross Device'),
      @('MicrosoftWindows.Client.WebExperience', 'Widgets'),
      @('Microsoft.StartExperiencesApp', 'Widgets news feed'),
      @('Microsoft.PowerAutomateDesktop', 'Power Automate'),
      @('Microsoft.Windows.DevHome', 'Dev Home'),
      @('Microsoft.MixedRealityLink', 'Mixed Reality Link'),
      @('Microsoft.MixedReality.Portal', 'Mixed Reality Portal'),
      @('Microsoft.Microsoft3DViewer', '3D Viewer'),
      @('microsoft.windowscommunicationsapps', 'Mail and Calendar'),
      @('Microsoft.People', 'People'),
      @('Microsoft.SkypeApp', 'Skype'),
      @('Microsoft.549981C3F5F10', 'Cortana')
    )
  },
  @{
    id = 'office'; label = 'Microsoft 365, Outlook, Teams and Copilot'
    apps = @(
      @('Microsoft.MicrosoftOfficeHub', 'Microsoft 365 Copilot app'),
      @('Microsoft.OutlookForWindows', 'Outlook'),
      @('MSTeams', 'Teams'),
      @('MicrosoftTeams', 'Teams (personal)'),
      @('Microsoft.Copilot', 'Copilot'),
      @('Microsoft.Office.OneNote', 'OneNote'),
      @('7EE7776C.LinkedInforWindows', 'LinkedIn')
    )
  },
  @{
    id = 'oem'; label = 'PC maker and promotional apps'
    apps = @(
      @('C27EB4BA.DropboxOEM', 'Dropbox promotion'),
      @('AD2F1837.myHP', 'myHP'),
      @('AD2F1837.HPPrinterControl', 'HP Smart'),
      @('AD2F1837.HPPrivacySettings', 'HP Privacy Settings'),
      @('AD2F1837.HPJumpStarts', 'HP JumpStarts'),
      @('AD2F1837.HPQuickDrop', 'HP QuickDrop'),
      @('SpotifyAB.SpotifyMusic', 'Spotify'),
      @('Disney.*', 'Disney+'),
      @('*Netflix*', 'Netflix'),
      @('AmazonVideo.PrimeVideo', 'Prime Video'),
      @('BytedancePte.Ltd.TikTok', 'TikTok'),
      @('Facebook.*', 'Facebook / Instagram'),
      @('king.com.*', 'Candy Crush games'),
      @('*McAfee*', 'McAfee (Store app)')
    )
  }
)

# Desktop programs with a known silent uninstall. Matched on the Apps & features
# name AND the uninstaller's file name, so a look-alike entry is never run.
$Win32Rules = @(
  @{ group = 'office'; name = '^Microsoft (365|OneNote)\b'; exe = 'OfficeClickToRun.exe'; silent = ' DisplayLevel=False' },
  @{ group = 'office'; name = '^Copilot$'; exe = 'copilot_setup.exe'; silent = ' --force-uninstall' }
)
$Win32WaitMinutes = 20

# ---------------------------------------------------------------- tuning lists

$UserRoot = 'Registry::HKEY_CURRENT_USER'
if ($UserSid) { $UserRoot = "Registry::HKEY_USERS\$UserSid" }
$MachineRoot = 'Registry::HKEY_LOCAL_MACHINE'

$Cdm = 'Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
# All DWORD. root U = the kiosk's Windows user, M = this computer.
$RegTweaks = @(
  # Game Mode gives the foreground game (GSPro) CPU/GPU priority; background
  # capture keeps a recording buffer running the whole session for nothing.
  @{ id = 'game'; root = 'U'; key = 'Software\Microsoft\GameBar'; name = 'AutoGameModeEnabled'; value = 1 },
  @{ id = 'game'; root = 'U'; key = 'System\GameConfigStore'; name = 'GameDVR_Enabled'; value = 0 },
  @{ id = 'game'; root = 'U'; key = 'Software\Microsoft\Windows\CurrentVersion\GameDVR'; name = 'AppCaptureEnabled'; value = 0 },
  # Stops Windows reinstalling suggested apps and showing tips, and the full-screen
  # "Let's finish setting up your device" page that covers the kiosk after updates.
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'SilentInstalledAppsEnabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'PreInstalledAppsEnabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'OemPreInstalledAppsEnabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'SoftLandingEnabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'SystemPaneSuggestionsEnabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'SubscribedContent-338389Enabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = $Cdm; name = 'SubscribedContent-310093Enabled'; value = 0 },
  @{ id = 'quiet'; root = 'U'; key = 'Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement'; name = 'ScoobeSystemSettingEnabled'; value = 0 },
  @{ id = 'quiet'; root = 'M'; key = 'SOFTWARE\Policies\Microsoft\Dsh'; name = 'AllowNewsAndInterests'; value = 0 },
  # Edge otherwise preloads at sign-in and keeps running after its windows close.
  @{ id = 'edge'; root = 'M'; key = 'SOFTWARE\Policies\Microsoft\Edge'; name = 'StartupBoostEnabled'; value = 0 },
  @{ id = 'edge'; root = 'M'; key = 'SOFTWARE\Policies\Microsoft\Edge'; name = 'BackgroundModeEnabled'; value = 0 }
)

# Search indexing, Windows telemetry, offline maps updates, HP telemetry.
$Services = @('WSearch', 'DiagTrack', 'MapsBroker', 'HpTouchpointAnalyticsService')

# Windows 11 "Power mode: Best performance".
$OverlayMax = 'ded574b5-45a0-4f42-8737-46345c09c238'
$OverlayKey = "$MachineRoot\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes"
# (subgroup, setting, value on AC power): never sleep, never hibernate, USB
# selective suspend off (the launch-monitor cameras are USB devices).
$PowerSettings = @(
  @('SUB_SLEEP', 'STANDBYIDLE', 0),
  @('SUB_SLEEP', 'HIBERNATEIDLE', 0),
  @('2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', 0)
)

# GSPro commits 17-18 GB and IDRA about 8 GB while a course loads. On an 8 GB PC
# the default pagefile runs out and GSPro dies with "out of memory", so the
# pagefile gets a fixed, larger size. PCs with 12 GB or more are left alone.
$PagefileRamLimitGB = 12
$PagefileInitialMB = 24576
$PagefileMaxMB = 49152
$PagefileMinFreeGB = 80

$BackupFile = Join-Path $env:ProgramData 'Tee24\pc-setup-backup.json'
$Backup = @{}

# ---------------------------------------------------------------- helpers

function Say([string]$msg) {
  if ($ProgressFile) { Add-Content -Path $ProgressFile -Value $msg -Encoding UTF8 -ErrorAction SilentlyContinue }
}

function Test-Elevated {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Packages {
  if (Test-Elevated) { @(Get-AppxPackage -AllUsers) } else { @(Get-AppxPackage) }
}

function Get-Win32Entries($rule) {
  $roots = @(
    "$MachineRoot\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    "$MachineRoot\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $name = $k.GetValue('DisplayName')
      $cmd = $k.GetValue('UninstallString')
      if ($name -and $cmd -and $name -match $rule.name -and $cmd -like "*$($rule.exe)*") {
        [pscustomobject]@{ label = "$name"; kind = 'win32'; key = $k.PSPath; command = "$cmd$($rule.silent)" }
      }
    }
  }
}

# What a group would remove on this PC right now.
function Find-GroupItems($group, $packages) {
  foreach ($rule in $Win32Rules) {
    if ($rule.group -eq $group.id) { Get-Win32Entries $rule }
  }
  foreach ($app in $group.apps) {
    $hits = @($packages | Where-Object { $_.Name -like $app[0] -and -not $_.IsFramework -and -not $_.NonRemovable })
    if ($hits.Count -gt 0) {
      [pscustomobject]@{ label = $app[1]; kind = 'appx'; packages = $hits }
    }
  }
}

function Get-RegPath($t) {
  if ($t.root -eq 'U') { "$UserRoot\$($t.key)" } else { "$MachineRoot\$($t.key)" }
}

function Get-RegValue([string]$path, [string]$name) {
  if (-not (Test-Path $path)) { return $null }
  $k = Get-Item $path
  if ($k.GetValueNames() -contains $name) { return $k.GetValue($name) }
  return $null
}

# ---------------------------------------------------------------- backup

function Read-Backup {
  if (-not (Test-Path $BackupFile)) { return }
  $o = Get-Content $BackupFile -Raw | ConvertFrom-Json
  foreach ($p in $o.PSObject.Properties) { $Backup[$p.Name] = $p.Value }
}

# Records the value a setting had before the kiosk first changed it. A later
# apply never overwrites it, so undo always goes back to the original.
function Remember([string]$key, $value) {
  if (-not $Backup.ContainsKey($key)) { $Backup[$key] = $value }
}

function Save-Backup {
  $dir = Split-Path $BackupFile
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $Backup | ConvertTo-Json -Depth 5 | Set-Content -Path $BackupFile -Encoding UTF8
}

function Remember-RegValue([string]$path, [string]$name) {
  $existed = $false; $old = $null; $kind = $null
  if (Test-Path $path) {
    $k = Get-Item $path
    if ($k.GetValueNames() -contains $name) {
      $existed = $true
      $old = $k.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
      $kind = "$($k.GetValueKind($name))"
    }
  }
  Remember "reg|$path|$name" @{ existed = $existed; value = $old; kind = $kind }
}

# ---------------------------------------------------------------- tuning: registry

function Test-RegGroup([string]$id) {
  foreach ($t in $RegTweaks) {
    if ($t.id -ne $id) { continue }
    $v = Get-RegValue (Get-RegPath $t) $t.name
    if ($null -eq $v -or [int]$v -ne $t.value) { return $false }
  }
  return $true
}

function Set-RegGroup([string]$id) {
  foreach ($t in $RegTweaks) {
    if ($t.id -ne $id) { continue }
    $path = Get-RegPath $t
    Remember-RegValue $path $t.name
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    New-ItemProperty -Path $path -Name $t.name -PropertyType DWord -Value $t.value -Force | Out-Null
  }
}

function Get-EdgeAutoLaunch {
  $run = "$UserRoot\Software\Microsoft\Windows\CurrentVersion\Run"
  if (-not (Test-Path $run)) { return @() }
  @((Get-Item $run).GetValueNames() | Where-Object { $_ -like 'MicrosoftEdgeAutoLaunch_*' })
}

function Remove-EdgeAutoLaunch {
  $run = "$UserRoot\Software\Microsoft\Windows\CurrentVersion\Run"
  foreach ($name in Get-EdgeAutoLaunch) {
    Remember-RegValue $run $name
    Remove-ItemProperty -Path $run -Name $name -Force
  }
}

# ---------------------------------------------------------------- tuning: services

function Test-Services {
  foreach ($n in $Services) {
    $s = Get-Service -Name $n -ErrorAction SilentlyContinue
    if ($s -and "$($s.StartType)" -ne 'Disabled') { return $false }
  }
  return $true
}

function Disable-Services {
  foreach ($n in $Services) {
    $s = Get-Service -Name $n -ErrorAction SilentlyContinue
    if (-not $s) { continue }
    if ("$($s.StartType)" -ne 'Disabled') { Remember "svc|$n" "$($s.StartType)" }
    Set-Service -Name $n -StartupType Disabled
    if ($s.Status -ne 'Stopped') { Stop-Service -Name $n -Force -ErrorAction SilentlyContinue }
  }
}

# ---------------------------------------------------------------- tuning: power

# Runs powercfg and returns its stdout; check $LASTEXITCODE for the outcome.
# Windows PowerShell turns a native command's stderr into a terminating error
# under ErrorActionPreference Stop, so that is relaxed for the call.
function Invoke-Powercfg {
  $ErrorActionPreference = 'Continue'
  & powercfg.exe @args 2>$null
}

# Current AC value of one power setting, or $null when this PC does not have it.
function Get-AcIndex([string]$sub, [string]$setting) {
  $out = Invoke-Powercfg /query SCHEME_CURRENT $sub $setting
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  # The last two hex numbers printed are the AC and DC values (text is localized).
  $m = [regex]::Matches(($out -join "`n"), '0x[0-9a-fA-F]{8}')
  if ($m.Count -lt 2) { return $null }
  return [Convert]::ToInt32($m[$m.Count - 2].Value, 16)
}

function Get-Overlay {
  "$(Get-RegValue $OverlayKey 'ActiveOverlayAcPowerScheme')"
}

function Test-Power {
  if ((Get-Overlay) -ne $OverlayMax) { return $false }
  foreach ($s in $PowerSettings) {
    $cur = Get-AcIndex $s[0] $s[1]
    if ($null -ne $cur -and $cur -ne $s[2]) { return $false }
  }
  return $true
}

function Set-Power {
  Remember 'overlay' (Get-Overlay)
  Invoke-Powercfg /overlaysetactive OVERLAY_SCHEME_MAX | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "powercfg could not set the power mode (exit $LASTEXITCODE)." }
  foreach ($s in $PowerSettings) {
    $cur = Get-AcIndex $s[0] $s[1]
    if ($null -eq $cur) { continue }
    Remember "pwr|$($s[0])|$($s[1])" $cur
    Invoke-Powercfg /setacvalueindex SCHEME_CURRENT $s[0] $s[1] $s[2] | Out-Null
  }
  Invoke-Powercfg /setactive SCHEME_CURRENT | Out-Null
}

# ---------------------------------------------------------------- tuning: pagefile

function Get-PagefilePath { "$($env:SystemDrive)\pagefile.sys" }

function Get-PagefileState {
  $cs = Get-CimInstance Win32_ComputerSystem
  $pf = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -ieq (Get-PagefilePath) } | Select-Object -First 1
  $initial = 0; $max = 0
  if ($pf) { $initial = [int]$pf.InitialSize; $max = [int]$pf.MaximumSize }
  @{
    ramGB   = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    auto    = [bool]$cs.AutomaticManagedPagefile
    initial = $initial
    max     = $max
  }
}

function Test-PagefileApplicable { (Get-PagefileState).ramGB -lt $PagefileRamLimitGB }

function Test-Pagefile {
  $st = Get-PagefileState
  (-not $st.auto) -and ($st.max -ge $PagefileMaxMB)
}

function Set-PagefileSize([int]$initialMB, [int]$maxMB) {
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs.AutomaticManagedPagefile) { Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false } }
  $pf = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -ieq (Get-PagefilePath) } | Select-Object -First 1
  $sizes = @{ InitialSize = [uint32]$initialMB; MaximumSize = [uint32]$maxMB }
  if ($pf) {
    Set-CimInstance -InputObject $pf -Property $sizes
  } else {
    New-CimInstance -ClassName Win32_PageFileSetting -Property (@{ Name = (Get-PagefilePath) } + $sizes) | Out-Null
  }
}

# Returns a reason when it had to skip, otherwise nothing.
function Set-Pagefile {
  if (Test-Pagefile) { return }
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
  $freeGB = [math]::Round($disk.FreeSpace / 1GB)
  if ($freeGB -lt $PagefileMinFreeGB) {
    return "only $freeGB GB free on $($env:SystemDrive); needs $PagefileMinFreeGB GB"
  }
  $st = Get-PagefileState
  Remember 'pagefile' @{ auto = $st.auto; initial = $st.initial; max = $st.max }
  Set-PagefileSize $PagefileInitialMB $PagefileMaxMB
}

# ---------------------------------------------------------------- tuning: table

# test/apply run in this script's scope. apply may return a "skipped because" string.
$Tunes = @(
  @{ id = 'game'; label = 'Game Mode on, background game recording off'
     test = { Test-RegGroup 'game' }; apply = { Set-RegGroup 'game' } },
  @{ id = 'power'; label = 'Power mode set to best performance, no sleep, USB ports always on'
     test = { Test-Power }; apply = { Set-Power } },
  @{ id = 'pagefile'; label = 'Virtual memory sized for GSPro (PCs with 8 GB of memory)'
     applicable = { Test-PagefileApplicable }; test = { Test-Pagefile }; apply = { Set-Pagefile } },
  @{ id = 'services'; label = 'Search indexing and telemetry services off'
     test = { Test-Services }; apply = { Disable-Services } },
  @{ id = 'edge'; label = 'Edge kept out of the background'
     test = { (Test-RegGroup 'edge') -and (@(Get-EdgeAutoLaunch).Count -eq 0) }
     apply = { Set-RegGroup 'edge'; Remove-EdgeAutoLaunch } },
  @{ id = 'quiet'; label = 'Windows suggestions, widgets and setup reminders off'
     test = { Test-RegGroup 'quiet' }; apply = { Set-RegGroup 'quiet' } }
)

# ---------------------------------------------------------------- modes

function Get-Status {
  $packages = Get-Packages
  $groups = @(foreach ($g in $AppGroups) {
    $items = @(Find-GroupItems $g $packages)
    [pscustomobject]@{ id = $g.id; label = $g.label; apps = @($items | ForEach-Object { $_.label } | Select-Object -Unique) }
  })
  $tune = @(foreach ($t in $Tunes) {
    $applicable = $true
    if ($t.applicable) { $applicable = [bool](& $t.applicable) }
    $on = $false
    try { $on = [bool](& $t.test) } catch { $on = $false }
    [pscustomobject]@{ id = $t.id; label = $t.label; on = $on; applicable = $applicable }
  })
  [pscustomobject]@{ groups = $groups; tune = $tune; canUndo = (Test-Path $BackupFile) }
}

function Remove-Win32Item($item) {
  # /s makes cmd strip exactly the outer quotes, whatever the command contains.
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$($item.command)`"" -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddMinutes($Win32WaitMinutes)
  $exitedAt = $null
  # Office's uninstaller hands off to a background process, so "done" is the
  # Apps & features entry disappearing, not the first process exiting.
  while ((Test-Path $item.key) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if ($p.HasExited) {
      if ($p.ExitCode -ne 0) { throw "uninstaller exited with code $($p.ExitCode)" }
      if (-not $exitedAt) { $exitedAt = Get-Date }
      if (((Get-Date) - $exitedAt).TotalMinutes -gt 5) { break }
    }
  }
  if (Test-Path $item.key) { throw 'the uninstaller ran but the program is still listed' }
}

function Invoke-Apply {
  $result = @{ removed = @(); tuned = @(); skipped = @(); failed = @() }

  if ($Tune) {
    Read-Backup
    foreach ($t in $Tunes) {
      if ($t.applicable -and -not (& $t.applicable)) { continue }
      Say "Tuning Windows: $($t.label)"
      try {
        $why = & $t.apply
        if ($why) { $result.skipped += @{ label = $t.label; reason = "$why" } } else { $result.tuned += $t.label }
      } catch {
        $result.failed += @{ label = $t.label; error = $_.Exception.Message }
      }
      # Saved after every step so a crash part-way still leaves an undo record.
      Save-Backup
    }
  }

  $wanted = @($Groups.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $selected = @($AppGroups | Where-Object { $wanted -contains $_.id })
  if ($selected.Count -gt 0) {
    # Desktop uninstallers first: they take their own Store-side packages with them.
    foreach ($g in $selected) {
      foreach ($item in @(Find-GroupItems $g @())) {
        Say "Uninstalling $($item.label) (this one can take several minutes)"
        try { Remove-Win32Item $item; $result.removed += $item.label }
        catch { $result.failed += @{ label = $item.label; error = $_.Exception.Message } }
      }
    }

    $packages = Get-Packages
    foreach ($g in $selected) {
      foreach ($item in @(Find-GroupItems $g $packages | Where-Object { $_.kind -eq 'appx' })) {
        Say "Removing $($item.label)"
        try {
          foreach ($p in $item.packages) { Remove-AppxPackage -Package $p.PackageFullName -AllUsers }
          $result.removed += $item.label
        } catch {
          $result.failed += @{ label = $item.label; error = $_.Exception.Message }
        }
      }
    }

    # Also drop them from the Windows image, so they are not reinstalled for the
    # next Windows account or by a feature update.
    Say 'Stopping Windows from reinstalling the removed apps'
    try {
      $provisioned = @(Get-AppxProvisionedPackage -Online)
      foreach ($g in $selected) {
        foreach ($app in $g.apps) {
          foreach ($pp in @($provisioned | Where-Object { $_.DisplayName -like $app[0] })) {
            try { Remove-AppxProvisionedPackage -Online -PackageName $pp.PackageName | Out-Null } catch { }
          }
        }
      }
    } catch {
      $result.failed += @{ label = 'Windows image cleanup'; error = $_.Exception.Message }
    }
  }
  $result
}

function Invoke-Undo {
  $result = @{ restored = 0; failed = @() }
  Read-Backup
  foreach ($key in @($Backup.Keys)) {
    $v = $Backup[$key]
    $parts = $key.Split('|')
    try {
      if ($parts[0] -eq 'reg') {
        $path = $parts[1]; $name = $parts[2]
        if ($v.existed) {
          if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
          New-ItemProperty -Path $path -Name $name -PropertyType $v.kind -Value $v.value -Force | Out-Null
        } elseif (Test-Path $path) {
          Remove-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
        }
      } elseif ($parts[0] -eq 'svc') {
        if (Get-Service -Name $parts[1] -ErrorAction SilentlyContinue) {
          Set-Service -Name $parts[1] -StartupType "$v"
          if ("$v" -eq 'Automatic') { Start-Service -Name $parts[1] -ErrorAction SilentlyContinue }
        }
      } elseif ($parts[0] -eq 'overlay') {
        $target = 'OVERLAY_SCHEME_NONE'
        if ("$v" -and "$v" -notmatch '^[0-]+$') { $target = "$v" }
        Invoke-Powercfg /overlaysetactive $target | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "powercfg could not restore the power mode (exit $LASTEXITCODE)." }
      } elseif ($parts[0] -eq 'pwr') {
        Invoke-Powercfg /setacvalueindex SCHEME_CURRENT $parts[1] $parts[2] ([int]$v) | Out-Null
      } elseif ($parts[0] -eq 'pagefile') {
        if ($v.auto) {
          $cs = Get-CimInstance Win32_ComputerSystem
          Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }
        } else {
          Set-PagefileSize ([int]$v.initial) ([int]$v.max)
        }
      }
      $result.restored++
    } catch {
      $result.failed += @{ label = $key; error = $_.Exception.Message }
    }
  }
  Invoke-Powercfg /setactive SCHEME_CURRENT | Out-Null
  # Keep the record if anything could not be put back, so undo can be retried.
  if ($result.failed.Count -eq 0 -and (Test-Path $BackupFile)) { Remove-Item $BackupFile -Force }
  $result
}

if ($Mode -eq 'define') { return }

if ($Mode -eq 'status') {
  Get-Status | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

try {
  if (-not (Test-Elevated)) { throw 'This needs to run as an administrator.' }
  if ($Mode -eq 'apply') { $result = Invoke-Apply } else { $result = Invoke-Undo }
  if ($Out) { $result | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $Out -Encoding UTF8 }
  exit 0
} catch {
  if ($Out) { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -Path $Out -Encoding UTF8 }
  exit 1
}
