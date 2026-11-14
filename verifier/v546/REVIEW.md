# v546：独立声学 onset 复核（可选精标）

所有者规则：谱面物件时间点约 80% 对应真实音，因此算法可将物件时间当作含约 20% 离群值的弱标签，无需逐段人工判断有没有音。
本表只用于少量毫秒级精度复核，不是继续研究的前置条件；可只填写算法分歧较大的段落。
每段 WAV 均为参考前 0.5 秒至参考后 1.5 秒，保留双声道；单张 PNG 可查看 5 ms 细节，contact 图仅作总览。
若属于约 20% 无清晰独立 onset 的物件，可填 `confidence=no_clear_onset`，不要勉强给毫秒值。

## sample-001

原音频：`F:\Backup\D\osu!\Songs\673574 Camellia - Shun no Shifudo o Ikashita Kare Fumi Paeria\audio.mp3`

| 段落 | 原音频区间 | 参考点 | 类型 | 选择原因 | onset 残差 ms | 局部相位 ms | 音频 | 图像 |
|---|---|---|---|---|---:|---:|---|---|
| sample-001_r176435 | 02:55.935–02:57.935 | 02:56.435 | redline | 人工复核红线 1/8；段内支持音符 2 | -13.083 | -12.750 | [WAV](clips/sample-001_r176435.wav) | [PNG](plots/sample-001_r176435.png) |
| sample-001_r177231 | 02:56.731–02:58.731 | 02:57.231 | redline | 人工复核红线 2/8；段内支持音符 2 | -8.762 | -4.500 | [WAV](clips/sample-001_r177231.wav) | [PNG](plots/sample-001_r177231.png) |
| sample-001_r178020 | 02:57.520–02:59.520 | 02:58.020 | redline | 人工复核红线 3/8；段内支持音符 2 | 1.164 | 1.750 | [WAV](clips/sample-001_r178020.wav) | [PNG](plots/sample-001_r178020.png) |
| sample-001_r178816 | 02:58.316–03:00.316 | 02:58.816 | redline | 人工复核红线 4/8；段内支持音符 2 | 6.163 | 6.000 | [WAV](clips/sample-001_r178816.wav) | [PNG](plots/sample-001_r178816.png) |
| sample-001_r179619 | 02:59.119–03:01.119 | 02:59.619 | redline | 人工复核红线 5/8；段内支持音符 2 | 3.056 | 1.250 | [WAV](clips/sample-001_r179619.wav) | [PNG](plots/sample-001_r179619.png) |
| sample-001_r180429 | 02:59.929–03:01.929 | 03:00.429 | redline | 人工复核红线 6/8；段内支持音符 2 | -7.373 | -7.500 | [WAV](clips/sample-001_r180429.wav) | [PNG](plots/sample-001_r180429.png) |
| sample-001_r181247 | 03:00.747–03:02.747 | 03:01.247 | redline | 人工复核红线 7/8；段内支持音符 4 |  | -27.500 | [WAV](clips/sample-001_r181247.wav) | [PNG](plots/sample-001_r181247.png) |
| sample-001_r182021 | 03:01.521–03:03.521 | 03:02.021 | redline | 人工复核红线 8/8；段内支持音符 390 | 0.716 | 1.250 | [WAV](clips/sample-001_r182021.wav) | [PNG](plots/sample-001_r182021.png) |

总览：`sample-001-contact.png`

## sample-058

原音频：`F:\Backup\D\osu!\Songs\1820368 Natsu - Regression\audio.ogg`

| 段落 | 原音频区间 | 参考点 | 类型 | 选择原因 | onset 残差 ms | 局部相位 ms | 音频 | 图像 |
|---|---|---|---|---|---:|---:|---|---|
| sample-058_r32400 | 00:31.900–00:33.900 | 00:32.400 | redline | 人工复核红线；段内支持音符 6 | 8.889 | -6.000 | [WAV](clips/sample-058_r32400.wav) | [PNG](plots/sample-058_r32400.png) |
| sample-058_r33688 | 00:33.188–00:35.188 | 00:33.688 | redline | 人工复核红线；段内支持音符 115 | 3.334 | -15.000 | [WAV](clips/sample-058_r33688.wav) | [PNG](plots/sample-058_r33688.png) |
| sample-058_h38530 | 00:38.030–00:40.030 | 00:38.530 | hitobject | 未匹配 onset |  |  | [WAV](clips/sample-058_h38530.wav) | [PNG](plots/sample-058_h38530.png) |
| sample-058_h42951 | 00:42.451–00:44.451 | 00:42.951 | hitobject | 未匹配 onset |  |  | [WAV](clips/sample-058_h42951.wav) | [PNG](plots/sample-058_h42951.png) |
| sample-058_h42109 | 00:41.609–00:43.609 | 00:42.109 | hitobject | 大残差 >5 ms | -14.984 |  | [WAV](clips/sample-058_h42109.wav) | [PNG](plots/sample-058_h42109.png) |
| sample-058_h44635 | 00:44.135–00:46.135 | 00:44.635 | hitobject | 大残差 >5 ms | -14.980 |  | [WAV](clips/sample-058_h44635.wav) | [PNG](plots/sample-058_h44635.png) |
| sample-058_h33042 | 00:32.542–00:34.542 | 00:33.042 | hitobject | ≤5 ms 清晰对照 | 0.500 |  | [WAV](clips/sample-058_h33042.wav) | [PNG](plots/sample-058_h33042.png) |
| sample-058_h32091 | 00:31.591–00:33.591 | 00:32.091 | hitobject | ≤5 ms 清晰对照 | 1.092 |  | [WAV](clips/sample-058_h32091.wav) | [PNG](plots/sample-058_h32091.png) |

总览：`sample-058-contact.png`

## 填写口径

- `actualOnsetMs` 使用原音频的整数毫秒时间轴；`actualOnsetClock` 使用 mm:ss.mmm。
- `confidence` 建议填 `clear` / `approximate` / `no_clear_onset`。
- 需要区分‘这里没有独立音头’与‘音头存在但听不准’，后者可填 `approximate` 并注释估计范围。
- 本轮标签确认前，不计算独立 onset 正确率，也不修改生产检测参数。
