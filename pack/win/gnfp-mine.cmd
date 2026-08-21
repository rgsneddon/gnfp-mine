@echo off
set DIR=%~dp0..\..
where node >nul 2>&1
if errorlevel 1 (
  echo gnfp-mine: Node.js 18+ is required ^(the node command was not on PATH^).
  echo Install Node.js 18+ from https://nodejs.org then retry. That install includes npm — you do not npm install this miner.
  exit /b 1
)
node "%DIR%\src\miner.js" %*
