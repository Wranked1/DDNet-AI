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
set "M_START=Updating the bot from GitHub (Wranked1/DDNet-AI)..."
set "M_CURL=curl was not found. Windows 10 1803 or newer is needed."
set "M_GET=Download failed. Check the internet connection."
set "M_UNPACK=Could not unpack."
set "M_DONE=Done. Start DDNet AI.vbs or run.bat."
if defined RU set "M_START=Обновляю бота из GitHub (Wranked1/DDNet-AI)..."
if defined RU set "M_CURL=curl не найден. Нужна Windows 10 1803 или новее."
if defined RU set "M_GET=Не скачалось. Проверь интернет."
if defined RU set "M_UNPACK=Не распаковалось."
if defined RU set "M_DONE=Готово. Запускай DDNet AI.vbs или run.bat."
echo %M_START%
echo.
where curl >nul 2>nul
if errorlevel 1 (
  call echo %%M_CURL%%
  pause
  exit /b 1
)
set TOKEN=
if exist update-token.txt set /p TOKEN=<update-token.txt
if exist update-tmp rmdir /s /q update-tmp
mkdir update-tmp
if "%TOKEN%"=="" (
  curl -fL -o update-tmp\src.zip https://github.com/Wranked1/DDNet-AI/archive/refs/heads/main.zip
) else (
  curl -fL -H "Authorization: Bearer %TOKEN%" -o update-tmp\src.zip https://api.github.com/repos/Wranked1/AiDDNet/zipball/main
)
if errorlevel 1 (
  call echo %%M_GET%%
  rmdir /s /q update-tmp
  pause
  exit /b 1
)
tar -xf update-tmp\src.zip -C update-tmp
if errorlevel 1 (
  call echo %%M_UNPACK%%
  rmdir /s /q update-tmp
  pause
  exit /b 1
)
for /d %%D in (update-tmp\*) do (
  xcopy /e /y /q "%%D\src" src\ >nul
  if exist "%%D\tools" xcopy /e /y /q "%%D\tools" tools\ >nul
  if exist "%%D\app" xcopy /e /y /q "%%D\app" app\ >nul
  if exist "%%D\DDNet AI.vbs" copy /y "%%D\DDNet AI.vbs" . >nul
  copy /y "%%D\start.mjs" . >nul
  copy /y "%%D\package.json" . >nul
  if exist "%%D\opponent.json" copy /y "%%D\opponent.json" . >nul
  if exist "%%D\README.md" copy /y "%%D\README.md" . >nul
  if exist "%%D\README.en.md" copy /y "%%D\README.en.md" . >nul
)
rmdir /s /q update-tmp
echo.
echo %M_DONE%
pause
