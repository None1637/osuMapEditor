# v550：80% 目标的独立 onset 分层精标

共 90 个物件：003、042、095 各 30 个；每首在三个算法结果层各固定哈希抽 10 个。
图中不显示算法候选 onset 或相位。每段 WAV 为参考前 0.5 秒至后 0.5 秒，保留原声道；单张 PNG 提供 ±80 ms 和 5 ms 刻度。
若物件没有清晰独立 onset，请填 `confidence=no_clear_onset`，不要强填毫秒值。算法分层只用于加权估计，不是真值。

## sample-003

原音频：`F:\Backup\D\osu!\Songs\606995 False Noise - Skyshards\audio.mp3`

### 两种设置都在 ±5 ms（人口 683，抽样 10，权重 68.3）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-003_h18837 | 00:18.337–00:19.337 | 00:18.837 | stable | [WAV](clips/sample-003_h18837.wav) | [PNG](plots/sample-003_h18837.png) |
| sample-003_h252036 | 04:11.536–04:12.536 | 04:12.036 | stable | [WAV](clips/sample-003_h252036.wav) | [PNG](plots/sample-003_h252036.png) |
| sample-003_h39940 | 00:39.440–00:40.440 | 00:39.940 | stable | [WAV](clips/sample-003_h39940.wav) | [PNG](plots/sample-003_h39940.png) |
| sample-003_h194826 | 03:14.326–03:15.326 | 03:14.826 | stable | [WAV](clips/sample-003_h194826.wav) | [PNG](plots/sample-003_h194826.png) |
| sample-003_h249768 | 04:09.268–04:10.268 | 04:09.768 | stable | [WAV](clips/sample-003_h249768.wav) | [PNG](plots/sample-003_h249768.png) |
| sample-003_h260146 | 04:19.646–04:20.646 | 04:20.146 | stable | [WAV](clips/sample-003_h260146.wav) | [PNG](plots/sample-003_h260146.png) |
| sample-003_h251164 | 04:10.664–04:11.664 | 04:11.164 | stable | [WAV](clips/sample-003_h251164.wav) | [PNG](plots/sample-003_h251164.png) |
| sample-003_h32615 | 00:32.115–00:33.115 | 00:32.615 | stable | [WAV](clips/sample-003_h32615.wav) | [PNG](plots/sample-003_h32615.png) |
| sample-003_h226436 | 03:45.936–03:46.936 | 03:46.436 | dense | [WAV](clips/sample-003_h226436.wav) | [PNG](plots/sample-003_h226436.png) |
| sample-003_h85814 | 01:25.314–01:26.314 | 01:25.814 | stable | [WAV](clips/sample-003_h85814.wav) | [PNG](plots/sample-003_h85814.png) |

总览：`sample-003-both-within5-contact.png`

### 仅 5 ms 抑制在 ±5 ms（人口 255，抽样 10，权重 25.5）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-003_h280117 | 04:39.617–04:40.617 | 04:40.117 | stable | [WAV](clips/sample-003_h280117.wav) | [PNG](plots/sample-003_h280117.png) |
| sample-003_h183140 | 03:02.640–03:03.640 | 03:03.140 | stable | [WAV](clips/sample-003_h183140.wav) | [PNG](plots/sample-003_h183140.png) |
| sample-003_h265989 | 04:25.489–04:26.489 | 04:25.989 | stable | [WAV](clips/sample-003_h265989.wav) | [PNG](plots/sample-003_h265989.png) |
| sample-003_h311774 | 05:11.274–05:12.274 | 05:11.774 | stable | [WAV](clips/sample-003_h311774.wav) | [PNG](plots/sample-003_h311774.png) |
| sample-003_h264507 | 04:24.007–04:25.007 | 04:24.507 | stable | [WAV](clips/sample-003_h264507.wav) | [PNG](plots/sample-003_h264507.png) |
| sample-003_h309594 | 05:09.094–05:10.094 | 05:09.594 | stable | [WAV](clips/sample-003_h309594.wav) | [PNG](plots/sample-003_h309594.png) |
| sample-003_h18139 | 00:17.639–00:18.639 | 00:18.139 | stable | [WAV](clips/sample-003_h18139.wav) | [PNG](plots/sample-003_h18139.png) |
| sample-003_h59474 | 00:58.974–00:59.974 | 00:59.474 | stable | [WAV](clips/sample-003_h59474.wav) | [PNG](plots/sample-003_h59474.png) |
| sample-003_h180436 | 02:59.936–03:00.936 | 03:00.436 | stable | [WAV](clips/sample-003_h180436.wav) | [PNG](plots/sample-003_h180436.png) |
| sample-003_h55462 | 00:54.962–00:55.962 | 00:55.462 | stable | [WAV](clips/sample-003_h55462.wav) | [PNG](plots/sample-003_h55462.png) |

