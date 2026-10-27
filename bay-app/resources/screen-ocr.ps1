# Tee24 Bay Kiosk screen reader.
# Persistent worker: reads one command per line on stdin, writes one JSON line per command on stdout.
#   scan            -> capture the primary screen, OCR it, emit { ok, w, h, ms, lines:[{text,x,y,w,h}] }
#   quit            -> exit
# Uses the Windows built-in OCR engine (Windows.Media.Ocr); no install needed.

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
# Capture physical pixels (the kiosk PCs run at 125-150% scaling).
Add-Type -Namespace Tee24 -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Tee24.Dpi]::SetProcessDPIAware()
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
$null = [System.WindowsRuntimeSystemExtensions]

# Helper to await WinRT IAsyncOperation<T> from PowerShell.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $resultType) {
  $m = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $m.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
if (-not $engine) { Write-Output '{"ok":false,"error":"no OCR engine"}'; exit 1 }
$maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
if ($maxDim -le 0) { $maxDim = 2600 }

function Capture-Screen {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList ([int]$b.Width), ([int]$b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $g.Dispose()
  return $bmp
}

function Ocr-Bitmap([System.Drawing.Bitmap]$bmp) {
  # Downscale if larger than the engine allows (rare: >  ~10k px).
  $scale = 1.0
  if ($bmp.Width -gt $maxDim -or $bmp.Height -gt $maxDim) {
    $scale = [Math]::Min($maxDim / $bmp.Width, $maxDim / $bmp.Height)
    $nb = New-Object System.Drawing.Bitmap $bmp, ([int]($bmp.Width * $scale)), ([int]($bmp.Height * $scale))
    $bmp.Dispose(); $bmp = $nb
  }
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $ms.Position = 0
  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $lines = New-Object System.Collections.ArrayList
  foreach ($l in $res.Lines) {
    $x1 = [double]::MaxValue; $y1 = [double]::MaxValue; $x2 = 0.0; $y2 = 0.0
    foreach ($w in $l.Words) {
      $r = $w.BoundingRect
      if ($r.X -lt $x1) { $x1 = $r.X }; if ($r.Y -lt $y1) { $y1 = $r.Y }
      if ($r.X + $r.Width -gt $x2) { $x2 = $r.X + $r.Width }; if ($r.Y + $r.Height -gt $y2) { $y2 = $r.Y + $r.Height }
    }
    # OCR occasionally emits control characters (e.g. BEL) that ConvertTo-Json
    # does not escape and JSON.parse rejects; strip them.
    $text = [regex]::Replace([string]$l.Text, '[\x00-\x1F\x7F]', '')
    [void]$lines.Add([ordered]@{ text = $text; x = [int]($x1 / $scale); y = [int]($y1 / $scale); w = [int](($x2 - $x1) / $scale); h = [int](($y2 - $y1) / $scale) })
  }
  $sb.Dispose(); $ms.Dispose()
  return ,$lines
}

Write-Output '{"ok":true,"ready":true}'
[Console]::Out.Flush()

while ($true) {
  $cmd = [Console]::In.ReadLine()
  if ($null -eq $cmd -or $cmd -eq 'quit') { break }
  if ($cmd -ne 'scan') { continue }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $bmp = Capture-Screen
    $w = $bmp.Width; $h = $bmp.Height
    $lines = Ocr-Bitmap $bmp
    $bmp.Dispose()
    $out = [ordered]@{ ok = $true; w = $w; h = $h; ms = $sw.ElapsedMilliseconds; lines = $lines }
    Write-Output (ConvertTo-Json $out -Compress -Depth 4)
  } catch {
    Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; error = $_.Exception.Message }) -Compress)
  }
  [Console]::Out.Flush()
}
