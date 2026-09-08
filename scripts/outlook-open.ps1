# RJL CRM -> desktop Outlook bridge.
# Invoked by the rjlcrm: link type (see setup-outlook-link.ps1). Opens the draft the CRM just created in a
# window on screen: by Outlook entry id first, then by Internet Message-ID, retrying while Outlook syncs it.
#   rjlcrm:open?mid=<url-encoded Message-ID>&eid=<hex entry id>
# Writes what happened to %LOCALAPPDATA%\RJL CRM\last.log so problems can be diagnosed.
param([string]$Url)

$logDir = Join-Path $env:LOCALAPPDATA 'RJL CRM'
$log = Join-Path $logDir 'last.log'
function Log($m) { try { Add-Content -Path $log -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $m) } catch {} }
try { Set-Content -Path $log -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] url: " + $Url) } catch {}

Add-Type -AssemblyName System.Web
$mid = $null; $eid = $null
if ($Url -match 'mid=([^&]+)') { $mid = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
if ($Url -match 'eid=([0-9A-Fa-f]+)') { $eid = $Matches[1] }
Log ("mid: " + $mid + " | eid chars: " + $(if ($eid) { $eid.Length } else { 0 }))

try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application'); Log 'attached to running Outlook' } catch { $ol = New-Object -ComObject Outlook.Application; Log 'started Outlook' }
$ns = $ol.GetNamespace('MAPI')
$drafts = $ns.GetDefaultFolder(16)   # olFolderDrafts

if ($eid) {
  for ($try = 0; $try -lt 12; $try++) {
    try { $item = $ns.GetItemFromID($eid); if ($item) { $item.Display(); Log ("opened by entry id on try " + $try); exit 0 } } catch { Log ("GetItemFromID try " + $try + ": " + $_.Exception.Message) }
    if ($try -eq 0) { try { $ns.SendAndReceive($false) | Out-Null } catch {} }
    Start-Sleep -Seconds 1
  }
}

if ($mid) {
  $filter = "@SQL=""http://schemas.microsoft.com/mapi/proptag/0x1035001F"" = '" + $mid.Replace("'", "''") + "'"
  for ($try = 0; $try -lt 20; $try++) {
    try { $item = $drafts.Items.Find($filter) } catch { Log ("Find error: " + $_.Exception.Message); $item = $null }
    if ($item) { $item.Display(); Log ("opened by Message-ID on try " + $try); exit 0 }
    Start-Sleep -Seconds 1
    if ($try -eq 3) { try { $ns.SendAndReceive($false) | Out-Null } catch {} }
  }
  Log 'not found by Message-ID after 20s'
}

# fallback: show the Drafts folder so the new draft is at least one click away
Log 'falling back to Drafts folder'
$explorer = $ol.ActiveExplorer()
if ($explorer) { $explorer.CurrentFolder = $drafts; $explorer.Activate() } else { $drafts.Display() }