总览：`sample-003-only-sup5-within5-contact.png`

### 两种设置都不在 ±5 ms（人口 230，抽样 10，权重 23.0）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-003_h270350 | 04:29.850–04:30.850 | 04:30.350 | stable | [WAV](clips/sample-003_h270350.wav) | [PNG](plots/sample-003_h270350.png) |
| sample-003_h297559 | 04:57.059–04:58.059 | 04:57.559 | stable | [WAV](clips/sample-003_h297559.wav) | [PNG](plots/sample-003_h297559.png) |
| sample-003_h36452 | 00:35.952–00:36.952 | 00:36.452 | stable | [WAV](clips/sample-003_h36452.wav) | [PNG](plots/sample-003_h36452.png) |
| sample-003_h95930 | 01:35.430–01:36.430 | 01:35.930 | stable | [WAV](clips/sample-003_h95930.wav) | [PNG](plots/sample-003_h95930.png) |
| sample-003_h250117 | 04:09.617–04:10.617 | 04:10.117 | stable | [WAV](clips/sample-003_h250117.wav) | [PNG](plots/sample-003_h250117.png) |
| sample-003_h110930 | 01:50.430–01:51.430 | 01:50.930 | stable | [WAV](clips/sample-003_h110930.wav) | [PNG](plots/sample-003_h110930.png) |
| sample-003_h256396 | 04:15.896–04:16.896 | 04:16.396 | stable | [WAV](clips/sample-003_h256396.wav) | [PNG](plots/sample-003_h256396.png) |
| sample-003_h124535 | 02:04.035–02:05.035 | 02:04.535 | stable | [WAV](clips/sample-003_h124535.wav) | [PNG](plots/sample-003_h124535.png) |
| sample-003_h248199 | 04:07.699–04:08.699 | 04:08.199 | stable | [WAV](clips/sample-003_h248199.wav) | [PNG](plots/sample-003_h248199.png) |
| sample-003_h136831 | 02:16.331–02:17.331 | 02:16.831 | stable | [WAV](clips/sample-003_h136831.wav) | [PNG](plots/sample-003_h136831.png) |

总览：`sample-003-neither-within5-contact.png`

## sample-042

原音频：`F:\Backup\D\osu!\Songs\1100768 Kanoguti - How to Destroy Humans [no video]\audio.mp3`

