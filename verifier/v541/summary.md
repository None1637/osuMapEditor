# v541：100 首随机样本冻结算法实测

## 结论先行

- **主 BPM 严格正确率：79 / 100（79%）**，容差为相对误差 ≤ 0.2%。
- **恒速/变速分类准确率：49 / 100（49%）**。
- **两项同时正确率：41 / 100（41%）**。
- 仅倍程不同、但未达到严格正确的样本为 **11 首**，没有混入严格正确率。
- 样本与算法完整冻结：100 首均已有评估记录；算法哈希未变化。

> 正确率以随机选中的 `.osu` 谱面红线为基准，不等于人工听音声学金标准；谱面简化或标错会被计为算法错误。主分母固定为 100，复制/解码失败、无有效红线、空结果均保留。

## 抽样与判定口径

- 来源：`F:\Backup\D\osu!\Songs`；固定种子 540，随机排列歌曲目录后取前 100 个含 .osu 的目录。
- 每个目录随机选一个难度；主 BPM 真值为正 uninherited 红线按实际覆盖时长加权后的主导 BPM。
- 任一红线 BPM 与主导 BPM 相差 > 2% 即标注为变速；同 BPM 相位重置不算变速。
- 严格 BPM 容差 ≤ 0.2%；2×/0.5× 等倍程结果只单列，不算严格正确。本轮不评估 offset 和变速边界。

## 覆盖与分类混淆矩阵

- 有效谱面红线：100 / 100；成功产生算法结果且有真值：98 / 100。
- 谱面标注恒速 81，变速 19，无效 0；主 BPM <60：0，>240：7。

| 谱面真值 \ 算法输出 | 恒速 | 变速 | 无结果 |
|---|---:|---:|---:|
| 恒速 | 32 | 47 | 2 |
| 变速 | 2 | 17 | 0 |
| 无有效红线 | 0 | 0 | 0 |

## 按初期目标分层

| 谱面子集 | 数量 | 主 BPM 严格正确 | 分类正确 | 两项同时正确 |
|---|---:|---:|---:|---:|
| 恒速 | 81 | 66 / 81（81.5%） | 32 / 81（39.5%） | 29 / 81（35.8%） |
| 变速 | 19 | 13 / 19（68.4%） | 17 / 19（89.5%） | 12 / 19（63.2%） |

恒速歌曲排除 2 首音频不可用后，主 BPM 为 66 / 79（83.5%）。变速歌曲的 17 / 19 是检出率，恒速歌曲的 32 / 81 是未报变速比例；变速歌曲的主 BPM 仅是与时长加权参考值比较，不代表各段红线准确。

可评估子集（不作为主指标，失败已从此处分母排除）：

- 主 BPM：79 / 98（80.6%）。
- 变速分类：49 / 98（50%）。
- 两项同时正确：41 / 98（41.8%）。

## 状态与失败类型

```json
{
  "statusCounts": {
    "ok": 98,
    "decode_unavailable": 2
  },
  "categoryCounts": {
    "correct": 41,
    "bpm_error": 6,
    "variable_false_positive": 37,
    "bpm_and_classification_error": 11,
    "octave_error": 2,
    "decode_unavailable": 2,
    "variable_false_negative": 1
  }
}
```

## 未同时正确的样本（59）

