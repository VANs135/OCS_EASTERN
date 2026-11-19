function New-CaptureField($panel, [string]$caption, [string]$field) {
    $label = New-LocalText 13
    $label.Text = $caption
    $label.Margin = '0,4,0,4'
    [void]$panel.Children.Add($label)
    $combo = New-Object Windows.Controls.ComboBox
    $combo.Margin = '0,0,0,7'
    $combo.MinHeight = 28
    $combo.MaxDropDownHeight = 320
    $combo.Tag = @{ Field = $field; Key = $null }
    [Windows.Automation.AutomationProperties]::SetName($combo, $caption)
    $combo.Add_SelectionChanged({
        param($sender, $eventArgs)
        if ($script:localUpdating -or !$sender.SelectedItem) { return }
        $choice = $sender.SelectedItem.Tag
        if ($sender.Tag.Field -eq 'focus') {
            Invoke-LocalRequest @{ kind = 'capture-focus'; id = $choice }
        } else {
            Invoke-LocalRequest @{ kind = 'capture-edit'; id = $script:localView.capture.focus.id; field = $sender.Tag.Field; value = $choice }
        }
    })
    [void]$panel.Children.Add($combo)
    return @{ Label = $label; Combo = $combo }
}

function Set-CaptureField($field, $options, $selected) {
    $combo = $field.Combo
    $key = ($options | ForEach-Object { "$($_.Value)=$($_.Label)" }) -join [Environment]::NewLine
    if ($combo.Tag.Key -cne $key) {
        $combo.Tag.Key = $key
        $combo.Items.Clear()
        foreach ($option in $options) {
            $item = New-Object Windows.Controls.ComboBoxItem
            $item.Content = [string]$option.Label
            $item.Tag = $option.Value
            [void]$combo.Items.Add($item)
        }
    }
    $field.Label.Visibility = $combo.Visibility = if ($options.Count) { 'Visible' } else { 'Collapsed' }
    $combo.IsEnabled = $options.Count -gt 1
    $matching = $combo.Items | Where-Object { $null -ne $selected -and $_.Tag -ceq $selected } | Select-Object -First 1
    $combo.SelectedItem = $matching
}

function New-LocalCapturePanel {
    $panel = New-Object Windows.Controls.StackPanel
    $panel.Visibility = 'Collapsed'
    $title = New-LocalText 17
    $title.FontWeight = 'SemiBold'
    $title.Margin = '0,0,0,8'
    [void]$panel.Children.Add($title)
    $totals = New-LocalText 14
    $totals.Margin = '0,0,0,7'
    [void]$panel.Children.Add($totals)
    $picker = New-CaptureField $panel '处理哪枚算子' 'focus'
    $points = New-CaptureField $panel '被夺取的运输点数' 'takenPoints'
    $tokens = New-CaptureField $panel '被夺取的具象补给（T）' 'takenTokens'
    $destination = New-CaptureField $panel '位移落点' 'destination'
    $hint = New-LocalText 13
    $hint.Margin = '0,0,0,8'
    $hint.Foreground = [Windows.Media.Brushes]::DarkSlateGray
    [void]$panel.Children.Add($hint)
    $submit = New-LocalButton '确认夺取分配和位移'
    $submit.HorizontalAlignment = 'Left'
    $submit.Add_Click({ Invoke-LocalRequest @{ kind = 'capture-confirm' } })
    [void]$panel.Children.Add($submit)
    $script:captureUi = @{
        Panel = $panel; Title = $title; Totals = $totals; Picker = $picker; Points = $points; Tokens = $tokens
        Destination = $destination; Hint = $hint; Submit = $submit
    }
    return $panel
}

