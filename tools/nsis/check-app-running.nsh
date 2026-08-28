; Replaces electron-builder's is-the-app-running check with the same check hardened against fake
; PowerShells. The stock check probes "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" and trusts
; exit codes: a zero from the probe means PowerShell is usable, and a zero from a Get-CimInstance
; query means the app's processes exist. WINE ships a stub powershell.exe at exactly that path
; which exits 0 no matter what it is asked, so under WINE the stock check concludes the app is
; always running and can never be closed: interactive installs die with "cannot be closed" and
; silent updates quit without installing. Demanding a distinctive exit code that only a real
; shell produces routes such stubs to the tasklist fallback, which fails open (a tasklist that
; is missing or errors reads as "not running", and installing over a live app is recoverable in
; the worst case, unlike an installer that can never run).

; electron-builder's allowOnlyOneInstallerInstance.nsh skips declaring these when
; customCheckAppRunning is defined, but the stock _CHECK_APP_RUNNING inserted below still needs
; them.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${If} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -C "exit 42"`
    Pop $0
    ${If} $0 != 42
      StrCpy $IsPowerShellAvailable 1
    ${EndIf}
  ${EndIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend
