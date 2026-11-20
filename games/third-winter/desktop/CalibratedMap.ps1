param(
    [Parameter(Mandatory = $true)][string]$ModelPath,
    [string]$RenderTo,
    [int]$RenderFrame = -1,
    [switch]$RenderAid,
    [switch]$Local,
    [switch]$LocalSmoke,
    [string]$LocalSmokeImage
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

function Write-DesktopPng($surface, [int]$width, [int]$height, [string]$path) {
    $surface.Measure((New-Object Windows.Size($width, $height)))
    $surface.Arrange((New-Object Windows.Rect(0, 0, $width, $height)))
    $surface.UpdateLayout()
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap($width, $height, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($surface)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $output = [IO.File]::Create($path)
    try { $encoder.Save($output) } finally { $output.Dispose() }
}

function Add-Counter($counter, [double]$x, [double]$y, [double]$size, $surface = $script:canvas, $cell = $null) {
    $image = New-Object Windows.Controls.Image
    $image.Source = Get-Art (Join-Path $model.imageDirectory $counter.asset)
    $image.Width = $size
    $image.Height = $size
    $label = $counter.label
    if ($counter.badges.Count) {
        $label += [Environment]::NewLine + ($counter.badges.label -join ' / ')
    }
    $image.ToolTip = $label
    [Windows.Automation.AutomationProperties]::SetName($image, $counter.label)
    Add-At $image $x $y $surface
    if ($Local) {
        $onAid = $surface -eq $script:aidCanvas
        $image.Tag = if ($onAid) { @{ AidCounterId = [string]$counter.id } } else {
            @{ UnitId = [string]$counter.id; Cell = $cell }
        }
        Register-LocalMapClicks $image
        if ($onAid -or $script:localRoster.ContainsKey([string]$counter.id)) { $image.Cursor = [Windows.Input.Cursors]::Hand }
        $selected = if ($onAid) { $script:localView.frame.selectedAidCounter -eq $counter.id } else {
            $script:localView.frame.selectedUnits -contains $counter.id
        }
        if ($selected) {
            $outline = New-Object Windows.Controls.Border
            $outline.Width = $size
            $outline.Height = $size
            $outline.BorderThickness = 3
            $outline.BorderBrush = [Windows.Media.Brushes]::DeepSkyBlue
            $outline.IsHitTestVisible = $false
            Add-At $outline $x $y $surface
        }
    }
    $badgeSize = $size * 0.30
    for ($index = 0; $index -lt $counter.badges.Count; $index++) {
        $badge = $counter.badges[$index]
        if ($badge.asset) {
            $visual = New-Object Windows.Controls.Image
            $visual.Source = Get-Art (Join-Path $model.imageDirectory $badge.asset)
        } else {
            $visual = New-Object Windows.Controls.Border
            $visual.Background = [Windows.Media.Brushes]::DarkSlateGray
            $value = New-Object Windows.Controls.TextBlock
            $value.Text = $badge.text
            $value.Foreground = [Windows.Media.Brushes]::White
            $value.FontFamily = 'Microsoft YaHei UI'
            $value.FontSize = $badgeSize * 0.69
            $value.HorizontalAlignment = 'Center'
            $value.VerticalAlignment = 'Center'
            $visual.Child = $value
        }
        $visual.Width = $badgeSize
        $visual.Height = $badgeSize
        $visual.IsHitTestVisible = $false
        $badgeX = $x + $size - 1 - (($index % 3) + 1) * $badgeSize
        $badgeY = $y + 1 + [Math]::Floor($index / 3) * $badgeSize
        Add-At $visual $badgeX $badgeY $surface
    }
}

function Show-MapStack($layer) {
    $layer.Children.Clear()
    $stack = $layer.Tag.Stack
    $page = $layer.Tag.Page
    foreach ($counter in $stack.pages[$page]) {
        Add-Counter $counter (62 + $counter.x - $counter.size / 2) (54 + $counter.y - $counter.size / 2) $counter.size $layer
    }
    if ($stack.pages.Count -gt 1) {
        $button = New-Object Windows.Controls.Button
        $button.Content = "$($page + 1)/$($stack.pages.Count)"
        $button.Width = 31
        $button.Height = 15
        $button.FontSize = 11
        $button.Padding = 0
        $button.Tag = $layer
        $button.ToolTip = "$($stack.hex) · $($model.labels.cycle)"
        $button.Add_Click({
            param($sender, $eventArgs)
            $stackLayer = $sender.Tag
            $stackLayer.Tag.Page = ($stackLayer.Tag.Page + 1) % $stackLayer.Tag.Stack.pages.Count
            Show-MapStack $stackLayer
        })
        if ($stack.scale -lt 1) {
            $button.Width = 21
            $button.FontSize = 9
            Add-At $button (62 + 38 * $stack.scale) 46.5 $layer
        } else {
            Add-At $button 46.5 92 $layer
        }
    }
}

function Show-Frame([int]$index) {
    $script:canvas.Children.Clear()
    $frame = $model.frames[$index]
    $background = New-Object Windows.Controls.Image
    $background.Source = Get-Art $model.map
    $background.Width = $model.width
    $background.Height = $model.height
    Add-At $background 0 0
    if ($Local) { Add-LocalRoute $frame }

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
        if ($Local) {
            $region.Tag = @{ Cell = $entry.cell }
            Register-LocalMapClicks $region
        }
        Add-At $region $box.x $box.y

        $count = $entry.counters.Count
        if ($count -eq 0) { continue }
        $columns = [Math]::Ceiling([Math]::Sqrt($count * $box.w / ($box.h - 82)))
        $rows = [Math]::Ceiling($count / $columns)
        $size = [Math]::Min(68, [Math]::Min(($box.w - 24) / $columns, ($box.h - 94) / $rows) - 6)
        for ($n = 0; $n -lt $count; $n++) {
            $x = $box.x + 14 + ($n % $columns) * ($size + 6)
            $y = $box.y + 82 + [Math]::Floor($n / $columns) * ($size + 6)
            Add-Counter $entry.counters[$n] $x $y $size $script:canvas $entry.cell
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
    foreach ($stack in $frame.mapStacks) {
        $layer = New-Object Windows.Controls.Canvas
        $layer.Width = 124
        $layer.Height = 108
        $layer.Tag = @{ Stack = $stack; Page = 0 }
        Show-MapStack $layer
        Add-At $layer ($stack.x - 62) ($stack.y - 54)
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
    if ($script:rerollArt) {
        if ($frame.reroll) {
            $script:rerollArt.Source = Get-Art (Join-Path $model.imageDirectory $frame.reroll.asset)
            $script:rerollLabel.Text = $frame.reroll.label
            $script:rerollArt.Visibility = 'Visible'
            $script:rerollLabel.Visibility = 'Visible'
        } else {
            $script:rerollArt.Visibility = 'Collapsed'
            $script:rerollLabel.Visibility = 'Collapsed'
        }
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
    Write-DesktopPng $surface $surface.Width $surface.Height $RenderTo
    exit
}

if ($Local) {
    . (Join-Path $PSScriptRoot 'ScorpionLocalPanel.ps1')
    Show-LocalScorpion
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
$script:rerollArt = New-Object Windows.Controls.Image
$rerollArt.Width = 30
$rerollArt.Height = 30
$rerollArt.Margin = '24,0,7,0'
[void]$bar.Children.Add($rerollArt)
$script:rerollLabel = New-Object Windows.Controls.TextBlock
$rerollLabel.VerticalAlignment = 'Center'
[void]$bar.Children.Add($rerollLabel)
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
