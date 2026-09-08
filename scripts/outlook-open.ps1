# RJL CRM -> desktop Outlook bridge.
# Invoked by the rjlcrm: link type (see setup-outlook-link.ps1). Opens the draft the CRM just created,
# found by its Internet Message-ID, in a window on screen. Retries while Outlook finishes syncing it down.
#   rjlcrm:open?mid=<url-encoded Message-ID>
param([string]$Url)

Add-Type -AssemblyName System.Web
$mid = $null; $eid = $null
if ($Url -match 'mid=([^&]+)') { $mid = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
if ($Url -match 'eid=([0-9A-Fa-f]+)') { $eid = $Matches[1] }

try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { $ol = New-Object -ComObject Outlook.Application }
$ns = $ol.GetNamespace('MAPI')
$drafts = $ns.GetDefaultFolder(16)   # olFolderDrafts

# fastest path: open by MAPI entry id (works as soon as the item has synced down)
if ($eid) {
  for ($try = 0; $try -lt 12; $try++) {
    try { $item = $ns.GetItemFromID($eid); if ($item) { $item.Display(); exit 0 } } catch { }
    if ($try -eq 0) { try { $ns.SendAndReceive($false) | Out-Null } catch { } }
    Start-Sleep -Seconds 1
  }
}

if ($mid) {
  $filter = "@SQL=""http://schemas.microsoft.com/mapi/proptag/0x1035001F"" = '" + $mid.Replace("'", "''") + "'"
  for ($try = 0; $try -lt 20; $try++) {
    $item = $drafts.Items.Find($filter)
    if ($item) { $item.Display(); exit 0 }
    Start-Sleep -Seconds 1
    if ($try -eq 3) { $ns.SendAndReceive($false) | Out-Null }
  }
}
# fallback: show the Drafts folder so the new draft is at least one click away
$explorer = $ol.ActiveExplorer()
if ($explorer) { $explorer.CurrentFolder = $drafts; $explorer.Activate() } else { $drafts.Display() }
