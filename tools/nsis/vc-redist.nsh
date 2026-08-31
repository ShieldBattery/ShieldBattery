; Installs the Microsoft Visual C++ x64 runtime if the target machine doesn't have it. The app
; ships native Node modules that link vcruntime140.dll dynamically, so without the runtime the app
; installs and starts fine but everything touching those modules (StarCraft install detection, game
; launch, replay associations) fails, and the loader error surfaces as an unhelpful
; "Cannot find module" message.
;
; Presence is detected by looking for the runtime DLLs themselves rather than the redist's
; registry entries, because the DLLs are what the app actually needs and because WINE provides
; them as builtins (with stub files in system32) without any redist ever having been installed.
; A registry check would re-run the redist installer on every WINE install and update. Both
; vcruntime140.dll and vcruntime140_1.dll are required: the latter only ships with 2019-era
; (14.20+) redists, and requiring it means an ancient 2015/2017 runtime gets upgraded instead of
; passing detection and failing later. The redist is cumulative, so upgrading is always safe. No
; version check beyond presence is needed: the app's modules import only exports vcruntime140.dll
; has carried since its first (14.0) release (mem*, __CxxFrameHandler3 and friends), so any
; runtime that passes the file check can run them. If a module ever starts importing newer
; exports, this check needs to grow a version floor.
;
; The installer stub is 32-bit, so the check must disable filesystem redirection to see the real
; (64-bit) system32 rather than SysWOW64.
;
; The download uses the INetC plugin (wininet), which works under WINE; PowerShell is not
; reliably present there. The redist itself elevates (one UAC prompt) even with /quiet, which is
; why it isn't run unconditionally. Failure to install is deliberately not fatal: the user can
; install the runtime themselves later, and failing the whole app install over it would be worse.
!macro ensureVcRedist
  Push $0
  Push $1

  ; WINE implements the runtime as builtins, so no redist is ever needed there, and the
  ; Microsoft installer is unreliable under WINE. Its prefixes normally carry stub files for
  ; both DLLs, which pass the file check below anyway; asking ntdll directly also covers
  ; prefixes that lack the stubs. On real Windows the export doesn't exist and the call yields
  ; "error".
  System::Call 'ntdll::wine_get_version() t .r0'
  ${If} $0 != "error"
    StrCpy $0 1
  ${Else}
    ${DisableX64FSRedirection}
    StrCpy $0 0
    ${If} ${FileExists} "$WINDIR\System32\vcruntime140.dll"
    ${AndIf} ${FileExists} "$WINDIR\System32\vcruntime140_1.dll"
      StrCpy $0 1
    ${EndIf}
    ${EnableX64FSRedirection}
  ${EndIf}

  ; The marker records a failed runtime install (written below); clearing it up front means it
  ; always reflects the latest attempt, since installs and every auto-update rerun this macro.
  Delete "$INSTDIR\vc-redist-install-failed.txt"

  ${If} $0 = 0
    DetailPrint "Installing the Microsoft Visual C++ runtime..."
    ${If} ${Silent}
      inetc::get /SILENT /RESUME "" "https://aka.ms/vs/17/release/vc_redist.x64.exe" "$PLUGINSDIR\vc_redist.x64.exe" /END
    ${Else}
      inetc::get /BANNER "Downloading the Microsoft Visual C++ runtime..." /RESUME "" "https://aka.ms/vs/17/release/vc_redist.x64.exe" "$PLUGINSDIR\vc_redist.x64.exe" /END
    ${EndIf}
    Pop $1

    ${If} $1 == "OK"
      ; The redist bootstrapper's manifest is asInvoker (it elevates itself internally, showing
      ; one UAC prompt), so launching it from this unelevated installer works. ExecWait reports a
      ; failure to launch only through the error flag, leaving $1 untouched, so that case has to
      ; be turned into a failure code explicitly.
      ClearErrors
      ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $1
      ${If} ${Errors}
        StrCpy $1 -1
      ${EndIf}
    ${Else}
      DetailPrint "Downloading the Microsoft Visual C++ runtime failed: $1"
      StrCpy $1 -1
    ${EndIf}

    ; 1638 means a newer runtime is already installed (possible if something else installed it
    ; between our check and now). 3010 means success but files in use were scheduled for
    ; replacement at reboot, which can only happen when some runtime was already present and
    ; loaded; the on-disk copy that remains until the reboot is itself enough for the app (see
    ; the version note above), and a truly fresh install has no files in use and returns 0.
    ${If} $1 <> 0
    ${AndIf} $1 <> 1638
    ${AndIf} $1 <> 3010
      ; The installer still exits 0 in this case: the app itself installed fine, and
      ; electron-updater and scripted install wrappers treat a nonzero exit as a failed app
      ; install. The marker file is the signal, for automation and for support triage, that the
      ; runtime still needs installing; in silent installs it's the only one.
      FileOpen $0 "$INSTDIR\vc-redist-install-failed.txt" w
      FileWrite $0 "Installing the Microsoft Visual C++ runtime failed (status: $1).$\r$\n"
      FileWrite $0 "ShieldBattery needs it to launch games. Install it manually from:$\r$\n"
      FileWrite $0 "https://aka.ms/vs/17/release/vc_redist.x64.exe$\r$\n"
      FileClose $0
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "ShieldBattery needs the Microsoft Visual C++ runtime, which could not be installed automatically. You can install it yourself from:$\r$\n$\r$\nhttps://aka.ms/vs/17/release/vc_redist.x64.exe"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  Pop $1
  Pop $0
!macroend
