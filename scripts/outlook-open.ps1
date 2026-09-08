# RJL CRM -> desktop Outlook bridge.
# Two jobs, chosen by the URL:
#   rjlcrm:reply?mid=<Message-ID of the ORIGINAL email>&greet=<text>&att=1
#       find that email in this Outlook (Sent Items / Inbox / anywhere), Reply All, let Outlook add the
#       signature, put the greeting on top, re-attach the original's files, show the window.
#   rjlcrm:open?mid=<Message-ID of a draft>&eid=<entry id>
#       open an existing draft (only works once Outlook has synced it down).
# Everything is logged to %LOCALAPPDATA%\RJL CRM\last.log.
param([string]$Url)

$logDir = Join-Path $env:LOCALAPPDATA 'RJL CRM'
$log = Join-Path $logDir 'last.log'
function Log($m) { try { Add-Content -Path $log -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $m) } catch {} }
try { Set-Content -Path $log -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] url: " + $Url) } catch {}

Add-Type -AssemblyName System.Web
function Param($name) { if ($Url -match ($name + '=([^&]+)')) { return [System.Web.HttpUtility]::UrlDecode($Matches[1]) } return $null }
$mode = 'open'; if ($Url -match '^rjlcrm:(\w+)') { $mode = $Matches[1] }
$mid = Param 'mid'; $eid = Param 'eid'; $greet = Param 'greet'; $att = Param 'att'; $draft = Param 'draft'
Log ("mode: $mode | mid: $mid | greet: $greet | att: $att")

try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application'); Log 'attached to running Outlook' } catch { $ol = New-Object -ComObject Outlook.Application; Log 'started Outlook' }
$ns = $ol.GetNamespace('MAPI')
$MIDPROP = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'

function FindByMessageId($id) {
  $filter = "@SQL=""$MIDPROP"" = '" + $id.Replace("'", "''") + "'"
  foreach ($f in @(5, 6, 16)) {   # Sent Items, Inbox, Drafts
    try { $folder = $ns.GetDefaultFolder($f); $item = $folder.Items.Find($filter); if ($item) { return $item } } catch { Log ("Find in folder $f failed: " + $_.Exception.Message) }
  }
  # anywhere else in the mailbox (subfolders the user filed things into)
  try {
    $scope = "'" + $ns.GetDefaultFolder(6).Parent.FolderPath + "'"
    $search = $ol.AdvancedSearch($scope, "urn:schemas:mailheader:message-id = '" + $id.Replace("'", "''") + "'", $true, 'rjlcrm')
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; if ($search.Results.Count -gt 0) { return $search.Results.Item(1) } }
  } catch { Log ("AdvancedSearch failed: " + $_.Exception.Message) }
  return $null
}

if ($mode -eq 'reply' -and $mid) {
  $orig = FindByMessageId $mid
  if ($orig) {
    Log ("found original: " + $orig.Subject)
    $reply = $orig.ReplyAll()
    $reply.Display()   # Outlook inserts the user's signature on display
    if ($greet) {
      $g = [System.Web.HttpUtility]::HtmlEncode($greet)
      $body = $reply.HTMLBody
      $block = "<p style=""margin:0 0 12pt 0;font-family:Calibri,Arial,sans-serif;font-size:11pt;"">$g</p>"
      if ($body -match '<body[^>]*>') { $reply.HTMLBody = $body -replace '(<body[^>]*>)', ('$1' + $block) } else { $reply.HTMLBody = $block + $body }
    }
    if ($att -eq '1') {
      $tmp = Join-Path $env:TEMP 'rjlcrm-att'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null
      foreach ($a in @($orig.Attachments)) {
        try {
          $inline = $false
          try { $cid = $a.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x3712001F'); if ($cid) { $inline = $true } } catch {}
          if ($inline -or $a.FileName -match '\.(png|jpe?g|gif|bmp)$') { continue }
          $path = Join-Path $tmp $a.FileName
          $a.SaveAsFile($path)
          $reply.Attachments.Add($path) | Out-Null
          Log ("attached: " + $a.FileName)
        } catch { Log ("attachment skipped: " + $_.Exception.Message) }
      }
    }
    Log 'reply window open'
    exit 0
  }
  Log 'original not in this Outlook; falling back to the server draft'
  if ($draft) { $mid = $draft }
}

# open an existing draft by entry id, then by Message-ID, retrying while it syncs
$drafts = $ns.GetDefaultFolder(16)
if ($eid) {
  for ($try = 0; $try -lt 8; $try++) {
    try { $item = $ns.GetItemFromID($eid); if ($item) { $item.Display(); Log "opened by entry id"; exit 0 } } catch {}
    if ($try -eq 0) { try { $ns.SendAndReceive($false) | Out-Null } catch {} }
    Start-Sleep -Seconds 1
  }
}
if ($mid) {
  for ($try = 0; $try -lt 10; $try++) {
    $item = FindByMessageId $mid
    if ($item) { $item.Display(); Log "opened by Message-ID"; exit 0 }
    Start-Sleep -Seconds 1
  }
  Log 'not found by Message-ID'
}
Log 'falling back to Drafts folder'
$explorer = $ol.ActiveExplorer()
if ($explorer) { $explorer.CurrentFolder = $drafts; $explorer.Activate() } else { $drafts.Display() }
