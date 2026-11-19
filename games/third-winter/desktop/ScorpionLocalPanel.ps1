function New-LocalButton([string]$text) {
    $control = New-Object Windows.Controls.Button
    $control.Content = $text
    $control.Padding = '12,6,12,6'
    $control.Margin = '0,0,6,6'
    return $control
}

function New-LocalText([double]$size) {
    $control = New-Object Windows.Controls.TextBlock
    $control.FontSize = $size
    $control.TextWrapping = 'Wrap'
    return $control
}

function Add-LocalRoute($frame) {
    if ($frame.selectedHex) {
        $center = $frame.selectedHex
        $ring = New-Object Windows.Shapes.Ellipse
        $ring.Width = 94 * $center.scale
        $ring.Height = 88 * $center.scale
        $ring.Stroke = [Windows.Media.Brushes]::DeepSkyBlue
        $ring.StrokeThickness = 5
        $ring.IsHitTestVisible = $false
        Add-At $ring ($center.x - $ring.Width / 2) ($center.y - $ring.Height / 2)
    }
    if ($frame.route.Count -gt 1) {
        $line = New-Object Windows.Shapes.Polyline
        $line.Stroke = [Windows.Media.Brushes]::DeepSkyBlue
        $line.StrokeThickness = 7
        $line.IsHitTestVisible = $false
        foreach ($point in $frame.route) {
            $line.Points.Add((New-Object Windows.Point($point.x, $point.y)))
        }
        Add-At $line 0 0
    }
}

function Invoke-LocalRequest($request) {
    try {
        $request.revision = $script:localView.revision
        [Console]::WriteLine(($request | ConvertTo-Json -Depth 36 -Compress))
        $line = [Console]::ReadLine()
        if (!$line) { throw '本机对局进程已关闭。' }
        $reply = $line | ConvertFrom-Json
        if (!$reply.ok) {
            $script:localStatus.Foreground = [Windows.Media.Brushes]::DarkRed
            $script:localStatus.Text = "操作未提交。$($reply.error)"
            return
        }
        Update-LocalView $reply.view
    } catch {
        $script:localStatus.Foreground = [Windows.Media.Brushes]::DarkRed
        $script:localStatus.Text = $_.Exception.Message
    }
}

function Update-LocalView($view) {
    $script:localUpdating = $true
    try {
        $script:localView = $view
        $script:localRoster = @{}
        $script:localHeading.Text = $view.headline
        $script:localStatus.Text = "已自动保存 · 第 $($view.revision) 条记录"
        $script:localStatus.Foreground = [Windows.Media.Brushes]::DarkSlateGray
        $script:localStatus.ToolTip = $model.local.savePath
        $script:localSelected.Text = if ($view.route.Count) { '路线  ' + ($view.route -join ' → ') } elseif ($view.hex) { "选中格  $($view.hex)" } else { '在地图上点击格子或算子' }
        $script:localClear.IsEnabled = [bool]$view.hex
        $script:localUnitBox.Items.Clear()
        foreach ($unit in $view.roster) {
            $script:localRoster[[string]$unit.id] = $unit
            $entry = New-Object Windows.Controls.ComboBoxItem
            $entry.Content = $unit.label
            $entry.Tag = $unit.id
            [void]$script:localUnitBox.Items.Add($entry)
            if ($unit.id -eq $view.unitId) { $script:localUnitBox.SelectedItem = $entry }
        }
        $script:localUnitBox.IsEnabled = $script:localUnitBox.Items.Count -gt 0
        $script:localButtons.Children.Clear()
        foreach ($item in $view.actions) {
            $button = New-LocalButton $item.label
            $button.Margin = '0,0,0,6'
            $button.HorizontalContentAlignment = 'Left'
            $text = New-LocalText 14
            $text.Text = $item.label
            $button.Content = $text
            $button.Tag = $item.key
            $button.Add_Click({ param($sender, $args) Invoke-LocalRequest @{ kind = 'apply'; key = $sender.Tag } })
            [void]$script:localButtons.Children.Add($button)
        }
        if (!$view.actions.Count -and !$view.ended) {
            $text = New-LocalText 14
            $text.Text = '请选择算子或目标格。需要填写多项分配时，可使用高级规则命令。'
            [void]$script:localButtons.Children.Add($text)
        }
        $script:localAdvanced.IsEnabled = !$view.ended
        $model.frames = @($view.frame)
        Show-Frame 0
    } finally { $script:localUpdating = $false }
}

