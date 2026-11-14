# v573：六首保留歌曲的独立 onset 盲标

共 180 个物件：017、047、054、067、077、099 各 30 个。这些歌曲未参与 v559–v572 的开发推理、候选评估或标注；其 PCM 与旧预测已在最初 v541 冻结。
图中不显示算法候选 onset、修正目标或相位。每段 WAV 为参考前 0.5 秒至后 0.5 秒，保留原声道；单张 PNG 提供 ±80 ms 和 5 ms 刻度。
若物件没有清晰独立 onset，请填 `confidence=no_clear_onset`，不要强填毫秒值。算法分层只用于加权估计，不是真值。
每层按人口/实际抽样数加权；缺候选在主指标中计为不正确。

## sample-017

原音频：`F:\Backup\D\osu!\Songs\1510535 65daysofstatic - Retreat! Retreat! (Cut Ver)\audio3.mp3`

### full 与 high 都在 ±5 ms（人口 433，抽样 10，权重 43.300000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-017_h47920 | 00:47.420–00:48.420 | 00:47.920 | stable | [WAV](clips/sample-017_h47920.wav) | [PNG](plots/sample-017_h47920.png) |
| sample-017_h35613 | 00:35.113–00:36.113 | 00:35.613 | stable | [WAV](clips/sample-017_h35613.wav) | [PNG](plots/sample-017_h35613.png) |
| sample-017_h76382 | 01:15.882–01:16.882 | 01:16.382 | stable | [WAV](clips/sample-017_h76382.wav) | [PNG](plots/sample-017_h76382.png) |
| sample-017_h13151 | 00:12.651–00:13.651 | 00:13.151 | stable | [WAV](clips/sample-017_h13151.wav) | [PNG](plots/sample-017_h13151.png) |
| sample-017_h24382 | 00:23.882–00:24.882 | 00:24.382 | stable | [WAV](clips/sample-017_h24382.wav) | [PNG](plots/sample-017_h24382.png) |
| sample-017_h90382 | 01:29.882–01:30.882 | 01:30.382 | stable | [WAV](clips/sample-017_h90382.wav) | [PNG](plots/sample-017_h90382.png) |
| sample-017_h19305 | 00:18.805–00:19.805 | 00:19.305 | stable | [WAV](clips/sample-017_h19305.wav) | [PNG](plots/sample-017_h19305.png) |
| sample-017_h84997 | 01:24.497–01:25.497 | 01:24.997 | stable | [WAV](clips/sample-017_h84997.wav) | [PNG](plots/sample-017_h84997.png) |
| sample-017_h85767 | 01:25.267–01:26.267 | 01:25.767 | stable | [WAV](clips/sample-017_h85767.wav) | [PNG](plots/sample-017_h85767.png) |
| sample-017_h47151 | 00:46.651–00:47.651 | 00:47.151 | stable | [WAV](clips/sample-017_h47151.wav) | [PNG](plots/sample-017_h47151.png) |

总览：`sample-017-both-within5-contact.png`

### 仅 high 在 ±5 ms（人口 23，抽样 10，权重 2.300000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-017_h77613 | 01:17.113–01:18.113 | 01:17.613 | stable | [WAV](clips/sample-017_h77613.wav) | [PNG](plots/sample-017_h77613.png) |
| sample-017_h106690 | 01:46.190–01:47.190 | 01:46.690 | stable | [WAV](clips/sample-017_h106690.wav) | [PNG](plots/sample-017_h106690.png) |
| sample-017_h62074 | 01:01.574–01:02.574 | 01:02.074 | stable | [WAV](clips/sample-017_h62074.wav) | [PNG](plots/sample-017_h62074.png) |
| sample-017_h91767 | 01:31.267–01:32.267 | 01:31.767 | stable | [WAV](clips/sample-017_h91767.wav) | [PNG](plots/sample-017_h91767.png) |
| sample-017_h113305 | 01:52.805–01:53.805 | 01:53.305 | stable | [WAV](clips/sample-017_h113305.wav) | [PNG](plots/sample-017_h113305.png) |
| sample-017_h95920 | 01:35.420–01:36.420 | 01:35.920 | stable | [WAV](clips/sample-017_h95920.wav) | [PNG](plots/sample-017_h95920.png) |
| sample-017_h66228 | 01:05.728–01:06.728 | 01:06.228 | stable | [WAV](clips/sample-017_h66228.wav) | [PNG](plots/sample-017_h66228.png) |
| sample-017_h73613 | 01:13.113–01:14.113 | 01:13.613 | stable | [WAV](clips/sample-017_h73613.wav) | [PNG](plots/sample-017_h73613.png) |
| sample-017_h101767 | 01:41.267–01:42.267 | 01:41.767 | stable | [WAV](clips/sample-017_h101767.wav) | [PNG](plots/sample-017_h101767.png) |
| sample-017_h25305 | 00:24.805–00:25.805 | 00:25.305 | stable | [WAV](clips/sample-017_h25305.wav) | [PNG](plots/sample-017_h25305.png) |

总览：`sample-017-only-high-within5-contact.png`

### 两者都不在 ±5 ms（人口 91，抽样 10，权重 9.100000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-017_h72536 | 01:12.036–01:13.036 | 01:12.536 | stable | [WAV](clips/sample-017_h72536.wav) | [PNG](plots/sample-017_h72536.png) |
| sample-017_h78228 | 01:17.728–01:18.728 | 01:18.228 | stable | [WAV](clips/sample-017_h78228.wav) | [PNG](plots/sample-017_h78228.png) |
| sample-017_h15767 | 00:15.267–00:16.267 | 00:15.767 | stable | [WAV](clips/sample-017_h15767.wav) | [PNG](plots/sample-017_h15767.png) |
| sample-017_h104997 | 01:44.497–01:45.497 | 01:44.997 | stable | [WAV](clips/sample-017_h104997.wav) | [PNG](plots/sample-017_h104997.png) |
| sample-017_h82382 | 01:21.882–01:22.882 | 01:22.382 | stable | [WAV](clips/sample-017_h82382.wav) | [PNG](plots/sample-017_h82382.png) |
| sample-017_h84228 | 01:23.728–01:24.728 | 01:24.228 | stable | [WAV](clips/sample-017_h84228.wav) | [PNG](plots/sample-017_h84228.png) |
| sample-017_h74536 | 01:14.036–01:15.036 | 01:14.536 | stable | [WAV](clips/sample-017_h74536.wav) | [PNG](plots/sample-017_h74536.png) |
| sample-017_h112997 | 01:52.497–01:53.497 | 01:52.997 | stable | [WAV](clips/sample-017_h112997.wav) | [PNG](plots/sample-017_h112997.png) |
| sample-017_h1468 | 00:00.968–00:01.968 | 00:01.468 | dense | [WAV](clips/sample-017_h1468.wav) | [PNG](plots/sample-017_h1468.png) |
| sample-017_h20074 | 00:19.574–00:20.574 | 00:20.074 | stable | [WAV](clips/sample-017_h20074.wav) | [PNG](plots/sample-017_h20074.png) |

总览：`sample-017-neither-within5-contact.png`

## sample-047

原音频：`F:\Backup\D\osu!\Songs\260551 t+pazolite - Rumble Kung-fu Showdown\t+pazolite  Rumble Kung-fu Showdown.mp3`

### full 与 high 都在 ±5 ms（人口 839，抽样 10，权重 83.900000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-047_h142742 | 02:22.242–02:23.242 | 02:22.742 | stable | [WAV](clips/sample-047_h142742.wav) | [PNG](plots/sample-047_h142742.png) |
| sample-047_h75742 | 01:15.242–01:16.242 | 01:15.742 | stable | [WAV](clips/sample-047_h75742.wav) | [PNG](plots/sample-047_h75742.png) |
| sample-047_h90492 | 01:29.992–01:30.992 | 01:30.492 | stable | [WAV](clips/sample-047_h90492.wav) | [PNG](plots/sample-047_h90492.png) |
| sample-047_h122367 | 02:01.867–02:02.867 | 02:02.367 | stable | [WAV](clips/sample-047_h122367.wav) | [PNG](plots/sample-047_h122367.png) |
| sample-047_h42742 | 00:42.242–00:43.242 | 00:42.742 | stable | [WAV](clips/sample-047_h42742.wav) | [PNG](plots/sample-047_h42742.png) |
| sample-047_h55929 | 00:55.429–00:56.429 | 00:55.929 | stable | [WAV](clips/sample-047_h55929.wav) | [PNG](plots/sample-047_h55929.png) |
| sample-047_h140742 | 02:20.242–02:21.242 | 02:20.742 | stable | [WAV](clips/sample-047_h140742.wav) | [PNG](plots/sample-047_h140742.png) |
| sample-047_h62867 | 01:02.367–01:03.367 | 01:02.867 | stable | [WAV](clips/sample-047_h62867.wav) | [PNG](plots/sample-047_h62867.png) |
| sample-047_h168867 | 02:48.367–02:49.367 | 02:48.867 | stable | [WAV](clips/sample-047_h168867.wav) | [PNG](plots/sample-047_h168867.png) |
| sample-047_h7367 | 00:06.867–00:07.867 | 00:07.367 | stable | [WAV](clips/sample-047_h7367.wav) | [PNG](plots/sample-047_h7367.png) |

总览：`sample-047-both-within5-contact.png`

### 仅 high 在 ±5 ms（人口 29，抽样 10，权重 2.900000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-047_h72242 | 01:11.742–01:12.742 | 01:12.242 | stable | [WAV](clips/sample-047_h72242.wav) | [PNG](plots/sample-047_h72242.png) |
| sample-047_h69992 | 01:09.492–01:10.492 | 01:09.992 | stable | [WAV](clips/sample-047_h69992.wav) | [PNG](plots/sample-047_h69992.png) |
| sample-047_h73367 | 01:12.867–01:13.867 | 01:13.367 | stable | [WAV](clips/sample-047_h73367.wav) | [PNG](plots/sample-047_h73367.png) |
| sample-047_h17242 | 00:16.742–00:17.742 | 00:17.242 | stable | [WAV](clips/sample-047_h17242.wav) | [PNG](plots/sample-047_h17242.png) |
| sample-047_h95679 | 01:35.179–01:36.179 | 01:35.679 | stable | [WAV](clips/sample-047_h95679.wav) | [PNG](plots/sample-047_h95679.png) |
| sample-047_h45242 | 00:44.742–00:45.742 | 00:45.242 | stable | [WAV](clips/sample-047_h45242.wav) | [PNG](plots/sample-047_h45242.png) |
| sample-047_h82117 | 01:21.617–01:22.617 | 01:22.117 | stable | [WAV](clips/sample-047_h82117.wav) | [PNG](plots/sample-047_h82117.png) |
| sample-047_h112179 | 01:51.679–01:52.679 | 01:52.179 | stable | [WAV](clips/sample-047_h112179.wav) | [PNG](plots/sample-047_h112179.png) |
| sample-047_h144492 | 02:23.992–02:24.992 | 02:24.492 | stable | [WAV](clips/sample-047_h144492.wav) | [PNG](plots/sample-047_h144492.png) |
| sample-047_h83179 | 01:22.679–01:23.679 | 01:23.179 | stable | [WAV](clips/sample-047_h83179.wav) | [PNG](plots/sample-047_h83179.png) |

总览：`sample-047-only-high-within5-contact.png`

### 两者都不在 ±5 ms（人口 63，抽样 10，权重 6.300000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-047_h43617 | 00:43.117–00:44.117 | 00:43.617 | stable | [WAV](clips/sample-047_h43617.wav) | [PNG](plots/sample-047_h43617.png) |
| sample-047_h66367 | 01:05.867–01:06.867 | 01:06.367 | stable | [WAV](clips/sample-047_h66367.wav) | [PNG](plots/sample-047_h66367.png) |
| sample-047_h94804 | 01:34.304–01:35.304 | 01:34.804 | stable | [WAV](clips/sample-047_h94804.wav) | [PNG](plots/sample-047_h94804.png) |
| sample-047_h44492 | 00:43.992–00:44.992 | 00:44.492 | stable | [WAV](clips/sample-047_h44492.wav) | [PNG](plots/sample-047_h44492.png) |
| sample-047_h170429 | 02:49.929–02:50.929 | 02:50.429 | stable | [WAV](clips/sample-047_h170429.wav) | [PNG](plots/sample-047_h170429.png) |
| sample-047_h72492 | 01:11.992–01:12.992 | 01:12.492 | stable | [WAV](clips/sample-047_h72492.wav) | [PNG](plots/sample-047_h72492.png) |
| sample-047_h166304 | 02:45.804–02:46.804 | 02:46.304 | stable | [WAV](clips/sample-047_h166304.wav) | [PNG](plots/sample-047_h166304.png) |
| sample-047_h32742 | 00:32.242–00:33.242 | 00:32.742 | stable | [WAV](clips/sample-047_h32742.wav) | [PNG](plots/sample-047_h32742.png) |
| sample-047_h129179 | 02:08.679–02:09.679 | 02:09.179 | stable | [WAV](clips/sample-047_h129179.wav) | [PNG](plots/sample-047_h129179.png) |
| sample-047_h111367 | 01:50.867–01:51.867 | 01:51.367 | stable | [WAV](clips/sample-047_h111367.wav) | [PNG](plots/sample-047_h111367.png) |

总览：`sample-047-neither-within5-contact.png`

## sample-054

原音频：`F:\Backup\D\osu!\Songs\osu!droid Daninintei 7th Dan Courses\audio.mp3`

### full 与 high 都在 ±5 ms（人口 2083，抽样 10，权重 208.300000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-054_h235298 | 03:54.798–03:55.798 | 03:55.298 | dense | [WAV](clips/sample-054_h235298.wav) | [PNG](plots/sample-054_h235298.png) |
| sample-054_h91394 | 01:30.894–01:31.894 | 01:31.394 | stable | [WAV](clips/sample-054_h91394.wav) | [PNG](plots/sample-054_h91394.png) |
| sample-054_h436600 | 07:16.100–07:17.100 | 07:16.600 | stable | [WAV](clips/sample-054_h436600.wav) | [PNG](plots/sample-054_h436600.png) |
| sample-054_h331836 | 05:31.336–05:32.336 | 05:31.836 | stable | [WAV](clips/sample-054_h331836.wav) | [PNG](plots/sample-054_h331836.png) |
| sample-054_h395616 | 06:35.116–06:36.116 | 06:35.616 | stable | [WAV](clips/sample-054_h395616.wav) | [PNG](plots/sample-054_h395616.png) |
| sample-054_h184552 | 03:04.052–03:05.052 | 03:04.552 | stable | [WAV](clips/sample-054_h184552.wav) | [PNG](plots/sample-054_h184552.png) |
| sample-054_h316482 | 05:15.982–05:16.982 | 05:16.482 | stable | [WAV](clips/sample-054_h316482.wav) | [PNG](plots/sample-054_h316482.png) |
| sample-054_h387584 | 06:27.084–06:28.084 | 06:27.584 | stable | [WAV](clips/sample-054_h387584.wav) | [PNG](plots/sample-054_h387584.png) |
| sample-054_h39227 | 00:38.727–00:39.727 | 00:39.227 | stable | [WAV](clips/sample-054_h39227.wav) | [PNG](plots/sample-054_h39227.png) |
| sample-054_h332191 | 05:31.691–05:32.691 | 05:32.191 | stable | [WAV](clips/sample-054_h332191.wav) | [PNG](plots/sample-054_h332191.png) |

