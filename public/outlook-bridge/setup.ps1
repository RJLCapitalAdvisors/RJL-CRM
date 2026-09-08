# RJL CRM: connect the "Handle" / "Open in Outlook" buttons to desktop Outlook on THIS computer.
# Per Windows user, no admin rights, fully reversible (delete HKCU:\Software\Classes\rjlcrm to undo).
# Downloads the two helper files from the live CRM and registers the rjlcrm: link type.
$ErrorActionPreference = 'Stop'
$base = 'https://rjl-crm.vercel.app/outlook-bridge'
$dir = Join-Path $env:LOCALAPPDATA 'RJL CRM'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
foreach ($f in @('outlook-open.ps1', 'outlook-open.vbs')) {
  Invoke-WebRequest -Uri "$base/$f" -OutFile (Join-Path $dir $f) -UseBasicParsing
}
$launcher = Join-Path $dir 'outlook-open.vbs'
$cmd = "wscript.exe `"$launcher`" `"%1`""
New-Item -Path 'HKCU:\Software\Classes\rjlcrm' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\rjlcrm' -Name '(default)' -Value 'URL:RJL CRM'
Set-ItemProperty -Path 'HKCU:\Software\Classes\rjlcrm' -Name 'URL Protocol' -Value ''
New-Item -Path 'HKCU:\Software\Classes\rjlcrm\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\rjlcrm\shell\open\command' -Name '(default)' -Value $cmd
Write-Host ''
Write-Host "Done. Helper installed in $dir"
Write-Host 'Back in the CRM: Settings -> Outlook on this computer -> "Test the Outlook link" should pop up a confirmation.'
Write-Host 'If Handle still does not open Outlook, send the file below to Jonathan:'
Write-Host (Join-Path $dir 'last.log')
