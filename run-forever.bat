@echo off
chcp 65001 >nul
cd /d "%~dp0"
:loop
echo.
echo [%date% %time%] запускаю бота...
node start.mjs %*
echo [%date% %time%] бот вышел. Перезапуск через 5 секунд. Ctrl+C чтобы остановить.
timeout /t 5 /nobreak >nul
goto loop
