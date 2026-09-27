@echo off
rem Windows launcher. See scripts\run.mjs for the commands.
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org 1>&2 & exit /b 1)
node "%~dp0scripts\run.mjs" %*
