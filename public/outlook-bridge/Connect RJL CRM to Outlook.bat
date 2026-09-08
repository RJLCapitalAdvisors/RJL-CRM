@echo off
title Connect RJL CRM to Outlook
echo Connecting the RJL CRM "Handle" and "Open in Outlook" buttons to desktop Outlook on this computer...
echo (No admin rights needed. Only affects your Windows user. Takes a few seconds.)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://rjl-crm.vercel.app/outlook-bridge/setup.ps1' -OutFile \"$env:TEMP\rjlcrm-setup.ps1\" -UseBasicParsing; & \"$env:TEMP\rjlcrm-setup.ps1\""
echo.
echo All set. Go back to the CRM and click Handle again.
echo To check it: CRM -^> Settings -^> Outlook on this computer -^> "Test the Outlook link".
pause
