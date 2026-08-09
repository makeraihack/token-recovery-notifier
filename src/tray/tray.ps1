# タスクトレイアイコンを表示するヘルパースクリプト。
# Node側から子プロセスとして起動され、メニュークリック時に標準出力へ合図の文字列を出力して
# Node側にハンドリングさせる("EXIT"=終了、"REGISTER_LOGON_TASK"=ログオン時起動の登録要求)。
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Join-Path $PSHOME "powershell.exe"))

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "Token Recovery Notifier"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$registerItem = New-Object System.Windows.Forms.ToolStripMenuItem "ログオン時起動を登録..."
$menu.Items.Add($registerItem) | Out-Null
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem "終了"
$menu.Items.Add($exitItem) | Out-Null
$notifyIcon.ContextMenuStrip = $menu

$registerItem.add_Click({
    Write-Output "REGISTER_LOGON_TASK"
    [Console]::Out.Flush()
})

$exitItem.add_Click({
    Write-Output "EXIT"
    [Console]::Out.Flush()
    [System.Windows.Forms.Application]::Exit()
})

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
}
