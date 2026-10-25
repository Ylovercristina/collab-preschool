@echo off
setlocal
set "ROOT=%~dp0"

echo Starting Play-is-School without requiring package.json...
start "Play-is-School API" /D "%ROOT%backend" cmd /k node server.js
start "Play-is-School Frontend" /D "%ROOT%" cmd /k node frontend-server.js

echo Frontend: http://localhost:5500/frontend/pages/login.html
echo Backend:  http://localhost:5000/api/health
