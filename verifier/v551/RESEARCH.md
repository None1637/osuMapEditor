# v551：仅 5 ms 抑制命中层的盲看精标结果

## 结论先行

30 个分歧物件已先按隐藏候选的波形/谱通量图标注，再揭示候选残差。结果为 **clear 8、approximate 2、no_clear_onset 20**。

- 5 ms 候选对 clear 音头达到 ±5 ms：**5/8**。
- 把 approximate 也纳入：候选达到 ±5 ms：**6/10**。
- 若算法对每个候选都输出物件音头，并将 no_clear_onset 的候选计为错误，则该层候选精度代理为 **6/30**；当前 20 ms 设置为 0/30。
- 该层不能支持‘降低峰抑制即可达到真实 80%’。多数新增候选附近没有可独立确认的物件音头。
- 这些是 provisional 视觉精标，不是所有者听辨确认；且只覆盖一个分层，不能推算全曲 80% 是否完成。

## 分层汇总

| 候选 | clear ±5 ms | clear+approx ±5 ms | no_clear 中仍给候选 | 全30候选精度代理 |
|---|---:|---:|---:|---:|
| 20 ms 当前 | 0/8 | 0/10 | 4/20 | 0/30 |
| 5 ms 降低抑制 | 5/8 | 6/10 | 20/20 | 6/30 |

候选误差定义为 `候选相对谱面残差 − 盲看 actualRelativeMs`。no_clear_onset 表示参考物件附近没有清晰可分离音头，不等同于绝对静音。

## 逐物件结果

原音频路径和完整分秒区间见 `annotated-comparison.csv` 与 v550 `REVIEW.md`。

| 物件 | 标签 | 实际相对 ms | 当前残差 | 当前误差 | 5 ms 残差 | 5 ms 误差 |
|---|---|---:|---:|---:|---:|---:|
| sample-003_h183140 | clear | 8 |  |  | 1.668 | -6.332 |
| sample-003_h265989 | clear | 8 |  |  | 0.875 | -7.125 |
| sample-003_h280117 | clear | 5 |  |  | 3.025 | -1.975 |
| sample-003_h311774 | clear | 2 |  |  | -4.784 | -6.784 |
| sample-003_h180436 | no_clear_onset |  |  |  | 3.934 |  |
| sample-003_h18139 | no_clear_onset |  | -6.148 |  | 0.691 |  |
| sample-003_h264507 | no_clear_onset |  |  |  | 2.580 |  |
| sample-003_h309594 | no_clear_onset |  |  |  | -0.315 |  |
| sample-003_h55462 | no_clear_onset |  |  |  | 4.049 |  |
| sample-003_h59474 | no_clear_onset |  | 7.731 |  | -0.980 |  |
| sample-042_h75756 | approximate | 0 |  |  | -1.012 | -1.012 |
| sample-042_h27328 | clear | 1 |  |  | 2.184 | 1.184 |
| sample-042_h42864 | clear | 1 |  |  | -1.430 | -2.430 |
| sample-042_h137140 | no_clear_onset |  |  |  | -0.676 |  |
| sample-042_h53471 | no_clear_onset |  |  |  | -2.010 |  |
| sample-042_h57756 | no_clear_onset |  |  |  | 0.501 |  |
| sample-042_h64024 | no_clear_onset |  |  |  | -3.397 |  |
| sample-042_h64453 | no_clear_onset |  |  |  | -1.427 |  |
| sample-042_h96273 | no_clear_onset |  | -9.398 |  | 1.774 |  |
| sample-042_h97404 | no_clear_onset |  |  |  | -1.008 |  |
| sample-095_h232830 | approximate | 3 |  |  | -3.376 | -6.376 |
| sample-095_h267550 | clear | 2 |  |  | 1.659 | -0.341 |
| sample-095_h39373 | clear | 0 |  |  | -2.572 | -2.572 |
| sample-095_h178054 | no_clear_onset |  |  |  | 3.252 |  |
| sample-095_h183687 | no_clear_onset |  |  |  | 1.742 |  |
| sample-095_h188002 | no_clear_onset |  | -7.126 |  | -0.896 |  |
| sample-095_h199423 | no_clear_onset |  |  |  | -0.669 |  |
| sample-095_h281883 | no_clear_onset |  |  |  | -4.991 |  |
| sample-095_h310944 | no_clear_onset |  |  |  | 0.141 |  |
| sample-095_h382350 | no_clear_onset |  |  |  | -3.251 |  |

## 对 80% 目标的影响

本轮证据否定的是‘把 5 ms 抑制下的弱标签 86.55% 直接当真实精度’，不是否定所有 5 ms 候选。清晰正例保留，后续应学习/规则化其波形攻击特征，并对持续音与噪声纹理显式 abstain。
在计算总体精度前，还需标注 both 与 neither 两层，并按 v550 的人口权重还原；目标状态保持未完成。
