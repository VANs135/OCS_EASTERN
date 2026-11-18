param(
    [Parameter(Mandatory = $true)][string]$ModelPath,
    [string]$RenderTo,
    [int]$RenderFrame = -1,
    [switch]$RenderAid
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
$model = Get-Content -LiteralPath $ModelPath -Raw -Encoding UTF8 | ConvertFrom-Json
$boxes = @{}
foreach ($box in $model.boxes) { $boxes[[int]$box.id] = $box }
$images = @{}

function Get-Art([string]$path) {
    if (!$images.ContainsKey($path)) {
        $source = New-Object Windows.Media.Imaging.BitmapImage
        $source.BeginInit()
        $source.CacheOption = 'OnLoad'
        $source.UriSource = New-Object System.Uri($path)
        $source.EndInit()
        $source.Freeze()
        $images[$path] = $source
    }
    return $images[$path]
}

function Add-At($visual, [double]$x, [double]$y, $surface = $script:canvas) {
    [Windows.Controls.Canvas]::SetLeft($visual, $x)
    [Windows.Controls.Canvas]::SetTop($visual, $y)
    [void]$surface.Children.Add($visual)
}

function Add-Counter($counter, [double]$x, [double]$y, [double]$size, $surface = $script:canvas) {
    $image = New-Object Windows.Controls.Image
    $image.Source = Get-Art (Join-Path $model.imageDirectory $counter.asset)
    $image.Width = $size
    $image.Height = $size
    $image.ToolTip = $counter.label
    [Windows.Automation.AutomationProperties]::SetName($image, $counter.label)
    Add-At $image $x $y $surface
}

function Show-Frame([int]$index) {
    $script:canvas.Children.Clear()
    $frame = $model.frames[$index]
    $background = New-Object Windows.Controls.Image
    $background.Source = Get-Art $model.map
    $background.Width = $model.width
    $background.Height = $model.height
    Add-At $background 0 0

    foreach ($entry in $frame.inventories) {
        $box = $boxes[[int]$entry.cell]
        $region = New-Object Windows.Controls.Border
        $region.Width = $box.w
        $region.Height = $box.h
        $region.Background = [Windows.Media.Brushes]::Transparent
        $contents = if ($entry.hidden) { $model.labels.hidden } elseif ($entry.counters.Count) {
            $entry.counters.label -join [Environment]::NewLine
        } else { $model.labels.empty }
        $region.ToolTip = $entry.label + [Environment]::NewLine + $contents
        Add-At $region $box.x $box.y

        $count = $entry.counters.Count
        if ($count -eq 0) { continue }
        $columns = [Math]::Ceiling([Math]::Sqrt($count * $box.w / ($box.h - 82)))
        $rows = [Math]::Ceiling($count / $columns)
        $size = [Math]::Min(68, [Math]::Min(($box.w - 24) / $columns, ($box.h - 94) / $rows) - 6)
        for ($n = 0; $n -lt $count; $n++) {
            $x = $box.x + 14 + ($n % $columns) * ($size + 6)
            $y = $box.y + 82 + [Math]::Floor($n / $columns) * ($size + 6)
            Add-Counter $entry.counters[$n] $x $y $size
        }
    }

    foreach ($marker in $frame.trackers) {
        $box = $boxes[[int]$marker.cell]
        $selection = New-Object Windows.Controls.Border
        $selection.Width = $box.w - 7
        $selection.Height = $box.h - 7
        $selection.BorderBrush = [Windows.Media.Brushes]::DarkGoldenrod
        $selection.BorderThickness = 5
        $selection.Background = [Windows.Media.Brushes]::Transparent
        $selection.ToolTip = $marker.label
        Add-At $selection ($box.x + 3) ($box.y + 3)
        $size = if ($marker.id -eq 'ground') { 36 } else { 34 }
        $y = if ($marker.id -eq 'vp') { $box.y + 7 } else { $box.y + $box.h - $size - 7 }
        Add-Counter $marker ($box.x + $box.w - $size - 7) $y $size
    }
    foreach ($marker in $frame.mapCounters) {
        Add-Counter $marker ($marker.x - $marker.size / 2) ($marker.y - $marker.size / 2) $marker.size
    }
    if ($script:aidCanvas) {
        $script:aidCanvas.Children.Clear()
        $aidImage = New-Object Windows.Controls.Image
        $aidImage.Source = Get-Art $model.aid.path
        $aidImage.Width = $model.aid.width
        $aidImage.Height = $model.aid.height
        Add-At $aidImage 0 0 $script:aidCanvas
        foreach ($marker in $frame.aidCounters) {
            Add-Counter $marker ($marker.x - $marker.size / 2) ($marker.y - $marker.size / 2) $marker.size $script:aidCanvas
        }
    }
    if ($script:caption) {
        $script:caption.Text = $frame.caption
        $script:previous.IsEnabled = $index -gt 0
        $script:next.IsEnabled = $index -lt ($model.frames.Count - 1)
    }
}

$script:canvas = New-Object Windows.Controls.Canvas
$canvas.Width = $model.width
$canvas.Height = $model.height
$canvas.ClipToBounds = $true
if ($model.aid) {
    $script:aidCanvas = New-Object Windows.Controls.Canvas
    $script:aidCanvas.Width = $model.aid.width
    $script:aidCanvas.Height = $model.aid.height
    $script:aidCanvas.ClipToBounds = $true
}

if ($RenderTo) {
    if ($RenderFrame -lt 0) { $RenderFrame = $model.frames.Count - 1 }
    Show-Frame $RenderFrame
    $surface = if ($RenderAid) { $script:aidCanvas } else { $script:canvas }
    $size = New-Object Windows.Size($surface.Width, $surface.Height)
    $surface.Measure($size)
    $surface.Arrange((New-Object Windows.Rect(0, 0, $surface.Width, $surface.Height)))
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap($surface.Width, $surface.Height, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($surface)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $output = [IO.File]::Create($RenderTo)
    try { $encoder.Save($output) } finally { $output.Dispose() }
    exit
}

$window = New-Object Windows.Window
$window.Title = $model.labels.title
$window.Width = 1470
$window.Height = 970
$window.MinWidth = 780
$window.MinHeight = 550
$window.WindowStartupLocation = 'CenterScreen'
$window.Background = [Windows.Media.Brushes]::White
$window.FontFamily = 'Microsoft YaHei UI'
$stack = New-Object Windows.Controls.DockPanel
$bar = New-Object Windows.Controls.StackPanel
$bar.Orientation = 'Horizontal'
$bar.Margin = '12,8,12,8'
$script:previous = New-Object Windows.Controls.Button
$script:next = New-Object Windows.Controls.Button
$script:caption = New-Object Windows.Controls.TextBlock
$script:index = 0
$previous.Content = $model.labels.previous
$next.Content = $model.labels.next
foreach ($button in @($previous, $next)) {
    $button.Padding = '14,5,14,5'
    $button.Margin = '0,0,8,0'
    [void]$bar.Children.Add($button)
}
$caption.VerticalAlignment = 'Center'
[void]$bar.Children.Add($caption)
$previous.Add_Click({ $script:index--; Show-Frame $script:index })
$next.Add_Click({ $script:index++; Show-Frame $script:index })
[Windows.Controls.DockPanel]::SetDock($bar, 'Top')
[void]$stack.Children.Add($bar)
$tabs = New-Object Windows.Controls.TabControl
foreach ($tab in @(@{ Header = $model.labels.map; Surface = $canvas }, @{ Header = $model.labels.aid; Surface = $script:aidCanvas })) {
    if (!$tab.Surface) { continue }
    $viewbox = New-Object Windows.Controls.Viewbox
    $viewbox.Child = $tab.Surface
    $item = New-Object Windows.Controls.TabItem
    $item.Header = $tab.Header
    $item.Content = $viewbox
    [void]$tabs.Items.Add($item)
}
[void]$stack.Children.Add($tabs)
$window.Content = $stack
Show-Frame 0
[void]$window.ShowDialog()