总览：`sample-054-both-within5-contact.png`

### 仅 high 在 ±5 ms（人口 114，抽样 10，权重 11.400000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-054_h402348 | 06:41.848–06:42.848 | 06:42.348 | stable | [WAV](clips/sample-054_h402348.wav) | [PNG](plots/sample-054_h402348.png) |
| sample-054_h101727 | 01:41.227–01:42.227 | 01:41.727 | stable | [WAV](clips/sample-054_h101727.wav) | [PNG](plots/sample-054_h101727.png) |
| sample-054_h94060 | 01:33.560–01:34.560 | 01:34.060 | stable | [WAV](clips/sample-054_h94060.wav) | [PNG](plots/sample-054_h94060.png) |
| sample-054_h297821 | 04:57.321–04:58.321 | 04:57.821 | stable | [WAV](clips/sample-054_h297821.wav) | [PNG](plots/sample-054_h297821.png) |
| sample-054_h125460 | 02:04.960–02:05.960 | 02:05.460 | stable | [WAV](clips/sample-054_h125460.wav) | [PNG](plots/sample-054_h125460.png) |
| sample-054_h23313 | 00:22.813–00:23.813 | 00:23.313 | stable | [WAV](clips/sample-054_h23313.wav) | [PNG](plots/sample-054_h23313.png) |
| sample-054_h64310 | 01:03.810–01:04.810 | 01:04.310 | stable | [WAV](clips/sample-054_h64310.wav) | [PNG](plots/sample-054_h64310.png) |
| sample-054_h74949 | 01:14.449–01:15.449 | 01:14.949 | stable | [WAV](clips/sample-054_h74949.wav) | [PNG](plots/sample-054_h74949.png) |
| sample-054_h434356 | 07:13.856–07:14.856 | 07:14.356 | stable | [WAV](clips/sample-054_h434356.wav) | [PNG](plots/sample-054_h434356.png) |
| sample-054_h50810 | 00:50.310–00:51.310 | 00:50.810 | stable | [WAV](clips/sample-054_h50810.wav) | [PNG](plots/sample-054_h50810.png) |

总览：`sample-054-only-high-within5-contact.png`

### 两者都不在 ±5 ms（人口 313，抽样 10，权重 31.300000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-054_h278569 | 04:38.069–04:39.069 | 04:38.569 | stable | [WAV](clips/sample-054_h278569.wav) | [PNG](plots/sample-054_h278569.png) |
| sample-054_h158718 | 02:38.218–02:39.218 | 02:38.718 | stable | [WAV](clips/sample-054_h158718.wav) | [PNG](plots/sample-054_h158718.png) |
| sample-054_h185385 | 03:04.885–03:05.885 | 03:05.385 | stable | [WAV](clips/sample-054_h185385.wav) | [PNG](plots/sample-054_h185385.png) |
| sample-054_h218219 | 03:37.719–03:38.719 | 03:38.219 | stable | [WAV](clips/sample-054_h218219.wav) | [PNG](plots/sample-054_h218219.png) |
| sample-054_h160052 | 02:39.552–02:40.552 | 02:40.052 | stable | [WAV](clips/sample-054_h160052.wav) | [PNG](plots/sample-054_h160052.png) |
| sample-054_h76505 | 01:16.005–01:17.005 | 01:16.505 | stable | [WAV](clips/sample-054_h76505.wav) | [PNG](plots/sample-054_h76505.png) |
| sample-054_h425380 | 07:04.880–07:05.880 | 07:05.380 | stable | [WAV](clips/sample-054_h425380.wav) | [PNG](plots/sample-054_h425380.png) |
| sample-054_h396029 | 06:35.529–06:36.529 | 06:36.029 | stable | [WAV](clips/sample-054_h396029.wav) | [PNG](plots/sample-054_h396029.png) |
| sample-054_h66060 | 01:05.560–01:06.560 | 01:06.060 | stable | [WAV](clips/sample-054_h66060.wav) | [PNG](plots/sample-054_h66060.png) |
| sample-054_h173677 | 02:53.177–02:54.177 | 02:53.677 | stable | [WAV](clips/sample-054_h173677.wav) | [PNG](plots/sample-054_h173677.png) |

