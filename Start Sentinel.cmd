@echo off
setlocal
cd /d "%~dp0"
set "SENTINEL_NODE=%LOCALAPPDATA%\..\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "SENTINEL_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SENTINEL_NODE%" set "SENTINEL_NODE=node"
"%SENTINEL_NODE%" scripts\start.mjs
pause

