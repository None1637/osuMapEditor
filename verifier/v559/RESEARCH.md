# v559：E2 预训练 Basic Pitch onset 零样本诊断

## 结论先行

E2 已完成，**H1 不成立，H3 成立；H2 只在“no_clear 降幅大于真实音头召回降幅”的狭窄比较上成立，但不构成可用改进。** 两种神经表示的 precision、coverage、真实音头 recall 和全物件正确率都低于 full，不能替代现有 onset 包络，也不接入生产。

full 的全物件 ±5 ms 正确率为 40.7484%，neuralMax 为 7.3875%，neuralPitch 为 19.0145%，均未达到 80%。v557 已转为开发集，本轮不是独立确认成绩。

## 猜想

- H1：至少一种神经 onset 表示能在不降低 precision 的前提下，提高 clear+approximate recall。
- H2：神经 onset 表示能降低 no_clear 候选输出率，且真实音头召回损失更小。
- H3：在接触真实歌曲候选前，可用官方基准张量与跨窗坐标检查独立验证推理和时间对齐。

## 冻结方案

- 模型：Spotify Basic Pitch ICASSP 2022 `nmp.onnx`，官方仓库 commit `fa5997af0a8210982619003269994a1be25eddf3`，SHA-256 `2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec`，不微调。
- 输入：从冻结原始音频经 Electron Web Audio 解码，直接重采样为 22050 Hz 单声道，不归一化；不使用旧 11025 Hz PCM 再升采样。
- 推理：43844 samples/window、256 samples/frame、30 个重叠帧，严格复现官方前置补零、滑窗、去重叠和裁剪。
- `neuralMax`：每帧取 88 个音高 onset activation 的最大值，阈值 0.5，局部峰和抛物线亚帧插值。
- `neuralPitch`：每个音高轨迹分别执行 `scipy.signal.argrelmax`，阈值 0.5，合并同帧时间，不插值。
- 对照：v558 已冻结的 full 残差；目标仍使用 v548 的 globalDelay 与 top2/DP 奇偶交叉拟合相位。新特征不重新校准偏移。
- 评估：90 个 provisional 视觉盲标和原人口权重，沿用 precision、coverage、clear recall、clear+approx recall、全物件 ±5 ms 正确率和 no_clear 输出率。
- 禁止事项：真实指标揭示后不得回调阈值、时间偏移、相位或特征；生产 BPM 代码不改。

机器可读冻结配置见 `experiment.json`。官方说明该模型虽为 instrument-agnostic，但在单一乐器上效果最好，因此混音和鼓组上的表现必须实测，不能由模型名称推定。[Spotify Basic Pitch](https://github.com/spotify/basic-pitch "citation")

## 时间对齐审查

Basic Pitch 的帧间隔是 `256/22050 = 11.609977 ms`，不能沿用旧谱通量的 `3*WIN/4/sampleRate` bias。前置补零为 15 帧，每窗又裁掉首尾各 15 帧，因此去重叠后的第 0 帧对应原音频第 0 sample，跨窗后仍每次前进 256 samples。本轮直接使用 `frameIndex*256/22050`，不把官方用于另一层后处理的 window correction 再叠加到已展开序列上。

## 已完成的独立实现检查

- 模型输入/输出名称、动态 batch、形状、有限值、值域和重复推理 bitwise 确定性均通过；结果见 `smoke-results.json`。
- 官方 `vocadito_10.wav` 经 soundfile 读取、单声道平均和 soxr HQ 重采样后，note/onset/contour 三个张量全部在官方 `atol=1e-4, rtol=0` 容差内。
- onset 最大绝对差为 `3.3974647521972656e-05`；787 帧的全部相邻帧间隔及 142/284/426/568 四个跨窗连接均通过检查。结果见 `parity-results.json`。
- 首次官方 fixture 时间轴自检把浮点尾差误用精确相等判断，已改为与全帧检查相同的 `1e-12` 容差；张量对照在此之前已经通过，该修改不影响模型输出。
- 长歌曲的大时间戳相减产生最大 `2.65e-11 ms` 浮点尾差，超过原 `1e-12 ms` 断言；真实候选生成前将运行脚本断言放宽到 `1e-9 ms`。这只是数值检查修正，不改变帧时间或模型参数。

## 真实歌曲结果

### 总体人口加权指标

| 方法 | precision | coverage | clear recall | clear+approx recall | 全物件 ±5 ms | no_clear 输出率 |
|---|---:|---:|---:|---:|---:|---:|
| full | 42.5086% | 95.8593% | 90.8894% | 77.2226% | 40.7484% | 96.6972% |
| neuralMax | 22.7365% | 32.4920% | 23.7355% | 14.0002% | 7.3875% | 29.0228% |
| neuralPitch | 38.3135% | 49.6287% | 40.2837% | 36.0344% | 19.0145% | 48.7539% |

### 分曲结果

每格为“全物件 ±5 ms 正确率 / clear+approx recall”。

| 方法 | sample-044 | sample-032 | sample-002 |
|---|---:|---:|---:|
| full | 81.3244% / 90.6200% | 43.2033% / 75.2965% | 28.9711% / 80.6866% |
| neuralMax | 0.0000% / 0.0000% | 10.0000% / 17.4284% | 1.6292% / 4.5373% |
| neuralPitch | 4.9778% / 5.5468% | 25.0498% / 43.6578% | 5.3055% / 14.7761% |

### 猜想判定与解释

- **H1 不成立**：neuralMax 和 neuralPitch 的 precision 分别下降 19.7721 和 4.1951 个百分点，clear+approx recall 分别下降 63.2224 和 41.1881 个百分点。
- **H2 狭窄成立但无应用价值**：neuralMax 的 no_clear 输出率下降 67.6744 个百分点，大于其真实音头召回降幅；neuralPitch 对应降幅为 47.9433 和 41.1881 个百分点。然而两者 coverage 只剩 32.4920% 和 49.6287%，precision 也更低，不能称为选择性抑制假峰。
- **H3 成立**：在真实歌曲候选前，模型哈希、官方张量一致性、重复推理确定性和跨窗时间轴均已独立通过。
- neuralMax 的全部配对误差诊断中位数为 -5.1078 ms，但只有 10 个真实音头配对；neuralPitch 为 -1.7738 ms，只有 15 个。样本太少且受候选选择影响，不能据此校准偏移。
- 结果否定的是当前 Basic Pitch 零样本接入方式，不是所有预训练 onset 模型。下一步若要继续，应优先比较通用 onset 专用模型，或在全新版本中把阈值/聚合方式明确列为开发调参，再用新确认集复验。

## 独立复算与复现

`check-results.py` 独立重读 90 个原始选件、标签、候选和 CSV，复算三种方法的总体、分曲、分层指标、配对误差诊断、相对 full 差值及 80% 标志；`result-validation.json` 为 `passed: true`。

在 `app` 目录执行：

```bash
node "verifier/v559/check.mjs"
python "verifier/v559/check-results.py"
python "verifier/v559/check-report.py"
```

## 后续独立确认集预登记

只使用谱面标签，从原 100 首中排除 001/058 和全部 v548 歌曲，再以 `sha256(v559-confirmation:sample-id)` 固定选取 6 首：恒速 sample-099、sample-047；密集变速 sample-054、sample-077；其他变速 sample-067、sample-017。

这些歌曲没有参与 v559 的解码、候选生成、指标分析或标注，状态保留为 `reserved_not_decoded_by_v559_not_evaluated_not_labeled`。后续每首计划抽 30 个物件，共 180 个；在新版本配置冻结前不得用它们调参。机器可读名单见 `confirmation-selection.json`。

## 验证限制

- 当前 90 个标签未获所有者听辨确认。按实际人口权重重算，no_clear 使全物件指标在当前口径下的上限为 **52.7675%**；recall、precision 和全物件指标必须分别解读。
- 冻结配置中的上限预填值比实际重算值高 0.0066 个百分点，分析结果保留 `configuredUpperBoundArithmeticWarning`，未回改冻结配置，也不影响任何候选或指标。
- 本轮仍沿用 full 的 globalDelay 与相位，无法把“模型本身的时间偏差”和“旧校准失配”完全分离；配对误差统计不是校准结果。
- 三首开发歌曲不能外推到全部 osu! 歌曲。任何后续改动都需要新的独立确认集。
