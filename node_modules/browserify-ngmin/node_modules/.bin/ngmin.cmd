@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\ngmin\bin\ngmin" %*
) ELSE (
  node  "%~dp0\..\ngmin\bin\ngmin" %*
)