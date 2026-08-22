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