function Set-LocalZoom([double]$scale) {
    foreach ($surface in @($script:canvas, $script:aidCanvas)) {
        if ($surface) { $surface.LayoutTransform = New-Object Windows.Media.ScaleTransform($scale, $scale) }
    }
    $script:localZoomLabel.Text = ('{0:P0}' -f $scale)
}

function Show-LocalScorpion {
    [Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    $window = New-Object Windows.Window
    $window.Title = $model.labels.title + ' · 本地对局'
    $window.Width = 1460
    $window.Height = 920
    $window.MinWidth = 860
    $window.MinHeight = 560
    $window.WindowStartupLocation = 'CenterScreen'
    $window.FontFamily = 'Microsoft YaHei UI'
    $window.FontSize = 14
    $window.Background = [Windows.Media.Brushes]::White
    $dock = New-Object Windows.Controls.DockPanel
    $dock.Background = [Windows.Media.Brushes]::White
    $bar = New-Object Windows.Controls.StackPanel
    $bar.Orientation = 'Horizontal'
    $bar.Margin = '12,10,12,5'
    $script:localHeading = New-LocalText 20
    $script:localHeading.MinWidth = 204
    $script:localHeading.FontWeight = 'SemiBold'
    $script:localHeading.VerticalAlignment = 'Center'
    [void]$bar.Children.Add($script:localHeading)
    $fit = New-LocalButton '适合窗口'
    [void]$bar.Children.Add($fit)
    $script:localZoom = New-Object Windows.Controls.Slider
    $script:localZoom.Minimum = 0.15
    $script:localZoom.Maximum = 1.6
    $script:localZoom.Width = 142
    $script:localZoom.Value = 0.34
    $script:localZoom.VerticalAlignment = 'Center'
    [void]$bar.Children.Add($script:localZoom)
    $script:localZoomLabel = New-LocalText 13
    $script:localZoomLabel.Margin = '10,0,8,0'
    $script:localZoomLabel.VerticalAlignment = 'Center'
    [void]$bar.Children.Add($script:localZoomLabel)
    $script:rerollArt = New-Object Windows.Controls.Image
    $script:rerollArt.Width = 30
    $script:rerollArt.Height = 30
    $script:rerollArt.Margin = '12,0,6,0'
    [void]$bar.Children.Add($script:rerollArt)
    $script:rerollLabel = New-LocalText 14
    $script:rerollLabel.VerticalAlignment = 'Center'
    [void]$bar.Children.Add($script:rerollLabel)
    [Windows.Controls.DockPanel]::SetDock($bar, 'Top')
    [void]$dock.Children.Add($bar)

    $panel = New-Object Windows.Controls.DockPanel
    $panel.Width = 346
    $panel.Margin = '10,3,12,8'
    [Windows.Controls.DockPanel]::SetDock($panel, 'Right')
    [void]$dock.Children.Add($panel)
    $header = New-Object Windows.Controls.StackPanel
    [Windows.Controls.DockPanel]::SetDock($header, 'Top')
    [void]$panel.Children.Add($header)
    $unitLabel = New-LocalText 15
    $unitLabel.FontWeight = 'SemiBold'
    $unitLabel.Text = '当前一方的算子'
    [void]$header.Children.Add($unitLabel)
    $script:localUnitBox = New-Object Windows.Controls.ComboBox
    $script:localUnitBox.Margin = '0,6,0,8'
    $script:localUnitBox.MinHeight = 31
    [void]$header.Children.Add($script:localUnitBox)
    $script:localUnitBox.Add_SelectionChanged({
        if (!$script:localUpdating -and $script:localUnitBox.SelectedItem) {
            Invoke-LocalRequest @{ kind = 'select-unit'; unitId = $script:localUnitBox.SelectedItem.Tag }
        }
    })
    $script:localSelected = New-LocalText 14
    $script:localSelected.Margin = '0,0,0,6'
    [void]$header.Children.Add($script:localSelected)
    $script:localClear = New-LocalButton '清除目标和路线'
    $script:localClear.HorizontalAlignment = 'Left'
    $script:localClear.Add_Click({ Invoke-LocalRequest @{ kind = 'clear-route' } })
    [void]$header.Children.Add($script:localClear)

    $footer = New-Object Windows.Controls.StackPanel
    $footer.Margin = '0,8,0,0'
    [Windows.Controls.DockPanel]::SetDock($footer, 'Bottom')
    [void]$panel.Children.Add($footer)
    $script:localStatus = New-LocalText 13
    $script:localStatus.Margin = '0,4,0,5'
    [void]$footer.Children.Add($script:localStatus)
    $script:localAdvanced = New-Object Windows.Controls.Expander
    $script:localAdvanced.Header = '高级规则命令'
    [void]$footer.Children.Add($script:localAdvanced)
    $advancedStack = New-Object Windows.Controls.StackPanel
    $advancedStack.Margin = '0,6,0,0'
    $script:localAdvanced.Content = $advancedStack
    $advancedNote = New-LocalText 12
    $advancedNote.Text = '仅供已有规则命令的玩家。输入本阶段的动作 JSON。'
    [void]$advancedStack.Children.Add($advancedNote)
    $script:localCommand = New-Object Windows.Controls.TextBox
    $script:localCommand.AcceptsReturn = $true
    $script:localCommand.TextWrapping = 'Wrap'
    $script:localCommand.Height = 74
    $script:localCommand.Margin = '0,5,0,5'
    [void]$advancedStack.Children.Add($script:localCommand)
    $send = New-LocalButton '提交规则命令'
    [void]$advancedStack.Children.Add($send)
    $send.Add_Click({
        try {
            $action = $script:localCommand.Text | ConvertFrom-Json
            Invoke-LocalRequest @{ kind = 'command'; action = $action }
        } catch { $script:localStatus.Text = '无法读取动作 JSON。' }
    })

    $actionsScroll = New-Object Windows.Controls.ScrollViewer
    $actionsScroll.VerticalScrollBarVisibility = 'Auto'
    $script:localButtons = New-Object Windows.Controls.StackPanel
    $actionsScroll.Content = $script:localButtons
    [void]$panel.Children.Add($actionsScroll)

    $script:localTabs = New-Object Windows.Controls.TabControl
    foreach ($item in @(@{ Header = $model.labels.map; Surface = $script:canvas }, @{ Header = $model.labels.aid; Surface = $script:aidCanvas })) {
        if (!$item.Surface) { continue }
        $scroll = New-Object Windows.Controls.ScrollViewer
        $scroll.HorizontalScrollBarVisibility = 'Auto'
        $scroll.VerticalScrollBarVisibility = 'Auto'
        $scroll.Background = [Windows.Media.Brushes]::Gainsboro
        $scroll.Content = $item.Surface
        $tab = New-Object Windows.Controls.TabItem
        $tab.Header = $item.Header
        $tab.Content = $scroll
        [void]$script:localTabs.Items.Add($tab)
    }
    [void]$dock.Children.Add($script:localTabs)
    $window.Content = $dock
    $script:canvas.Add_MouseLeftButtonDown({
        param($sender, $args)
        $point = $args.GetPosition($script:canvas)
        Invoke-LocalRequest @{ kind = 'select-hex'; x = $point.X; y = $point.Y }
    })
    $script:localZoom.Add_ValueChanged({ Set-LocalZoom $script:localZoom.Value })
    $fit.Add_Click({
        $content = $script:localTabs.SelectedItem.Content
        $surface = $content.Content
        $scale = [Math]::Min(($content.ActualWidth - 8) / $surface.Width, ($content.ActualHeight - 8) / $surface.Height)
        if ($scale -gt 0) { $script:localZoom.Value = $scale }
    })
    Set-LocalZoom $script:localZoom.Value
    Update-LocalView $model.local
    if ($LocalSmoke) {
        if (!$script:localButtons.Children.Count -or !$script:localUnitBox.Items.Count) { throw 'Local deployment controls are missing' }
        $before = $script:localView.revision
        $visibleSize = New-Object Windows.Size(1460, 920)
        $dock.Measure($visibleSize)
        $dock.Arrange((New-Object Windows.Rect(0, 0, 1460, 920)))
        $script:localButtons.Children[0].RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
        if ($script:localView.revision -le $before) { throw $script:localStatus.Text }
        if ($LocalSmokeImage) { Write-DesktopPng $dock 1460 920 $LocalSmokeImage }
        return
    }
    $window.Add_ContentRendered({
        if (!$script:localShown) {
            $script:localShown = $true
            Invoke-LocalRequest @{ kind = 'ready' }
        }
    })
    [void]$window.ShowDialog()
}
