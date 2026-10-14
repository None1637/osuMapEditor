@echo off
chcp 65001 >nul
rem 回归测试批跑: 每个验证器只跑一次, 行内给出 ok/FAIL, 末尾汇总
rem 含 CDP 段的验证器会打开编辑器窗口 (OSU_VERIFIER=1 不抢焦点, showInactive)
rem 若源码有改动需先执行: node node_modules\vite\bin\vite.js build
cd /d "D:\Projects\osuMapEditor\Kimi_Agent_osu!编辑器改进 (1)\app"

set VERS=v409 v410 v25 v117 v213 v266 v309 v360 v361 v362 v369 v277 v305 v306 v307 v37 v401 v402 v404 v344 v379 v346

setlocal enabledelayedexpansion
set FAILED=
for %%v in (%VERS%) do (
  echo.
  echo ========== %%v ==========
  node verifier\%%v\check.mjs > verifier\_reg_%%v.log 2>&1
  if errorlevel 1 (
    echo %%v: FAIL
    set FAILED=!FAILED! %%v
    findstr /C:"FAIL" verifier\_reg_%%v.log
  ) else (
    echo %%v: ok
  )
)
echo.
echo ========== 汇总 ==========
if "%FAILED%"=="" (echo 全部通过) else (echo 失败:!FAILED!)
echo 已知 HEAD 遗留失败: v117 v118 v160 v209 v217 v218 v304 v378(2a-2c) v379
echo 日志: verifier\_reg_vXXX.log
echo.
pause