### 两种设置都在 ±5 ms（人口 1039，抽样 10，权重 103.9）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-042_h149346 | 02:28.846–02:29.846 | 02:29.346 | stable | [WAV](clips/sample-042_h149346.wav) | [PNG](plots/sample-042_h149346.png) |
| sample-042_h164667 | 02:44.167–02:45.167 | 02:44.667 | stable | [WAV](clips/sample-042_h164667.wav) | [PNG](plots/sample-042_h164667.png) |
| sample-042_h131223 | 02:10.723–02:11.723 | 02:11.223 | stable | [WAV](clips/sample-042_h131223.wav) | [PNG](plots/sample-042_h131223.png) |
| sample-042_h151274 | 02:30.774–02:31.774 | 02:31.274 | stable | [WAV](clips/sample-042_h151274.wav) | [PNG](plots/sample-042_h151274.png) |
| sample-042_h165417 | 02:44.917–02:45.917 | 02:45.417 | stable | [WAV](clips/sample-042_h165417.wav) | [PNG](plots/sample-042_h165417.png) |
| sample-042_h132973 | 02:12.473–02:13.473 | 02:12.973 | stable | [WAV](clips/sample-042_h132973.wav) | [PNG](plots/sample-042_h132973.png) |
| sample-042_h117973 | 01:57.473–01:58.473 | 01:57.973 | stable | [WAV](clips/sample-042_h117973.wav) | [PNG](plots/sample-042_h117973.png) |
| sample-042_h72542 | 01:12.042–01:13.042 | 01:12.542 | stable | [WAV](clips/sample-042_h72542.wav) | [PNG](plots/sample-042_h72542.png) |
| sample-042_h99924 | 01:39.424–01:40.424 | 01:39.924 | dense | [WAV](clips/sample-042_h99924.wav) | [PNG](plots/sample-042_h99924.png) |
| sample-042_h112307 | 01:51.807–01:52.807 | 01:52.307 | stable | [WAV](clips/sample-042_h112307.wav) | [PNG](plots/sample-042_h112307.png) |

总览：`sample-042-both-within5-contact.png`

### 仅 5 ms 抑制在 ±5 ms（人口 292，抽样 10，权重 29.2）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-042_h75756 | 01:15.256–01:16.256 | 01:15.756 | stable | [WAV](clips/sample-042_h75756.wav) | [PNG](plots/sample-042_h75756.png) |
| sample-042_h53471 | 00:52.971–00:53.971 | 00:53.471 | stable | [WAV](clips/sample-042_h53471.wav) | [PNG](plots/sample-042_h53471.png) |
| sample-042_h137140 | 02:16.640–02:17.640 | 02:17.140 | stable | [WAV](clips/sample-042_h137140.wav) | [PNG](plots/sample-042_h137140.png) |
| sample-042_h64024 | 01:03.524–01:04.524 | 01:04.024 | stable | [WAV](clips/sample-042_h64024.wav) | [PNG](plots/sample-042_h64024.png) |
| sample-042_h42864 | 00:42.364–00:43.364 | 00:42.864 | stable | [WAV](clips/sample-042_h42864.wav) | [PNG](plots/sample-042_h42864.png) |
| sample-042_h64453 | 01:03.953–01:04.953 | 01:04.453 | stable | [WAV](clips/sample-042_h64453.wav) | [PNG](plots/sample-042_h64453.png) |
| sample-042_h96273 | 01:35.773–01:36.773 | 01:36.273 | dense | [WAV](clips/sample-042_h96273.wav) | [PNG](plots/sample-042_h96273.png) |
| sample-042_h97404 | 01:36.904–01:37.904 | 01:37.404 | dense | [WAV](clips/sample-042_h97404.wav) | [PNG](plots/sample-042_h97404.png) |
| sample-042_h27328 | 00:26.828–00:27.828 | 00:27.328 | stable | [WAV](clips/sample-042_h27328.wav) | [PNG](plots/sample-042_h27328.png) |
| sample-042_h57756 | 00:57.256–00:58.256 | 00:57.756 | stable | [WAV](clips/sample-042_h57756.wav) | [PNG](plots/sample-042_h57756.png) |

总览：`sample-042-only-sup5-within5-contact.png`

