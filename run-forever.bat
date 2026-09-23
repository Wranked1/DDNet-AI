@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "RU="
set "LOC=--"
for /f "tokens=3" %%L in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul ^| find "LocaleName"') do set "LOC=%%L"
if /i "%LOC:~0,2%"=="ru" set "RU=1"
if exist settings.json findstr /c:"\"lang\": \"ru\"" settings.json >nul 2>nul && set "RU=1"
if exist settings.json findstr /c:"\"lang\": \"en\"" settings.json >nul 2>nul && set "RU="
if /i "%DDNET_AI_LANG%"=="ru" set "RU=1"
if /i "%DDNET_AI_LANG%"=="en" set "RU="
set "M_START=starting the bot..."
set "M_EXIT=the bot exited. Restarting in 5 seconds. Ctrl+C to stop."
if defined RU set "M_START=запускаю бота..."
if defined RU set "M_EXIT=бот вышел. Перезапуск через 5 секунд. Ctrl+C чтобы остановить."
:loop
echo.
echo [%date% %time%] %M_START%
node start.mjs %*
echo [%date% %time%] %M_EXIT%
timeout /t 5 /nobreak >nul
goto loop