总览：`sample-054-neither-within5-contact.png`

## sample-067

原音频：`F:\Backup\D\osu!\Songs\732851 LeaF - Lyrith\audio.mp3`

### full 与 high 都在 ±5 ms（人口 625，抽样 10，权重 62.500000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-067_h21774 | 00:21.274–00:22.274 | 00:21.774 | stable | [WAV](clips/sample-067_h21774.wav) | [PNG](plots/sample-067_h21774.png) |
| sample-067_h39910 | 00:39.410–00:40.410 | 00:39.910 | stable | [WAV](clips/sample-067_h39910.wav) | [PNG](plots/sample-067_h39910.png) |
| sample-067_h20080 | 00:19.580–00:20.580 | 00:20.080 | stable | [WAV](clips/sample-067_h20080.wav) | [PNG](plots/sample-067_h20080.png) |
| sample-067_h58215 | 00:57.715–00:58.715 | 00:58.215 | stable | [WAV](clips/sample-067_h58215.wav) | [PNG](plots/sample-067_h58215.png) |
| sample-067_h46943 | 00:46.443–00:47.443 | 00:46.943 | stable | [WAV](clips/sample-067_h46943.wav) | [PNG](plots/sample-067_h46943.png) |
| sample-067_h34656 | 00:34.156–00:35.156 | 00:34.656 | stable | [WAV](clips/sample-067_h34656.wav) | [PNG](plots/sample-067_h34656.png) |
| sample-067_h124571 | 02:04.071–02:05.071 | 02:04.571 | stable | [WAV](clips/sample-067_h124571.wav) | [PNG](plots/sample-067_h124571.png) |
| sample-067_h117961 | 01:57.461–01:58.461 | 01:57.961 | stable | [WAV](clips/sample-067_h117961.wav) | [PNG](plots/sample-067_h117961.png) |
| sample-067_h43214 | 00:42.714–00:43.714 | 00:43.214 | stable | [WAV](clips/sample-067_h43214.wav) | [PNG](plots/sample-067_h43214.png) |
| sample-067_h50165 | 00:49.665–00:50.665 | 00:50.165 | stable | [WAV](clips/sample-067_h50165.wav) | [PNG](plots/sample-067_h50165.png) |

总览：`sample-067-both-within5-contact.png`

### 仅 high 在 ±5 ms（人口 51，抽样 10，权重 5.100000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-067_h73554 | 01:13.054–01:14.054 | 01:13.554 | stable | [WAV](clips/sample-067_h73554.wav) | [PNG](plots/sample-067_h73554.png) |
| sample-067_h104741 | 01:44.241–01:45.241 | 01:44.741 | stable | [WAV](clips/sample-067_h104741.wav) | [PNG](plots/sample-067_h104741.png) |
| sample-067_h44910 | 00:44.410–00:45.410 | 00:44.910 | stable | [WAV](clips/sample-067_h44910.wav) | [PNG](plots/sample-067_h44910.png) |
| sample-067_h109063 | 01:48.563–01:49.563 | 01:49.063 | stable | [WAV](clips/sample-067_h109063.wav) | [PNG](plots/sample-067_h109063.png) |
| sample-067_h15164 | 00:14.664–00:15.664 | 00:15.164 | stable | [WAV](clips/sample-067_h15164.wav) | [PNG](plots/sample-067_h15164.png) |
| sample-067_h138384 | 02:17.884–02:18.884 | 02:18.384 | stable | [WAV](clips/sample-067_h138384.wav) | [PNG](plots/sample-067_h138384.png) |
| sample-067_h24317 | 00:23.817–00:24.817 | 00:24.317 | stable | [WAV](clips/sample-067_h24317.wav) | [PNG](plots/sample-067_h24317.png) |
| sample-067_h64740 | 01:04.240–01:05.240 | 01:04.740 | stable | [WAV](clips/sample-067_h64740.wav) | [PNG](plots/sample-067_h64740.png) |
| sample-067_h144484 | 02:23.984–02:24.984 | 02:24.484 | stable | [WAV](clips/sample-067_h144484.wav) | [PNG](plots/sample-067_h144484.png) |
| sample-067_h67198 | 01:06.698–01:07.698 | 01:07.198 | stable | [WAV](clips/sample-067_h67198.wav) | [PNG](plots/sample-067_h67198.png) |

总览：`sample-067-only-high-within5-contact.png`