### 两种设置都不在 ±5 ms（人口 110，抽样 10，权重 11.0）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-042_h16185 | 00:15.685–00:16.685 | 00:16.185 | stable | [WAV](clips/sample-042_h16185.wav) | [PNG](plots/sample-042_h16185.png) |
| sample-042_h73024 | 01:12.524–01:13.524 | 01:13.024 | stable | [WAV](clips/sample-042_h73024.wav) | [PNG](plots/sample-042_h73024.png) |
| sample-042_h105331 | 01:44.831–01:45.831 | 01:45.331 | dense | [WAV](clips/sample-042_h105331.wav) | [PNG](plots/sample-042_h105331.png) |
| sample-042_h106890 | 01:46.390–01:47.390 | 01:46.890 | dense | [WAV](clips/sample-042_h106890.wav) | [PNG](plots/sample-042_h106890.png) |
| sample-042_h100297 | 01:39.797–01:40.797 | 01:40.297 | dense | [WAV](clips/sample-042_h100297.wav) | [PNG](plots/sample-042_h100297.png) |
| sample-042_h139360 | 02:18.860–02:19.860 | 02:19.360 | dense | [WAV](clips/sample-042_h139360.wav) | [PNG](plots/sample-042_h139360.png) |
| sample-042_h33328 | 00:32.828–00:33.828 | 00:33.328 | stable | [WAV](clips/sample-042_h33328.wav) | [PNG](plots/sample-042_h33328.png) |
| sample-042_h67346 | 01:06.846–01:07.846 | 01:07.346 | stable | [WAV](clips/sample-042_h67346.wav) | [PNG](plots/sample-042_h67346.png) |
| sample-042_h62685 | 01:02.185–01:03.185 | 01:02.685 | stable | [WAV](clips/sample-042_h62685.wav) | [PNG](plots/sample-042_h62685.png) |
| sample-042_h22185 | 00:21.685–00:22.685 | 00:22.185 | stable | [WAV](clips/sample-042_h22185.wav) | [PNG](plots/sample-042_h22185.png) |

总览：`sample-042-neither-within5-contact.png`

## sample-095

原音频：`F:\Backup\D\osu!\Songs\530360 Peter Lambert - osu! tutorial v2\audio.mp3`

### 两种设置都在 ±5 ms（人口 647，抽样 10，权重 64.7）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-095_h190107 | 03:09.607–03:10.607 | 03:10.107 | stable | [WAV](clips/sample-095_h190107.wav) | [PNG](plots/sample-095_h190107.png) |
| sample-095_h188844 | 03:08.344–03:09.344 | 03:08.844 | stable | [WAV](clips/sample-095_h188844.wav) | [PNG](plots/sample-095_h188844.png) |
| sample-095_h360658 | 06:00.158–06:01.158 | 06:00.658 | stable | [WAV](clips/sample-095_h360658.wav) | [PNG](plots/sample-095_h360658.png) |
| sample-095_h184633 | 03:04.133–03:05.133 | 03:04.633 | stable | [WAV](clips/sample-095_h184633.wav) | [PNG](plots/sample-095_h184633.png) |
| sample-095_h323581 | 05:23.081–05:24.081 | 05:23.581 | stable | [WAV](clips/sample-095_h323581.wav) | [PNG](plots/sample-095_h323581.png) |
| sample-095_h201371 | 03:20.871–03:21.871 | 03:21.371 | stable | [WAV](clips/sample-095_h201371.wav) | [PNG](plots/sample-095_h201371.png) |
| sample-095_h366196 | 06:05.696–06:06.696 | 06:06.196 | stable | [WAV](clips/sample-095_h366196.wav) | [PNG](plots/sample-095_h366196.png) |
| sample-095_h373235 | 06:12.735–06:13.735 | 06:13.235 | stable | [WAV](clips/sample-095_h373235.wav) | [PNG](plots/sample-095_h373235.png) |
| sample-095_h225695 | 03:45.195–03:46.195 | 03:45.695 | stable | [WAV](clips/sample-095_h225695.wav) | [PNG](plots/sample-095_h225695.png) |
| sample-095_h372081 | 06:11.581–06:12.581 | 06:12.081 | stable | [WAV](clips/sample-095_h372081.wav) | [PNG](plots/sample-095_h372081.png) |

总览：`sample-095-both-within5-contact.png`

