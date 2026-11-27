param(
    [switch]$Editor,
    [switch]$Headless
)

$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$godot = $env:OCS_GODOT
if ([string]::IsNullOrWhiteSpace($godot)) {
    $godot = 'E:\godot\Godot_v4.7.2-stable_win64_console.exe'
}
if (-not (Test-Path -LiteralPath $godot)) {
    throw "找不到 Godot：$godot（可用 OCS_GODOT 指定）"
}

$godotArgs = @('--path', $project)
if ($Editor) {
    $godotArgs += '--editor'
} elseif ($Headless) {
    $godotArgs += @('--headless', '--quit-after', '120')
}

& $godot @godotArgs
exit $LASTEXITCODE
