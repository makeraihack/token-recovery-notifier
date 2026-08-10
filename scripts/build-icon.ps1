# Chroma-keys the pure-green background out of the ChatGPT-generated icon source,
# then packs it into a multi-resolution .ico for the tray icon (Windows supports
# PNG-compressed frames inside .ico since Vista, so no external tools are needed).
param(
    [string]$SourcePng = (Join-Path $PSScriptRoot "..\mockups\icon-source.png"),
    [string]$TransparentPreviewPng = (Join-Path $PSScriptRoot "..\mockups\icon-transparent.png"),
    [string]$OutputIco = (Join-Path $PSScriptRoot "..\src\tray\icon.ico")
)

Add-Type -AssemblyName System.Drawing

function Remove-GreenScreen([System.Drawing.Bitmap]$bitmap) {
    $w = $bitmap.Width
    $h = $bitmap.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bytes = New-Object byte[] ($data.Stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $i = $y * $data.Stride + $x * 4
            $b = $bytes[$i]
            $g = $bytes[$i + 1]
            $r = $bytes[$i + 2]
            # Pure chroma-key green is roughly (0-90, 200-255, 0-90); flag anything close to that
            if ($g -gt 170 -and $r -lt 120 -and $b -lt 120 -and ($g - $r) -gt 60 -and ($g - $b) -gt 60) {
                $bytes[$i + 3] = 0
            }
        }
    }

    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    $bitmap.UnlockBits($data)
}

function Get-ResizedPngBytes([System.Drawing.Bitmap]$source, [int]$size) {
    $resized = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($resized)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($source, 0, 0, $size, $size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $resized.Dispose()
    return $ms.ToArray()
}

function Write-IcoFile([string]$path, [int[]]$sizes, [System.Drawing.Bitmap]$source) {
    $images = @()
    foreach ($size in $sizes) {
        $images += , (Get-ResizedPngBytes -source $source -size $size)
    }

    $stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Create)
    $writer = New-Object System.IO.BinaryWriter($stream)

    # ICONDIR
    $writer.Write([UInt16]0)          # reserved
    $writer.Write([UInt16]1)          # type = icon
    $writer.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($n = 0; $n -lt $sizes.Count; $n++) {
        $size = $sizes[$n]
        $pngBytes = $images[$n]
        $dim = if ($size -ge 256) { 0 } else { $size } # 0 means 256 in ICO format
        $writer.Write([Byte]$dim)      # width
        $writer.Write([Byte]$dim)      # height
        $writer.Write([Byte]0)         # color count (0 = no palette)
        $writer.Write([Byte]0)         # reserved
        $writer.Write([UInt16]1)       # color planes
        $writer.Write([UInt16]32)      # bits per pixel
        $writer.Write([UInt32]$pngBytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $pngBytes.Length
    }

    foreach ($pngBytes in $images) {
        $writer.Write([byte[]]$pngBytes)
    }

    $writer.Flush()
    $writer.Close()
    $stream.Close()
}

$source = [System.Drawing.Bitmap]::FromFile((Resolve-Path $SourcePng))
Remove-GreenScreen -bitmap $source
$source.Save((Resolve-Path (Split-Path $TransparentPreviewPng -Parent)).Path + "\icon-transparent.png", [System.Drawing.Imaging.ImageFormat]::Png)

$outDir = Split-Path $OutputIco -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
Write-IcoFile -path $OutputIco -sizes @(16, 32, 48, 256) -source $source

$source.Dispose()
Write-Output "Wrote transparent preview and $OutputIco"
