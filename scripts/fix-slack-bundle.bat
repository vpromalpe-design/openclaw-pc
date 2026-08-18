@echo off
REM fix-slack-bundle.bat — removes Slack extension and patches chat-meta
REM Double-click or run: fix-slack-bundle.bat
cd /d "%~dp0.."

echo === OpenClaw PC: Removing Slack extension and patching chat-meta ===

rmdir /s /q "resources\openclaw\dist\extensions\slack" 2>nul
echo [1/3] Removed resources\openclaw\dist\extensions\slack (if existed)

rmdir /s /q "build\openclaw\dist\extensions\slack" 2>nul
echo [2/3] Removed build\openclaw\dist\extensions\slack (if existed)

REM Patch chat-meta-*.js to remove "slack" from CHAT_CHANNEL_ORDER
for %%f in (resources\openclaw\dist\chat-meta-*.js) do (
  powershell -NoProfile -Command "$f='%%f'; $c=[System.IO.File]::ReadAllText($f); if($c -notmatch 'openclaw-desktop: slack stripped'){$c=$c -replace '`r?`n\s*\"slack\",',''}; [System.IO.File]::WriteAllText($f,$c)"
  echo [3/3] Patched %%f: removed "slack" from CHAT_CHANNEL_ORDER
)

for %%f in (build\openclaw\dist\chat-meta-*.js) do (
  powershell -NoProfile -Command "$f='%%f'; $c=[System.IO.File]::ReadAllText($f); if($c -notmatch 'openclaw-desktop: slack stripped'){$c=$c -replace '`r?`n\s*\"slack\",',''}; [System.IO.File]::WriteAllText($f,$c)"
  echo [3/3] Patched %%f: removed "slack" from CHAT_CHANNEL_ORDER
)

echo === Fixed. Restart the app. ===
pause
