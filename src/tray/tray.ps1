# Helper script that shows the tray icon.
# Launched as a child process from Node. On a menu click, it writes a signal string to
# stdout for Node to handle ("EXIT" = exit, "REGISTER_LOGON_TASK" = request to register
# logon-time startup).
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Join-Path $PSHOME "powershell.exe"))

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "Token Recovery Notifier"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$registerItem = New-Object System.Windows.Forms.ToolStripMenuItem "Register logon-time startup..."
$menu.Items.Add($registerItem) | Out-Null
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem "Exit"
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
