# v555：多频带与上升沿候选的留一曲验证

## 结论先行

固定全频带峰值基线：clear recall **68.53%**，clear+approx recall **74.20%**。
留一曲选配置后的交叉验证：clear recall **86.11%**，clear+approx recall **88.58%**，precision **46.98%**。
配置只在另外两首上选择；第三首不参与选参。全标签最优仅作诊断，不能作为验证精度。

虽然音头 recall 超过 80%，候选 precision 仍为 **46.98%**，全物件正确率仅 **46.01%**；大量 no_clear_onset 误输出尚未解决，不能把本轮结果当作目标完成。

## 验证方式纠错

初轮 NumPy 重实现有 2/90 个物件未复现原候选，其中一个偏差约 8.27 ms，因此初轮数值全部作废。最终改用项目 TypeScript DSP 后，90/90 候选存在性一致，最大时间差为 0 ms，才重新计算下列结果。

| held-out | 训练选择配置 | held-out clear recall | held-out clear+approx recall | held-out precision | 输出覆盖率 |
|---|---|---:|---:|---:|---:|
| sample-003 | high-peak | 70.72% | 81.91% | 40.15% | 93.66% |
| sample-042 | high-peak | 97.11% | 94.93% | 43.22% | 99.24% |
| sample-095 | high-peak | 88.00% | 87.99% | 55.59% | 100.00% |

## 全标签事后最优（仅诊断）

配置 `high-peak`：clear recall **86.11%**，clear+approx recall **88.58%**，precision **46.98%**。

## 验证限制

仅三首、90 个 provisional 视觉标签，留一曲仍是内部探索而非新样本验收。上升沿可能改善时间定位，也可能提前到前一纹理；必须看各折是否一致，不能只看全标签最优。目标状态保持未完成。