### 两者都不在 ±5 ms（人口 116，抽样 10，权重 11.600000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-067_h31096 | 00:30.596–00:31.596 | 00:31.096 | stable | [WAV](clips/sample-067_h31096.wav) | [PNG](plots/sample-067_h31096.png) |
| sample-067_h103469 | 01:42.969–01:43.969 | 01:43.469 | stable | [WAV](clips/sample-067_h103469.wav) | [PNG](plots/sample-067_h103469.png) |
| sample-067_h140587 | 02:20.087–02:21.087 | 02:20.587 | stable | [WAV](clips/sample-067_h140587.wav) | [PNG](plots/sample-067_h140587.png) |
| sample-067_h16690 | 00:16.190–00:17.190 | 00:16.690 | stable | [WAV](clips/sample-067_h16690.wav) | [PNG](plots/sample-067_h16690.png) |
| sample-067_h13893 | 00:13.393–00:14.393 | 00:13.893 | stable | [WAV](clips/sample-067_h13893.wav) | [PNG](plots/sample-067_h13893.png) |
| sample-067_h25164 | 00:24.664–00:25.664 | 00:25.164 | stable | [WAV](clips/sample-067_h25164.wav) | [PNG](plots/sample-067_h25164.png) |
| sample-067_h110842 | 01:50.342–01:51.342 | 01:50.842 | stable | [WAV](clips/sample-067_h110842.wav) | [PNG](plots/sample-067_h110842.png) |
| sample-067_h32961 | 00:32.461–00:33.461 | 00:32.961 | stable | [WAV](clips/sample-067_h32961.wav) | [PNG](plots/sample-067_h32961.png) |
| sample-067_h23977 | 00:23.477–00:24.477 | 00:23.977 | stable | [WAV](clips/sample-067_h23977.wav) | [PNG](plots/sample-067_h23977.png) |
| sample-067_h5334 | 00:04.834–00:05.834 | 00:05.334 | stable | [WAV](clips/sample-067_h5334.wav) | [PNG](plots/sample-067_h5334.png) |

总览：`sample-067-neither-within5-contact.png`

## sample-077

原音频：`F:\Backup\D\osu!\Songs\967321 Tokyo Jihen - Sounan\audio.mp3`

### full 与 high 都在 ±5 ms（人口 213，抽样 10，权重 21.300000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-077_h154444 | 02:33.944–02:34.944 | 02:34.444 | stable | [WAV](clips/sample-077_h154444.wav) | [PNG](plots/sample-077_h154444.png) |
| sample-077_h72323 | 01:11.823–01:12.823 | 01:12.323 | stable | [WAV](clips/sample-077_h72323.wav) | [PNG](plots/sample-077_h72323.png) |
| sample-077_h50031 | 00:49.531–00:50.531 | 00:50.031 | stable | [WAV](clips/sample-077_h50031.wav) | [PNG](plots/sample-077_h50031.png) |
| sample-077_h121540 | 02:01.040–02:02.040 | 02:01.540 | stable | [WAV](clips/sample-077_h121540.wav) | [PNG](plots/sample-077_h121540.png) |
| sample-077_h105791 | 01:45.291–01:46.291 | 01:45.791 | stable | [WAV](clips/sample-077_h105791.wav) | [PNG](plots/sample-077_h105791.png) |
| sample-077_h136558 | 02:16.058–02:17.058 | 02:16.558 | stable | [WAV](clips/sample-077_h136558.wav) | [PNG](plots/sample-077_h136558.png) |
| sample-077_h105406 | 01:44.906–01:45.906 | 01:45.406 | stable | [WAV](clips/sample-077_h105406.wav) | [PNG](plots/sample-077_h105406.png) |
| sample-077_h173861 | 02:53.361–02:54.361 | 02:53.861 | stable | [WAV](clips/sample-077_h173861.wav) | [PNG](plots/sample-077_h173861.png) |
| sample-077_h31973 | 00:31.473–00:32.473 | 00:31.973 | dense | [WAV](clips/sample-077_h31973.wav) | [PNG](plots/sample-077_h31973.png) |
| sample-077_h20024 | 00:19.524–00:20.524 | 00:20.024 | stable | [WAV](clips/sample-077_h20024.wav) | [PNG](plots/sample-077_h20024.png) |

总览：`sample-077-both-within5-contact.png`

### 仅 high 在 ±5 ms（人口 29，抽样 10，权重 2.900000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-077_h16558 | 00:16.058–00:17.058 | 00:16.558 | stable | [WAV](clips/sample-077_h16558.wav) | [PNG](plots/sample-077_h16558.png) |
| sample-077_h128874 | 02:08.374–02:09.374 | 02:08.874 | stable | [WAV](clips/sample-077_h128874.wav) | [PNG](plots/sample-077_h128874.png) |
| sample-077_h166753 | 02:46.253–02:47.253 | 02:46.753 | stable | [WAV](clips/sample-077_h166753.wav) | [PNG](plots/sample-077_h166753.png) |
| sample-077_h13861 | 00:13.361–00:14.361 | 00:13.861 | stable | [WAV](clips/sample-077_h13861.wav) | [PNG](plots/sample-077_h13861.png) |
| sample-077_h159059 | 02:38.559–02:39.559 | 02:39.059 | stable | [WAV](clips/sample-077_h159059.wav) | [PNG](plots/sample-077_h159059.png) |
| sample-077_h13476 | 00:12.976–00:13.976 | 00:13.476 | stable | [WAV](clips/sample-077_h13476.wav) | [PNG](plots/sample-077_h13476.png) |
| sample-077_h57916 | 00:57.416–00:58.416 | 00:57.916 | stable | [WAV](clips/sample-077_h57916.wav) | [PNG](plots/sample-077_h57916.png) |
| sample-077_h41181 | 00:40.681–00:41.681 | 00:41.181 | stable | [WAV](clips/sample-077_h41181.wav) | [PNG](plots/sample-077_h41181.png) |
| sample-077_h69262 | 01:08.762–01:09.762 | 01:09.262 | stable | [WAV](clips/sample-077_h69262.wav) | [PNG](plots/sample-077_h69262.png) |
| sample-077_h137134 | 02:16.634–02:17.634 | 02:17.134 | stable | [WAV](clips/sample-077_h137134.wav) | [PNG](plots/sample-077_h137134.png) |

