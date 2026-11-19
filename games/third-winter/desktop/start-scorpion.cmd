@echo off
chcp 65001 >nul
if defined OCS_NODE (
    "%OCS_NODE%" --experimental-strip-types --disable-warning=ExperimentalWarning "%~dp0local\start.mjs" %*
) else (
    node --experimental-strip-types --disable-warning=ExperimentalWarning "%~dp0local\start.mjs" %*
)
if errorlevel 1 pause
