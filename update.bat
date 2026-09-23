@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Обновляю бота из GitHub (Wranked1/DDNet-AI)...
echo.
where curl >nul 2>nul
if errorlevel 1 (
  echo curl не найден. Нужна Windows 10 1803 или новее.
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
  echo Не скачалось. Проверь интернет.
  rmdir /s /q update-tmp
  pause
  exit /b 1
)
tar -xf update-tmp\src.zip -C update-tmp
if errorlevel 1 (
  echo Не распаковалось.
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
)
rmdir /s /q update-tmp
echo.
echo Готово. Запускай DDNet AI.vbs или run.bat.
pause