总览：`sample-077-only-high-within5-contact.png`

### 两者都不在 ±5 ms（人口 125，抽样 10，权重 12.500000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-077_h158290 | 02:37.790–02:38.790 | 02:38.290 | stable | [WAV](clips/sample-077_h158290.wav) | [PNG](plots/sample-077_h158290.png) |
| sample-077_h142729 | 02:22.229–02:23.229 | 02:22.729 | stable | [WAV](clips/sample-077_h142729.wav) | [PNG](plots/sample-077_h142729.png) |
| sample-077_h179652 | 02:59.152–03:00.152 | 02:59.652 | stable | [WAV](clips/sample-077_h179652.wav) | [PNG](plots/sample-077_h179652.png) |
| sample-077_h60993 | 01:00.493–01:01.493 | 01:00.993 | stable | [WAV](clips/sample-077_h60993.wav) | [PNG](plots/sample-077_h60993.png) |
| sample-077_h115780 | 01:55.280–01:56.280 | 01:55.780 | stable | [WAV](clips/sample-077_h115780.wav) | [PNG](plots/sample-077_h115780.png) |
| sample-077_h185407 | 03:04.907–03:05.907 | 03:05.407 | stable | [WAV](clips/sample-077_h185407.wav) | [PNG](plots/sample-077_h185407.png) |
| sample-077_h86196 | 01:25.696–01:26.696 | 01:26.196 | dense | [WAV](clips/sample-077_h86196.wav) | [PNG](plots/sample-077_h86196.png) |
| sample-077_h167330 | 02:46.830–02:47.830 | 02:47.330 | stable | [WAV](clips/sample-077_h167330.wav) | [PNG](plots/sample-077_h167330.png) |
| sample-077_h138477 | 02:17.977–02:18.977 | 02:18.477 | stable | [WAV](clips/sample-077_h138477.wav) | [PNG](plots/sample-077_h138477.png) |
| sample-077_h168484 | 02:47.984–02:48.984 | 02:48.484 | stable | [WAV](clips/sample-077_h168484.wav) | [PNG](plots/sample-077_h168484.png) |

总览：`sample-077-neither-within5-contact.png`

## sample-099

原音频：`F:\Backup\D\osu!\Songs\30569 Cream puff - Mermaid girl\Cream puff - Mermaid girl.mp3`