### 仅 5 ms 抑制在 ±5 ms（人口 560，抽样 10，权重 56.0）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-095_h382350 | 06:21.850–06:22.850 | 06:22.350 | stable | [WAV](clips/sample-095_h382350.wav) | [PNG](plots/sample-095_h382350.png) |
| sample-095_h232830 | 03:52.330–03:53.330 | 03:52.830 | stable | [WAV](clips/sample-095_h232830.wav) | [PNG](plots/sample-095_h232830.png) |
| sample-095_h281883 | 04:41.383–04:42.383 | 04:41.883 | stable | [WAV](clips/sample-095_h281883.wav) | [PNG](plots/sample-095_h281883.png) |
| sample-095_h183687 | 03:03.187–03:04.187 | 03:03.687 | stable | [WAV](clips/sample-095_h183687.wav) | [PNG](plots/sample-095_h183687.png) |
| sample-095_h310944 | 05:10.444–05:11.444 | 05:10.944 | stable | [WAV](clips/sample-095_h310944.wav) | [PNG](plots/sample-095_h310944.png) |
| sample-095_h199423 | 03:18.923–03:19.923 | 03:19.423 | stable | [WAV](clips/sample-095_h199423.wav) | [PNG](plots/sample-095_h199423.png) |
| sample-095_h178054 | 02:57.554–02:58.554 | 02:58.054 | stable | [WAV](clips/sample-095_h178054.wav) | [PNG](plots/sample-095_h178054.png) |
| sample-095_h267550 | 04:27.050–04:28.050 | 04:27.550 | stable | [WAV](clips/sample-095_h267550.wav) | [PNG](plots/sample-095_h267550.png) |
| sample-095_h39373 | 00:38.873–00:39.873 | 00:39.373 | stable | [WAV](clips/sample-095_h39373.wav) | [PNG](plots/sample-095_h39373.png) |
| sample-095_h188002 | 03:07.502–03:08.502 | 03:08.002 | stable | [WAV](clips/sample-095_h188002.wav) | [PNG](plots/sample-095_h188002.png) |

总览：`sample-095-only-sup5-within5-contact.png`

### 两种设置都不在 ±5 ms（人口 287，抽样 10，权重 28.7）

| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |
|---|---|---|---|---|---|
| sample-095_h367504 | 06:07.004–06:08.004 | 06:07.504 | stable | [WAV](clips/sample-095_h367504.wav) | [PNG](plots/sample-095_h367504.png) |
| sample-095_h356042 | 05:55.542–05:56.542 | 05:56.042 | stable | [WAV](clips/sample-095_h356042.wav) | [PNG](plots/sample-095_h356042.png) |
| sample-095_h234290 | 03:53.790–03:54.790 | 03:54.290 | stable | [WAV](clips/sample-095_h234290.wav) | [PNG](plots/sample-095_h234290.png) |
| sample-095_h268661 | 04:28.161–04:29.161 | 04:28.661 | stable | [WAV](clips/sample-095_h268661.wav) | [PNG](plots/sample-095_h268661.png) |
| sample-095_h361235 | 06:00.735–06:01.735 | 06:01.235 | stable | [WAV](clips/sample-095_h361235.wav) | [PNG](plots/sample-095_h361235.png) |
| sample-095_h386908 | 06:26.408–06:27.408 | 06:26.908 | stable | [WAV](clips/sample-095_h386908.wav) | [PNG](plots/sample-095_h386908.png) |
| sample-095_h260106 | 04:19.606–04:20.606 | 04:20.106 | stable | [WAV](clips/sample-095_h260106.wav) | [PNG](plots/sample-095_h260106.png) |
| sample-095_h230236 | 03:49.736–03:50.736 | 03:50.236 | stable | [WAV](clips/sample-095_h230236.wav) | [PNG](plots/sample-095_h230236.png) |
| sample-095_h280439 | 04:39.939–04:40.939 | 04:40.439 | stable | [WAV](clips/sample-095_h280439.wav) | [PNG](plots/sample-095_h280439.png) |
| sample-095_h377850 | 06:17.350–06:18.350 | 06:17.850 | stable | [WAV](clips/sample-095_h377850.wav) | [PNG](plots/sample-095_h377850.png) |

总览：`sample-095-neither-within5-contact.png`

## 填写口径

- `actualOnsetMs` 使用原音频整数毫秒时间轴；`actualOnsetClock` 使用 mm:ss.mmm。
- `confidence` 填 `clear` / `approximate` / `no_clear_onset`。
- 完成后分别计算有清晰 onset 与全部物件的 ≤5 ms 命中率，并按各层人口/抽样权重还原总体。
- 当前真值栏为空，不能据此宣称 80% 已达成。
