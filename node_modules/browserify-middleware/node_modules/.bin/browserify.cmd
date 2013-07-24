@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\browserify\bin\cmd.js" %*
) ELSE (
  node  "%~dp0\..\browserify\bin\cmd.js" %*
)