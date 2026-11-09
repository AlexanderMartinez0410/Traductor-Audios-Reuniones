@echo off
chcp 65001 >nul
title Audio Escrito - Sistema Local
echo ================================================================
echo   SISTEMA AUDIO ESCRITO - TRANSCRIPTOR DE REUNIONES
echo ================================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] No se encontro Python en tu sistema.
    echo Por favor instala Python 3.10 o superior marcando "Add Python to PATH".
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/2] Configurando entorno local e instalando librerias...
    python -m venv .venv
    .\.venv\Scripts\pip install --upgrade pip
    .\.venv\Scripts\pip install fastapi uvicorn python-multipart vosk SpeechRecognition python-docx fpdf2 av numpy deep-translator
)

echo [2/2] Iniciando aplicacion local en http://localhost:8000 ...
start "" "http://localhost:8000"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
