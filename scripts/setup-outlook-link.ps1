# One-time, per-user setup so the CRM's "Open in Outlook" button can open a draft in desktop Outlook.
# Registers the rjlcrm: link type for the current Windows user (no admin rights, fully reversible:
# delete HKCU:\Software\Classes\rjlcrm to undo). Run from PowerShell:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\Jon\Projects\rjl-crm\scripts\setup-outlook-link.ps1"
$dir = Join-Path $env:LOCALAPPDATA 'RJL CRM'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'outlook-open.ps1') (Join-Path $dir 'outlook-open.ps1') -Force
Copy-Item (Join-Path $PSScriptRoot 'outlook-open.vbs') (Join-Path $dir 'outlook-open.vbs') -Force
$launcher = Join-Path $dir 'outlook-open.vbs'
# wscript runs the helper with no console window (a direct powershell.exe handler flashes a black box)
$cmd = "wscript.exe `"$launcher`" `"%1`""

New-Item -Path 'HKCU:\Software\Classes\rjlcrm' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\rjlcrm' -Name '(default)' -Value 'URL:RJL CRM'
Set-ItemProperty -Path 'HKCU:\Software\Classes\rjlcrm' -Name 'URL Protocol' -Value ''
New-Item -Path 'HKCU:\Software\Classes\rjlcrm\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\rjlcrm\shell\open\command' -Name '(default)' -Value $cmd
Write-Host "Done. The CRM can now open drafts in desktop Outlook. Helper installed at $script"
