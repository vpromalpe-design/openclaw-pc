; NSIS-скрипт — подключается через nsis.include electron-builder (обязателен, в Git).
;
; 1) Перед удалением, если приложение ещё запущено, выполнить --clear-login-item.
;
; Примечание: ранее здесь была страница проверки «имя папки установки не должно
; содержать пробелы» (PathValidateLeave). Но папка по умолчанию — "OpenClaw PC"
; (с пробелом), и Windows/electron-builder полностью поддерживают пути с пробелами —
; проверка блокировала установку в интерактивном режиме, а в тихом (/S) приводила
; к «успеху без установки». Удалена.
;
; НЕ подключать !include "StrContains.nsh": он уже включён в assistedInstaller.nsh —
; повторное подключение даёт ошибку STR_HAYSTACK already declared.

!macro customUnInit
  IfFileExists "$INSTDIR\OpenClaw PC.exe" 0 +2
  ExecWait '"$INSTDIR\OpenClaw PC.exe" --clear-login-item' $0
!macroend

!macro customPageAfterChangeDir
  ; v0.8.24: блокирующая проверка пробелов удалена (см. шапку файла)
!macroend

; v0.9.12: финальная страница мастера — заголовок «OpenClaw PC» красным (#E84242, оригинальный бренд-красный)
; Подключается через nsis.include ДО шаблона → перехватывает !ifmacrodef customFinishPage в assistedInstaller.nsh.
!include nsDialogs.nsh

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_FINISHPAGE_TITLE "OpenClaw PC"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function FinishShow
  ; тёмная тема electron-builder (иначе warning 6010 — функция перестала быть референсирована)
  Call darkFinishShow
  ; Заголовок страницы Finish = «OpenClaw PC» (Static) → красный #E84242, фон прозрачный
  System::Call "user32::FindWindowExW(i $HWNDPARENT, i 0, w 'Static', w 'OpenClaw PC') i .r0"
  IntCmp $0 0 +3
  SetCtlColors $0 "0xE84242" "transparent"
FunctionEnd
!endif
