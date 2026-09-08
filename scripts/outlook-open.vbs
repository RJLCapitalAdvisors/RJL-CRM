' Silent launcher for the RJL CRM -> Outlook bridge: runs the PowerShell helper with no console window.
Dim sh, url, script
Set sh = CreateObject("WScript.Shell")
url = ""
If WScript.Arguments.Count > 0 Then url = WScript.Arguments(0)
script = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\RJL CRM\outlook-open.ps1"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ """ & url & """", 0, False
