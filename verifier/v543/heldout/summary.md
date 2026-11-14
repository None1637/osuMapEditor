# v543-heldout：100 首第二组留出集验收

## 结论先行

- **主 BPM 严格正确：78 / 100（78%）**。
- **恒速/变速分类正确：86 / 100（86%）**。
- **两项同时正确：72 / 100（72%）**。
- 恒速 83 首中 81 首未报变速；变速 17 首中 5 首检出变速。
- 记录完整：是；当前算法哈希与抽样时冻结值一致：否。

> 真值来自随机难度谱面的正 uninherited 红线，不等于人工声学金标准。主分母固定为 100，解码失败和无结果不剔除。严格 BPM 容差为相对误差 ≤0.2%；倍程单列，不算严格正确。

## 混淆矩阵

| 谱面真值 \ 算法输出 | 恒速 | 变速 | 无结果 |
|---|---:|---:|---:|
| 恒速 | 81 | 1 | 1 |
| 变速 | 11 | 5 | 1 |
| 无有效红线 | 0 | 0 | 0 |

## 分层指标

| 子集 | 数量 | 主 BPM 严格正确 | 分类正确 | 两项同时正确 |
|---|---:|---:|---:|---:|
| 恒速 | 83 | 70（84.3%） | 81（97.6%） | 70（84.3%） |
| 变速 | 17 | 8（47.1%） | 5（29.4%） | 2（11.8%） |

- 可评估子集 98 首：主 BPM 78，分类 86，联合 72；此口径只作补充。
- 状态统计：`{"ok":98,"decode_unavailable":2}`。

## 与开发集重叠及敏感性

- 第二组有 1 首歌曲目录也出现在开发集，因此严格说只有 99 首目录级未重叠样本；不把它隐去。
- 排除重叠样本后：主 BPM 77 / 99（77.8%），分类 85 / 99（85.9%），联合 71 / 99（71.7%）。

## 未同时正确的样本（28）

| ID | 歌曲目录 | 标注 BPM | 输出 BPM | 标注分类 | 输出分类 | 类型 |
|---|---|---:|---:|---|---|---|
| sample-004 | 510859 Camellia - chrono diver -fragment- (Camellia's crossroads of chrono remix) | 72.500 | — | 变速 | — | decode_unavailable |
| sample-012 | 196171 xxdbxx - Taekwonburi | 162.000 | — | 恒速 | — | decode_unavailable |
| sample-019 | Sokoninaru_-_Gou_Ni_Moyu | 300.000 | 150.100 | 变速 | 恒速 | bpm_and_classification_error |
| sample-026 | 116310 Chata - enn ~fuchi~ | 246.000 | 123.050 | 恒速 | 恒速 | octave_error |
| sample-032 | 1068163 Celldweller - Lost In Time | 105.000 | 210.000 | 恒速 | 恒速 | octave_error |
| sample-034 | 1011935 Lil Boom - Already Dead instrumental | 111.600 | 223.200 | 恒速 | 恒速 | octave_error |
| sample-035 | 267779 | 180.000 | 180.000 | 变速 | 恒速 | variable_false_negative |
| sample-036 | 1217337 Kamiyama Yoh - bunny | 128.000 | 128.000 | 变速 | 恒速 | variable_false_negative |
| sample-037 | 1640503 Various Artists - deleted vibro maps minipack | 119.000 | 237.800 | 恒速 | 恒速 | octave_error |
| sample-038 | 404447 Two Steps From Hell - Winterspell (Nightcore Mix) | 160.300 | 120.200 | 恒速 | 变速 | bpm_and_classification_error |
| sample-041 | Kagamine Rin - Antichlorobenzene | 132.000 | 66.000 | 变速 | 变速 | octave_error |
| sample-050 | 1756972 ReeK - SUPER SEX DELIVERY 2 - ENTER THE CUM ZONE | 150.000 | 74.900 | 变速 | 恒速 | bpm_and_classification_error |
| sample-051 | 1055134 UNDEAD CORPORATION - The Empress scream off ver | 270.000 | 135.000 | 恒速 | 恒速 | octave_error |
| sample-059 | 2056719 Noctem - Dichotomy of Malignancy | 200.000 | 198.950 | 变速 | 恒速 | bpm_and_classification_error |
| sample-060 | 9137 SHK - Death Moon | 160.000 | 159.550 | 变速 | 恒速 | bpm_and_classification_error |
| sample-062 | 1015663 Roselia - Ringing Bloom | 195.000 | 195.000 | 变速 | 恒速 | variable_false_negative |
| sample-065 | 303649 LiSA - Rally Go Round -TV ver- | 190.000 | 189.400 | 恒速 | 恒速 | bpm_error |
| sample-066 | 456922 Saki & Rie fu - You & Me | 128.000 | 128.000 | 变速 | 恒速 | variable_false_negative |
| sample-068 | 682351 Aqours - Yuki wa Doko ni Kimi no Mune ni! | 167.000 | 167.000 | 变速 | 恒速 | variable_false_negative |
| sample-073 | 687129 Noah - Celestial stinger | 259.000 | 129.500 | 恒速 | 恒速 | octave_error |
| sample-083 | 532381 Various Artists - osu! Jump Compilation | 198.000 | 174.000 | 变速 | 变速 | bpm_error |
| sample-084 | 2451953 omekyu - omekyu accordion | 231.000 | 115.700 | 变速 | 恒速 | bpm_and_classification_error |
| sample-085 | 193057 UNDEAD CORPORATION - Magus night fever | 280.000 | 140.000 | 恒速 | 恒速 | octave_error |
| sample-086 | beatmap-ZUN - Taketorihisyou ~ Lunatic Princess | 152.000 | 154.000 | 变速 | 变速 | bpm_error |
| sample-087 | 156937 LAST ALLIANCE - HEKIREKI (TV Size) | 129.000 | 120.800 | 恒速 | 恒速 | bpm_error |
| sample-089 | 329149 t+pazolite - Buzy Lake (An Remix) | 200.000 | 200.000 | 变速 | 恒速 | variable_false_negative |
| sample-098 | 1454773 Calliope Mori - Excuse My Rudeness, But Could You Please RIP 3 (t+pazolite Remix) | 260.000 | 130.000 | 恒速 | 恒速 | octave_error |
| sample-099 | 44222 Mr Funky - Break! | 167.000 | 167.500 | 恒速 | 恒速 | bpm_error |

## 边界

- evidence 是粗略 4 秒窗区间，不是精确红线；本轮不验收 offset 或变速边界。
- 60–240 BPM 归一先验会折叠范围外 BPM，仍按严格口径算错。
- 独立集只验收，没有根据其失败样本回调阈值。
