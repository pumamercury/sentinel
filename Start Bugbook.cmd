@echo off
setlocal
cd /d "%~dp0"
set "BUGBOOK_NODE=%LOCALAPPDATA%\..\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "BUGBOOK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%BUGBOOK_NODE%" set "BUGBOOK_NODE=node"
"%BUGBOOK_NODE%" scripts\start.mjs
pause
