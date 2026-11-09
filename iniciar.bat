@echo off
chcp 65001 >nul
title Sistema Audio Escrito - Transcriptor Local IA
echo ================================================================
echo   SISTEMA AUDIO ESCRITO - TRANSCRIPTOR Y LECTOR LOCAL IA
echo ================================================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [1/2] Creando entorno virtual e instalando dependencias...
    python -m venv .venv
    .\.venv\Scripts\pip install -r requirements.txt
)

echo Iniciando servidor web en http://localhost:8000 ...
start "" "http://localhost:8000"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
