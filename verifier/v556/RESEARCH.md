# v556：high-peak 单特征置信门控

## 结论先行

无门控基线：precision **46.98%**，clear+approx recall **88.58%**。
留一曲门控：precision **44.92%**，clear+approx recall **71.39%**，clear recall **74.93%**，输出覆盖率 **82.55%**。
no_clear 原候选拒绝率 **12.94%**。门控同时报告 precision、recall 和覆盖率，不靠拒答隐藏损失。

| held-out | 训练门控 | 训练recall约束 | held-out precision | held-out clear+approx recall | no_clear拒绝率 |
|---|---|---|---:|---:|---:|
| sample-003 | `signedDistanceMs >= -1.85435` | True | 44.94% | 81.91% | 18.49% |
| sample-042 | `signedDistanceMs >= -1.74861` | True | 36.47% | 58.53% | 17.58% |
| sample-095 | `peakToLocalMean <= 4.8129` | True | 51.38% | 74.28% | 0.00% |

## 全标签事后最优（仅诊断）

`signedDistanceMs >= -1.85435`：precision **54.94%**，clear+approx recall **83.23%**，no_clear拒绝率 **29.57%**。

## 限制

仅三首、90 个 provisional 视觉标签；单特征阈值也可能过拟合。全标签结果不是验证精度，目标状态保持未完成。
