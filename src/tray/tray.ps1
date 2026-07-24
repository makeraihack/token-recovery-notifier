# タスクトレイアイコンを表示するヘルパースクリプト。
# Node側から子プロセスとして起動され、「終了」クリック時に標準出力へ "EXIT" を出力して自身も終了する。
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Join-Path $PSHOME "powershell.exe"))

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "Token Recovery Notifier"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem "終了"
$menu.Items.Add($exitItem) | Out-Null
$notifyIcon.ContextMenuStrip = $menu

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
