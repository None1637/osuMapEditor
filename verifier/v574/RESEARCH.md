# v574：18 张用户指定谱面的物件 onset 精度验收

## 结论

**当前冻结的 `legacyResidual` 管线在用户指定的 18 张谱面、24,416 个物件上取得 88.5444% 的 ±5 ms 总体正确率（21,619 / 24,416），达到“总体至少 80%”目标。**

该结果使用谱面物件开始时间作为参考，不使用此前的视觉盲标，也不使用同曲真值中位数校准。缺失候选有 173 个，全部计为不正确；候选覆盖率为 99.2914%。已匹配候选的绝对误差中位数为 1.9020 ms，p95 为 6.3204 ms。

这不是“每张谱面都达到 80%”：case-009、case-010、低 BPM 的 case-017 和极端变速的 case-018 低于 80%。生产 BPM 代码未修改，本轮只新增验证器与冻结样本。

## 数据与参考真值

- 用户明确提供 18 张谱面，并说明这些谱面所有物件 offset 的准确率超过 90%。这是用户提供的参考依据，不是重新听音标注得到的 100% 精确声学真值。
- 所有谱面和对应音频均已复制到工作区；文件 SHA-256 已冻结并复核。
- 每条 `[HitObjects]` 记录的开始时间都进入分母，包括 slider/spinner 的开始时间。本批谱面的物件记录数与唯一时间点数量相同，共 24,416 个，没有因去重而减少样本。
- 音频通过项目 Electron 的 `AudioContext.decodeAudioData` 解码为 11025 Hz PCM，与应用浏览器解码路径一致。
- 主指标：全部 18 张谱面物件微平均；候选绝对音频时间与谱面物件开始时间相差不超过 ±5 ms 为正确，缺候选不正确。单曲和特殊标签只作描述，不改变总体门槛。

## 方法

冻结的 `legacyResidual` 使用谱面红线区段和物件时间作为定位输入，从音频估计全曲延迟与局部相位：

```text
oldTarget = objectTime + globalDelay + oppositeFoldPhase
oldPeak = oldTarget ±10 ms 内最近的 full onset 峰；并列取较早峰
candidate = oldPeak - globalDelay - oppositeFoldPhase
error = candidate - objectTime
```

full 峰采用 256 samples 窗口、11 samples hop、0.02 阈值、5 ms 抑制半径、抛物线插值和时间补偿。该方法不读取视觉 onset 标签，也不使用同曲参考真值拟合 correction。

同时保留两个对照：

- `e5Calibrated`：使用同曲另一折的谱面参考时间估计中位数 correction，总体 84.8460%。它有同曲参考校准，不是完全无真值校准的部署结果。
- `e13CorrectedTargetRematch`：先平移选峰中心、再取绝对峰，总体 64.1383%，本测试集上不应替代 legacyResidual。

## 总体结果

| 方法 | 正确数 / 总物件数 | 总体 ±5 ms 正确率 | 缺候选 | 候选覆盖率 | 是否达到 80% |
|---|---:|---:|---:|---:|---|
| legacyResidual | 21,619 / 24,416 | **88.5444%** | 173 | 99.2914% | **是** |
| e5Calibrated | 20,716 / 24,416 | 84.8460% | 173 | 99.2914% | 是 |
| e13CorrectedTargetRematch | 15,660 / 24,416 | 64.1383% | 1,306 | 94.6510% | 否 |

## 每张谱面的 legacyResidual 结果

| 样本 | 谱面简称 | ±5 ms 正确率 |
|---|---|---:|
| case-001 | Fantastic Polygon | 93.7842% |
| case-002 | sink to the deep sea world | 94.8786% |
| case-003 | Crystalia | 82.3529% |
| case-004 | For You the Bellz Toll | 90.8235% |
| case-005 | VENTEN | 93.6364% |
| case-006 | FIRST DREAMS | 90.4714% |
| case-007 | Xronial Xero | 91.1739% |
| case-008 | Soylentize | 93.5969% |
| case-009 | Uraomote Lovers | 77.6451% |
| case-010 | The Flight Of The Bumble Bee | 65.0659% |
| case-011 | Heian Alien | 92.7089% |
| case-012 | R31 L0V3 C0R3 | 90.1650% |
| case-013 | northern_limit | 93.2031% |
| case-014 | Amakaze no Matsuri | 82.8054% |
| case-015 | Enka - flameflower | 93.1944% |
| case-016 | overture | 85.8447% |
| case-017 | Yu Ai（用户指定低 BPM） | 75.8691% |
| case-018 | 64bits 32bits 16bits 8bits（用户指定极端变速） | 71.0216% |

## 独立复验

`check-results.py` 未采用 `analyze.py` 的汇总结论，而是重新读取谱面副本、冻结相位和 full 峰，逐物件重建三种候选，并检查：

1. 18 张谱面与音频的 SHA-256；
2. 24,416 个谱面参考时间及唯一 ID；
3. 每声道 PCM 字节数与解码元数据；
4. 最近峰、反折相位、绝对候选和误差；
5. 173 个 legacy 缺失候选计入错误；
6. `onset-comparison.csv` 的全部 24,416 行；
7. overall、perSample、specialTags 的全部统计；
8. legacy 正确数与原 TypeScript 基线的 21,619 完全一致。

复验标记：`V574_RESULT_VALIDATION_PASSED`。

## 限制

- 88.5444% 是相对于用户指定谱面物件时间的正确率；谱面参考自身并非逐音听感精标，因此不能解释为对绝对声学音头的严格 88.5444%。
- 此任务是给定谱面物件与红线后的 onset 精修，不是从无谱面音频自动生成全部物件。
- 总体达标不代表每首达标，也不代表 E13 在上一批视觉标签或新测试集上可靠。
- 没有必要为本次“总体 80%”目标继续调参；若后续提升低 BPM、极端变速或 case-010，应另开实验并保留本版作为基线。
