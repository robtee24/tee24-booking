; Tee24 Bay Kiosk: additions to electron-builder's NSIS installer/uninstaller.
;
; Two things the stock uninstaller does not do, both seen on a bay PC on
; 14 Nov 2026 (the kiosk was "still there" after an uninstall):
;
;  1. It decides whether the kiosk is running by spawning tasklist. When that
;     spawn fails (the PC was out of memory) it assumes the kiosk is closed
;     and deletes files underneath it; the locked exe/DLLs/app.asar stay
;     behind as a half-removed copy with no uninstaller. customUnInit ends the
;     kiosk in-process (nsProcess, no child process needed) before any file is
;     touched.
;  2. It knows nothing about the "Tee24 Bay Kiosk" logon task the app
;     registers for itself (src/main/autostart.ts), so that task kept starting
;     whatever was left at every sign-in. customUnInstall removes it.
;
; Neither runs during an auto-update (isUpdated): the update's uninstall step
; must keep the task, and the app has already quit by then.

!macro customUnInit
  ${ifNot} ${isUpdated}
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ; Let Windows release the file handles before the files are removed.
    Sleep 1500
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Delete /TN "Tee24 Bay Kiosk" /F'
    Pop $R0
  ${endIf}
!macroend
