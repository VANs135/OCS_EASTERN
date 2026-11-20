function Test-LocalWindowReplay($dock, [string]$path) {
    $size = New-Object Windows.Size(1460, 920)
    $dock.Measure($size)
    $dock.Arrange((New-Object Windows.Rect(0, 0, 1460, 920)))
    $steps = (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json).steps
    $context = $null
    for ($i = 0; $i -lt $steps.Count; $i++) {
        $step = $steps[$i]
        switch ($step.kind) {
            'select-unit' {
                $item = $script:localUnitBox.Items | Where-Object { $_.Tag -eq $step.unitId } | Select-Object -First 1
                if (!$item) { throw "Missing roster control at step $($i + 1): $($step.unitId)" }
                $script:localUnitBox.SelectedItem = $item
                if ($script:localView.unitId -ne $step.unitId) { throw "Roster did not select the requested counter at step $($i + 1)" }
                break
            }
            'board-left' {
                $request = @{ kind = 'board-left'; x = $step.x; y = $step.y }
                if ($step.unitId) {
                    $layer = $script:canvas.Children | Where-Object { $_.Tag.Stack.hex -ceq $step.hex } | Select-Object -First 1
                    if (!$layer) { throw "Missing stack at step $($i + 1): $($step.hex)" }
                    $counter = Find-ReplayMapCounter $layer $step.unitId
                    $page = $layer.Tag.Page
                    $request.unitId = $counter.Tag.UnitId
                }
                Invoke-LocalRequest $request
                if ($step.unitId) {
                    $redrawn = $script:canvas.Children | Where-Object { $_.Tag.Stack.hex -ceq $step.hex } | Select-Object -First 1
                    if ($redrawn.Tag.Page -ne $page) { throw "Selecting a counter reset the stack page at step $($i + 1)" }
                }
                break
            }
            'board-menu' {
                $items = @(Invoke-LocalRequest @{ kind = 'board-menu'; x = $step.x; y = $step.y })
                $context = New-LocalContextMenu $items
                break
            }
            'apply' {
                if ($step.key -like 'menu:*') {
                    $ordinal = ($step.key -split ':')[-1]
                    $group = $context.Items | Where-Object { $_.Header -ceq $step.control.group } | Select-Object -First 1
                    $control = $group.Items | Where-Object {
                        $_.Header -ceq $step.control.label -and ($_.Tag -split ':')[-1] -eq $ordinal
                    } | Select-Object -First 1
                    $event = [Windows.Controls.MenuItem]::ClickEvent
                } else {
                    $control = $script:localButtons.Children | Where-Object {
                        $_.Tag -eq $step.key -and $_.Content.Text -ceq $step.control.label
                    } | Select-Object -First 1
                    $event = [Windows.Controls.Button]::ClickEvent
                }
                if (!$control) { throw "Missing action control at step $($i + 1): $($step.key)" }
                $control.RaiseEvent((New-Object Windows.RoutedEventArgs($event)))
                $context = $null
                break
            }
            default { throw "Unsupported window gesture: $($step.kind)" }
        }
        if ($script:localView.revision -ne $step.expectedRevision -or $script:localHeading.Text -cne $step.expectedHeadline) {
            throw "Unexpected window state at step $($i + 1): $($script:localStatus.Text)"
        }
        if (($i + 1) % 100 -eq 0) {
            [Console]::Error.WriteLine("Windows playthrough: $($i + 1)/$($steps.Count) gestures")
        }
    }
    if (!$script:localView.ended -or $script:localButtons.Children.Count) { throw 'Window has not reached the result screen' }
}

function Find-ReplayMapCounter($layer, [string]$unitId) {
    for ($i = 0; $i -lt $layer.Tag.Stack.pages.Count; $i++) {
        $counter = $layer.Children | Where-Object { $_.Tag.UnitId -ceq $unitId } | Select-Object -First 1
        if ($counter) { return $counter }
        $button = $layer.Children | Where-Object { $_ -is [Windows.Controls.Button] } | Select-Object -First 1
        if (!$button) { break }
        $button.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
    }
    throw "Missing map counter: $unitId"
}
