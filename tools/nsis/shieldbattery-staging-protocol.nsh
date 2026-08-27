; Registers the shieldbattery-staging:// URL protocol for the staging channel. electron-builder's
; top-level `protocols` option is not consumed by its NSIS target (it only feeds the
; macOS/AppX/Linux packagers), so the installer has to write the registry entries itself.
;
; HKCU deliberately, to match the same-shaped entries the app writes at runtime via
; `setAsDefaultProtocolClient` (see app/app.ts) -- installs are per-user, and using one hive for
; both writers means the uninstall delete below cleans up either one.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\shieldbattery-staging" "" "URL:ShieldBattery Staging"
  WriteRegStr HKCU "Software\Classes\shieldbattery-staging" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\shieldbattery-staging\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\shieldbattery-staging\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\shieldbattery-staging"
!macroend