### full 与 high 都在 ±5 ms（人口 269，抽样 18，权重 14.944444）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-099_h115403 | 01:54.903–01:55.903 | 01:55.403 | stable | [WAV](clips/sample-099_h115403.wav) | [PNG](plots/sample-099_h115403.png) |
| sample-099_h59046 | 00:58.546–00:59.546 | 00:59.046 | stable | [WAV](clips/sample-099_h59046.wav) | [PNG](plots/sample-099_h59046.png) |
| sample-099_h50903 | 00:50.403–00:51.403 | 00:50.903 | stable | [WAV](clips/sample-099_h50903.wav) | [PNG](plots/sample-099_h50903.png) |
| sample-099_h63546 | 01:03.046–01:04.046 | 01:03.546 | stable | [WAV](clips/sample-099_h63546.wav) | [PNG](plots/sample-099_h63546.png) |
| sample-099_h45332 | 00:44.832–00:45.832 | 00:45.332 | stable | [WAV](clips/sample-099_h45332.wav) | [PNG](plots/sample-099_h45332.png) |
| sample-099_h10617 | 00:10.117–00:11.117 | 00:10.617 | stable | [WAV](clips/sample-099_h10617.wav) | [PNG](plots/sample-099_h10617.png) |
| sample-099_h38046 | 00:37.546–00:38.546 | 00:38.046 | stable | [WAV](clips/sample-099_h38046.wav) | [PNG](plots/sample-099_h38046.png) |
| sample-099_h70403 | 01:09.903–01:10.903 | 01:10.403 | stable | [WAV](clips/sample-099_h70403.wav) | [PNG](plots/sample-099_h70403.png) |
| sample-099_h37189 | 00:36.689–00:37.689 | 00:37.189 | stable | [WAV](clips/sample-099_h37189.wav) | [PNG](plots/sample-099_h37189.png) |
| sample-099_h13617 | 00:13.117–00:14.117 | 00:13.617 | stable | [WAV](clips/sample-099_h13617.wav) | [PNG](plots/sample-099_h13617.png) |
| sample-099_h84867 | 01:24.367–01:25.367 | 01:24.867 | stable | [WAV](clips/sample-099_h84867.wav) | [PNG](plots/sample-099_h84867.png) |
| sample-099_h52832 | 00:52.332–00:53.332 | 00:52.832 | stable | [WAV](clips/sample-099_h52832.wav) | [PNG](plots/sample-099_h52832.png) |
| sample-099_h78010 | 01:17.510–01:18.510 | 01:18.010 | stable | [WAV](clips/sample-099_h78010.wav) | [PNG](plots/sample-099_h78010.png) |
| sample-099_h96760 | 01:36.260–01:37.260 | 01:36.760 | stable | [WAV](clips/sample-099_h96760.wav) | [PNG](plots/sample-099_h96760.png) |
| sample-099_h101474 | 01:40.974–01:41.974 | 01:41.474 | stable | [WAV](clips/sample-099_h101474.wav) | [PNG](plots/sample-099_h101474.png) |
| sample-099_h84332 | 01:23.832–01:24.832 | 01:24.332 | stable | [WAV](clips/sample-099_h84332.wav) | [PNG](plots/sample-099_h84332.png) |
| sample-099_h78974 | 01:18.474–01:19.474 | 01:18.974 | stable | [WAV](clips/sample-099_h78974.wav) | [PNG](plots/sample-099_h78974.png) |
| sample-099_h78332 | 01:17.832–01:18.832 | 01:18.332 | stable | [WAV](clips/sample-099_h78332.wav) | [PNG](plots/sample-099_h78332.png) |

总览：`sample-099-both-within5-contact.png`

### 仅 high 在 ±5 ms（人口 2，抽样 2，权重 1.000000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-099_h46189 | 00:45.689–00:46.689 | 00:46.189 | stable | [WAV](clips/sample-099_h46189.wav) | [PNG](plots/sample-099_h46189.png) |
| sample-099_h114010 | 01:53.510–01:54.510 | 01:54.010 | stable | [WAV](clips/sample-099_h114010.wav) | [PNG](plots/sample-099_h114010.png) |

总览：`sample-099-only-high-within5-contact.png`

### 两者都不在 ±5 ms（人口 21，抽样 10，权重 2.100000）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-099_h113153 | 01:52.653–01:53.653 | 01:53.153 | stable | [WAV](clips/sample-099_h113153.wav) | [PNG](plots/sample-099_h113153.png) |
| sample-099_h21546 | 00:21.046–00:22.046 | 00:21.546 | stable | [WAV](clips/sample-099_h21546.wav) | [PNG](plots/sample-099_h21546.png) |
| sample-099_h115189 | 01:54.689–01:55.689 | 01:55.189 | stable | [WAV](clips/sample-099_h115189.wav) | [PNG](plots/sample-099_h115189.png) |
| sample-099_h70939 | 01:10.439–01:11.439 | 01:10.939 | stable | [WAV](clips/sample-099_h70939.wav) | [PNG](plots/sample-099_h70939.png) |
| sample-099_h8903 | 00:08.403–00:09.403 | 00:08.903 | stable | [WAV](clips/sample-099_h8903.wav) | [PNG](plots/sample-099_h8903.png) |
| sample-099_h108010 | 01:47.510–01:48.510 | 01:48.010 | stable | [WAV](clips/sample-099_h108010.wav) | [PNG](plots/sample-099_h108010.png) |
| sample-099_h31189 | 00:30.689–00:31.689 | 00:31.189 | stable | [WAV](clips/sample-099_h31189.wav) | [PNG](plots/sample-099_h31189.png) |
| sample-099_h28082 | 00:27.582–00:28.582 | 00:28.082 | stable | [WAV](clips/sample-099_h28082.wav) | [PNG](plots/sample-099_h28082.png) |
| sample-099_h64082 | 01:03.582–01:04.582 | 01:04.082 | stable | [WAV](clips/sample-099_h64082.wav) | [PNG](plots/sample-099_h64082.png) |
| sample-099_h99760 | 01:39.260–01:40.260 | 01:39.760 | stable | [WAV](clips/sample-099_h99760.wav) | [PNG](plots/sample-099_h99760.png) |

总览：`sample-099-neither-within5-contact.png`

## 填写口径

- `actualOnsetMs` 使用原音频整数毫秒时间轴；`actualOnsetClock` 使用 mm:ss.mmm。
- `confidence` 填 `clear` / `approximate` / `no_clear_onset`。
- 完成后分别计算 precision、输出覆盖率、真实音头 recall 和全部物件 ≤5 ms 正确率，并按各层人口/实际抽样数加权。
- 当前真值栏为空，不能据此宣称 80% 已达成。