| ID | 歌曲目录 | 标注 BPM | 输出 BPM | 相对误差 | 标注分类 | 输出分类 | 类型 |
|---|---|---:|---:|---:|---|---|---|
| sample-002 | 2242341 TRUE - Blast! | 179.000 | 178.550 | 0.251% | 变速 | 变速 | bpm_error |
| sample-004 | 1256680 Mori Calliope - Excuse My Rudeness, But Could You Please RIP | 124.000 | 124.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-005 | 1193063 BAND-MAID - RINNE | 190.000 | 190.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-006 | 886126 Brandy - Cross Time | 160.000 | 160.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-008 | 333015 Nakae Mitsuki Shimotsuki Haruka - collage | 178.000 | 178.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-009 | 623665 Hommarju - HYENA | 178.000 | 178.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-010 | 1220647 osu!mania 7K Dan Course - LN Dan Phase III | 190.000 | 199.900 | 5.211% | 变速 | 变速 | bpm_error |
| sample-012 | 1822924 Unknown Artist - Yatsume Ana (33 mins) | 130.000 | 130.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-013 | 749327 MY FIRST STORY - Shissou FLAME | 210.000 | 210.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-014 | 828088 DJ Seven - Charon | 116.667 | 232.700 | 99.457% | 恒速 | 变速 | bpm_and_classification_error |
| sample-015 | 1780278 DJ Myosuke & Laur - Break Through Myself feat Risa Yuzuki (Short Ver) | 200.000 | 200.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-016 | 333823 My Chemical Romance - You Know What They Do To Guys Like Us In Prison | 186.000 | 186.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-020 | 42242 senya - Tsuki ni Murakumo Hana ni Kaze (Short Ver) | 160.000 | 160.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-021 | 500905 The Quick Brown Fox - Break | 247.000 | 123.500 | 50.000% | 恒速 | 恒速 | octave_error |
| sample-024 | 205022 Ryu_ - Sakura Mirage | 187.000 | 187.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-026 | 847400 CHS - Interlude - teatime | 100.000 | 200.000 | 100.000% | 恒速 | 恒速 | octave_error |
| sample-028 | 1408765 Synth Monsters_Senri_SADRECORDS - GAMER | 256.000 | — | — | 恒速 | — | decode_unavailable |
| sample-030 | 10860 Haru - Children Festival (Instrumental) | 140.000 | 140.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-032 | 149527 Ito Kanako - Sky of Twilight | 108.000 | 216.000 | 100.000% | 恒速 | 变速 | bpm_and_classification_error |
| sample-034 | 1336953 Various Artists - Julaaaan's Triangle Jump Training | 135.000 | 135.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-035 | 1686033 HOYO-MiX - Termination of Desires | 144.000 | 144.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-036 | 194921 Amane - Space Time (Amane Hardcore Remix) | 175.000 | 175.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-039 | 770246 Rabbit House - Final Overtake | 196.000 | 196.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-041 | 191429 C-Show - UNOwen wa kanojo nanoka (TO-HOlic mix) | 220.000 | 220.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-043 | 157896 Meg & Dia - Monster (DotEXE Remix) | 140.000 | 62.400 | 55.429% | 恒速 | 变速 | bpm_and_classification_error |
| sample-045 | 1128596 Silentroom - NULCTRL EX | 100.000 | 200.000 | 100.000% | 恒速 | 变速 | bpm_and_classification_error |
| sample-046 | 407447 Amane - Space Time (Amane Hardcore Remix) | 175.000 | 175.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-047 | 260551 t+pazolite - Rumble Kung-fu Showdown | 240.000 | 240.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-049 | 190529 Junk - Aihana (Love+ Edit) | 140.000 | 140.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-050 | 1787128 Chiro, Kotono, Hiyorin - My Dream Kingdom! | 120.000 | 239.900 | 99.917% | 恒速 | 变速 | bpm_and_classification_error |
| sample-052 | 916257 GYARI - Akari ga Yatte Kita Zo (Cut Ver) | 136.000 | 136.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-053 | 25671 NieN - Leave me Alone | 236.000 | 236.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-054 | osu!droid Daninintei 7th Dan Courses | 254.000 | 240.000 | 5.512% | 变速 | 变速 | bpm_error |
| sample-059 | 820771 C&K - Nirv lucE | 260.000 | 130.000 | 50.000% | 变速 | 恒速 | bpm_and_classification_error |
| sample-062 | 293475 Renard vs Kitsune^2 - The Castle | 200.000 | 200.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-063 | senya - otogibanashi no karakuri ha, | 134.000 | 134.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-064 | 558041 Kanae Asaba - Endless Starlight ~Inochi no Kirameki~ (OP ver) | 181.000 | 179.600 | 0.773% | 恒速 | 恒速 | bpm_error |
| sample-065 | 770829 Roselia - Guren no Yumiya | 181.000 | 181.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-069 | 186443 Liberatus - Doll's Garden | 160.000 | 160.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-070 | 1558408 Mori Calliope - Excuse My Rudeness, But Could You Please RIP (Nhato Remix) | 130.000 | 130.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-073 | Mutsuhiko Izumi - Snow Goose (13) | 200.000 | 200.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-075 | 833927 Weird Al Yankovic - Hardware Store | 126.330 | 126.350 | 0.016% | 恒速 | 变速 | variable_false_positive |
| sample-077 | 967321 Tokyo Jihen - Sounan | 156.000 | 155.400 | 0.385% | 变速 | 变速 | bpm_error |
| sample-078 | 516824 Umeboshi Chazuke - Owari to Hajimari no Oto | 201.000 | 201.050 | 0.025% | 恒速 | 变速 | variable_false_positive |
| sample-081 | 506155 Ayalis - Ai o Chikaishi Hime Kazari | 210.000 | 209.950 | 0.024% | 恒速 | 变速 | variable_false_positive |
| sample-082 | beatmap-637195271310242821-Oomori Seiko - JUSTadICE (TV Size) | 185.000 | 185.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-083 | 845720 OSU! - PACK 9 | 252.000 | 63.000 | 75.000% | 恒速 | 变速 | bpm_and_classification_error |
| sample-084 | 64839 Misato Aki - DESIRE (Short Ver) | 119.000 | 238.000 | 100.000% | 恒速 | 变速 | bpm_and_classification_error |
| sample-085 | 135070 DragonForce - Fury Of The Storm | 210.000 | 210.250 | 0.119% | 恒速 | 变速 | variable_false_positive |
| sample-087 | shinra-bansho - itazura sensation | 192.000 | — | — | 恒速 | — | decode_unavailable |
| sample-088 | 1159269 Zekk - SUMMER | 175.000 | 175.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-089 | 722744 Camellia - put' l'da | 200.000 | 200.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-090 | 1930076 Lime - BEYOND | 276.000 | 138.000 | 50.000% | 恒速 | 变速 | bpm_and_classification_error |
| sample-091 | 761046 Dave Rodgers - Deja Vu | 154.000 | 154.000 | 0.000% | 变速 | 恒速 | variable_false_negative |
| sample-092 | Lindwurm | 280.000 | 139.950 | 50.018% | 恒速 | 变速 | bpm_and_classification_error |
| sample-093 | 29616 NAOKI feat Becky Lucinda - My Only Shining Star (Remix) | 145.000 | 145.000 | 0.000% | 恒速 | 变速 | variable_false_positive |
| sample-095 | 530360 Peter Lambert - osu! tutorial v2 | 155.000 | 160.400 | 3.484% | 变速 | 变速 | bpm_error |
| sample-096 | 450885 Aimer - REI AM | 72.000 | 143.950 | 99.931% | 恒速 | 变速 | bpm_and_classification_error |
| sample-098 | 14853 COOL&CREATE - Saishoukichiku Imouto Flandre S | 200.000 | 200.000 | 0.000% | 恒速 | 变速 | variable_false_positive |

## 结果解释边界

- `variable_false_positive/negative` 只表示与谱面红线分类不一致，不能单凭此项证明声学误报/漏报。
- 当前 60–240 BPM 归一先验会折叠更高或更低的标注；这些仍按严格口径算错。
- evidence 是 4 秒分析窗的粗略区间，本轮没有把它当精确红线验收。
- 逐样本完整数据见 `results.jsonl`，随机清单及算法哈希见 `manifest.json`，机器可读统计见 `metrics.json`。
