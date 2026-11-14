# v543-frozen-dev：100 首冻结开发集复测

## 结论先行

- **主 BPM 严格正确：79 / 100（79%）**。
- **恒速/变速分类正确：81 / 100（81%）**。
- **两项同时正确：67 / 100（67%）**。
- 恒速 81 首中 78 首未报变速；变速 19 首中 3 首检出变速。
- 记录完整：是；当前算法哈希与抽样时冻结值一致：否。

> 真值来自随机难度谱面的正 uninherited 红线，不等于人工声学金标准。主分母固定为 100，解码失败和无结果不剔除。严格 BPM 容差为相对误差 ≤0.2%；倍程单列，不算严格正确。

## 混淆矩阵

| 谱面真值 \ 算法输出 | 恒速 | 变速 | 无结果 |
|---|---:|---:|---:|
| 恒速 | 78 | 1 | 2 |
| 变速 | 16 | 3 | 0 |
| 无有效红线 | 0 | 0 | 0 |

## 分层指标

| 子集 | 数量 | 主 BPM 严格正确 | 分类正确 | 两项同时正确 |
|---|---:|---:|---:|---:|
| 恒速 | 81 | 66（81.5%） | 78（96.3%） | 66（81.5%） |
| 变速 | 19 | 13（68.4%） | 3（15.8%） | 1（5.3%） |

- 可评估子集 98 首：主 BPM 79，分类 81，联合 67；此口径只作补充。
- 状态统计：`{"ok":98,"decode_unavailable":2}`。

## 相对 v541 基线

- 主 BPM：79 → 79。
- 分类：49 → 81。
- 联合：41 → 67。

## 三首人工复核（不覆盖上述红线指标）

| ID | 人工真值 | 当前输出 | BPM 符合 | 分类符合 |
|---|---|---|---|---|
| sample-032 | 108.000 / 恒速 | 216.000 / 恒速 | 否 | 是 |
| sample-034 | 135.000 / 恒速 | 135.000 / 恒速 | 是 | 是 |
| sample-088 | 175.000 / 恒速 | 175.000 / 恒速 | 是 | 是 |

## 未同时正确的样本（33）

| ID | 歌曲目录 | 标注 BPM | 输出 BPM | 标注分类 | 输出分类 | 类型 |
|---|---|---:|---:|---|---|---|
| sample-001 | 673574 Camellia - Shun no Shifudo o Ikashita Kare Fumi Paeria | 220.000 | 220.000 | 变速 | 恒速 | variable_false_negative |
| sample-002 | 2242341 TRUE - Blast! | 179.000 | 178.550 | 变速 | 恒速 | bpm_and_classification_error |
| sample-003 | 606995 False Noise - Skyshards | 172.000 | 172.000 | 变速 | 恒速 | variable_false_negative |
| sample-007 | 7158 Liverne - Necrofantasia | 180.000 | 180.000 | 变速 | 恒速 | variable_false_negative |
| sample-010 | 1220647 osu!mania 7K Dan Course - LN Dan Phase III | 190.000 | 199.900 | 变速 | 恒速 | bpm_and_classification_error |
| sample-014 | 828088 DJ Seven - Charon | 116.667 | 232.700 | 恒速 | 恒速 | bpm_error |
| sample-017 | 1510535 65daysofstatic - Retreat! Retreat! (Cut Ver) | 195.000 | 195.100 | 变速 | 恒速 | variable_false_negative |
| sample-021 | 500905 The Quick Brown Fox - Break | 247.000 | 123.500 | 恒速 | 恒速 | octave_error |
| sample-025 | 1817787 SOUND HOLIC feat Nana Takahashi - Chinmoku ~Cercueil no Shoujo~ | 140.000 | 140.000 | 变速 | 恒速 | variable_false_negative |
| sample-026 | 847400 CHS - Interlude - teatime | 100.000 | 200.000 | 恒速 | 恒速 | octave_error |
| sample-027 | 76934 SYNCART'S - Innocent doll | 80.000 | 80.000 | 变速 | 恒速 | variable_false_negative |
| sample-028 | 1408765 Synth Monsters_Senri_SADRECORDS - GAMER | 256.000 | — | 恒速 | — | decode_unavailable |
| sample-032 | 149527 Ito Kanako - Sky of Twilight | 108.000 | 216.000 | 恒速 | 恒速 | octave_error |
| sample-040 | 29183 ZUN - Night Sakura of Dead Spirits | 147.000 | 147.000 | 变速 | 恒速 | variable_false_negative |
| sample-043 | 157896 Meg & Dia - Monster (DotEXE Remix) | 140.000 | 62.400 | 恒速 | 变速 | bpm_and_classification_error |
| sample-045 | 1128596 Silentroom - NULCTRL EX | 100.000 | 200.000 | 恒速 | 恒速 | octave_error |
| sample-050 | 1787128 Chiro, Kotono, Hiyorin - My Dream Kingdom! | 120.000 | 239.900 | 恒速 | 恒速 | octave_error |
| sample-054 | osu!droid Daninintei 7th Dan Courses | 254.000 | 240.000 | 变速 | 变速 | bpm_error |
| sample-058 | 1820368 Natsu - Regression | 190.000 | 190.000 | 变速 | 恒速 | variable_false_negative |
| sample-059 | 820771 C&K - Nirv lucE | 260.000 | 130.000 | 变速 | 恒速 | bpm_and_classification_error |
| sample-064 | 558041 Kanae Asaba - Endless Starlight ~Inochi no Kirameki~ (OP ver) | 181.000 | 179.600 | 恒速 | 恒速 | bpm_error |
| sample-067 | 732851 LeaF - Lyrith | 177.000 | 177.050 | 变速 | 恒速 | variable_false_negative |
| sample-072 | 20125 Demetori - Solar Sect of Mystic Wisdom ~ Nuclear Fusion | 173.000 | 173.000 | 变速 | 恒速 | variable_false_negative |
| sample-077 | 967321 Tokyo Jihen - Sounan | 156.000 | 155.400 | 变速 | 恒速 | bpm_and_classification_error |
| sample-083 | 845720 OSU! - PACK 9 | 252.000 | 63.000 | 恒速 | 恒速 | octave_error |
| sample-084 | 64839 Misato Aki - DESIRE (Short Ver) | 119.000 | 238.000 | 恒速 | 恒速 | octave_error |
| sample-087 | shinra-bansho - itazura sensation | 192.000 | — | 恒速 | — | decode_unavailable |
| sample-090 | 1930076 Lime - BEYOND | 276.000 | 138.000 | 恒速 | 恒速 | octave_error |
| sample-091 | 761046 Dave Rodgers - Deja Vu | 154.000 | 154.000 | 变速 | 恒速 | variable_false_negative |
| sample-092 | Lindwurm | 280.000 | 139.950 | 恒速 | 恒速 | octave_error |
| sample-095 | 530360 Peter Lambert - osu! tutorial v2 | 155.000 | 160.400 | 变速 | 变速 | bpm_error |
| sample-096 | 450885 Aimer - REI AM | 72.000 | 143.950 | 恒速 | 恒速 | octave_error |
| sample-100 | 9394 dj TAKA - Absolute | 144.000 | 144.000 | 变速 | 恒速 | variable_false_negative |

## 边界

- evidence 是粗略 4 秒窗区间，不是精确红线；本轮不验收 offset 或变速边界。
- 60–240 BPM 归一先验会折叠范围外 BPM，仍按严格口径算错。
- 独立集只验收，没有根据其失败样本回调阈值。
