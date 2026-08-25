; NSIS 自定义脚本 — 由 electron-builder 的 nsis.include 引入（必须保留此文件并纳入 Git）
;
; 1) 卸载前若主程序仍存在，则执行 --clear-login-item
;
; 注意 (v0.8.24)：此前这里有一页校验「安装路径最后一级文件夹名不能含空格」（PathValidateLeave），
; 但默认安装目录就是 "OpenClaw PC"（含空格），且 Windows/electron-builder 完全支持带空格路径 —
; 该校验在交互模式下拦截默认路径，在静默模式 (/S) 下导致「成功但未安装」。已移除。
;
; 不要 !include "StrContains.nsh"：assistedInstaller.nsh 已包含，再包含会报 STR_HAYSTACK already declared。

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