function Update-LocalCapturePanel($capture) {
    $ui = $script:captureUi
    $ui.Panel.Visibility = if ($capture) { 'Visible' } else { 'Collapsed' }
    if (!$capture) { return }
    $ui.Title.Text = "$($capture.hex) · 夺取应答"
    $lines = foreach ($group in $capture.groups) {
        $name = if ($group.kind -eq 'trucks') { '卡车' } else { '马车' }
        "$name（骰点 $($group.die)）已分配 $($group.assignedPoints)/$($group.points) 点、$($group.assignedTokens)/$($group.tokens)T"
    }
    $ui.Totals.Text = $lines -join [Environment]::NewLine
    $ui.Totals.Visibility = if ($lines) { 'Visible' } else { 'Collapsed' }
    $ui.Totals.Foreground = if ($capture.groups | Where-Object { $_.assignedPoints -gt $_.points -or $_.assignedTokens -gt $_.tokens }) {
        [Windows.Media.Brushes]::DarkRed
    } else { [Windows.Media.Brushes]::Black }
    $focus = $capture.focus
    $choices = foreach ($row in $capture.rows) {
        $suffix = if ($row.complete) { '已填写' } else { '待填写' }
        @{ Value = $row.id; Label = "$($row.label) · $suffix" }
    }
    Set-CaptureField $ui.Picker @($choices) $focus.id
    $points = @($focus.pointValues | Where-Object { $null -ne $_ } | ForEach-Object { @{ Value = $_; Label = "$_ / $($focus.points) 点" } })
    Set-CaptureField $ui.Points $points $focus.takenPoints
    $tokens = @($focus.tokenValues | Where-Object { $null -ne $_ } | ForEach-Object { @{ Value = $_; Label = "$_ / $($focus.tokens)T" } })
    Set-CaptureField $ui.Tokens $tokens $focus.takenTokens
    $destinations = @($focus.destinations | ForEach-Object {
        @{ Value = $_; Label = if ($_ -eq 'air-box') { '本方地图外空军盒' } else { $_ } }
    })
    Set-CaptureField $ui.Destination $destinations $focus.destination
    $ui.Hint.Text = if ($destinations.Count) { '也可左键点击地图上标出的可选落点。' } else { '' }
    $ui.Hint.Visibility = if ($destinations.Count) { 'Visible' } else { 'Collapsed' }
    $ui.Submit.IsEnabled = $capture.ready
}

function Select-CaptureSmokeValue($field, $value) {
    $choice = $field.Combo.Items | Where-Object { $_.Tag -ceq $value } | Select-Object -First 1
    if (!$choice) { throw "夺取面板缺少选项 $value" }
    $field.Combo.SelectedItem = $choice
}

function Test-LocalCaptureWindow($dock) {
    $ui = $script:captureUi
    if ($ui.Panel.Visibility -ne 'Visible' -or $ui.Submit.IsEnabled) { throw '夺取面板初始状态错误。' }
    $aircraft = @($script:localView.capture.rows | Where-Object { $_.kind -eq 'aircraft' })
    Select-CaptureSmokeValue $ui.Picker 'capture-smoke:large'
    Select-CaptureSmokeValue $ui.Points 0
    Select-CaptureSmokeValue $ui.Destination 's13.12'
    Select-CaptureSmokeValue $ui.Picker 'capture-smoke:loaded'
    Select-CaptureSmokeValue $ui.Points 1
    Select-CaptureSmokeValue $ui.Tokens 1
    Select-CaptureSmokeValue $ui.Destination 's13.12'
    Select-CaptureSmokeValue $ui.Picker $aircraft[0].id
    Select-CaptureSmokeValue $ui.Destination 's18.07'
    Select-CaptureSmokeValue $ui.Picker $aircraft[1].id
    if ($script:localView.frame.captureAirBox -ne 20) { throw '未标出轴心地图外空军盒。' }
    Invoke-LocalRequest @{ kind = 'board-left'; cell = 20 }
    if (!$ui.Submit.IsEnabled) { throw '夺取分配无误时未能提交。' }
    if ($LocalSmokeImage) {
        Select-CaptureSmokeValue $ui.Picker 'capture-smoke:loaded'
        Write-DesktopPng $dock 1460 920 $LocalSmokeImage
    }
    $before = $script:localView.revision
    $ui.Submit.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
    if ($script:localView.capture -or $script:localView.revision -ne ($before + 1)) { throw $script:localStatus.Text }
}
