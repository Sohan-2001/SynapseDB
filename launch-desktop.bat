@echo off
title SynapseDB Studio Launcher
echo ========================================================
echo           Starting SynapseDB Studio Desktop
echo ========================================================
echo.

set PATH=%USERPROFILE%\.mingw64\bin;%PATH%

:: 1. Ensure binary is built
if not exist "target\release\synapsedb.exe" (
    echo [1/3] Building SynapseDB release binary...
    cargo build --release --bin synapsedb
    if errorlevel 1 (
        echo Error: Failed to build synapsedb.exe
        pause
        exit /b 1
    )
) else (
    echo [1/3] SynapseDB engine binary verified.
)

:: 2. Check if engine server is already running on port 8765
netstat -ano | findstr ":8765" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [2/3] Starting SynapseDB background wire server on 127.0.0.1:8765...
    set SYNAPSE_ADDR=127.0.0.1:8765
    set SYNAPSE_DATA_DIR=data
    start /B "" "target\release\synapsedb.exe"
    timeout /t 2 /nobreak >nul
) else (
    echo [2/3] SynapseDB wire server is already running on 127.0.0.1:8765.
)

:: 3. Launch Electron Studio App
echo [3/3] Launching SynapseDB Studio Desktop Interface...
cd desktop
npm start
