# v544：开发集变速候选漏斗

- 成功分析 98 首，其中谱面变速 19、恒速 79。
- 变速歌曲：变速区有偏离窗 15/19；有原始候选 9/19；最终检出 3/19；最终证据与变速区相交 3/19。

## 候选拒绝原因

```json
{
  "variable": {
    "all": {
      "triplet": 31,
      "weak_short": 36,
      "insufficient_margin": 13,
      "accepted": 8
    },
    "overlappingReferenceVariable": {
      "triplet": 23,
      "insufficient_margin": 6,
      "weak_short": 14,
      "accepted": 6
    }
  },
  "constant": {
    "all": {
      "weak_short": 50,
      "insufficient_margin": 24,
      "triplet": 18,
      "accepted": 1
    }
  }
}
```

## 未检出的变速歌曲（16）

| ID | 偏离窗/变速区偏离窗 | 原始候选/变速区候选 | 变速区候选拒绝原因 |
|---|---:|---:|---|
| sample-001 | 99 / 78 | 9 / 9 | {"triplet":9} |
| sample-002 | 88 / 0 | 6 / 0 | {} |
| sample-003 | 58 / 9 | 4 / 1 | {"insufficient_margin":1} |
| sample-007 | 22 / 0 | 2 / 0 | {} |
| sample-010 | 87 / 49 | 4 / 2 | {"triplet":1,"weak_short":1} |
| sample-017 | 28 / 1 | 2 / 0 | {} |
| sample-025 | 47 / 17 | 1 / 1 | {"weak_short":1} |
| sample-027 | 84 / 4 | 5 / 0 | {} |
| sample-040 | 28 / 8 | 1 / 0 | {} |
| sample-058 | 60 / 24 | 4 / 2 | {"triplet":2} |
| sample-059 | 17 / 1 | 0 / 0 | {} |
| sample-067 | 14 / 1 | 2 / 0 | {} |
| sample-072 | 46 / 1 | 2 / 0 | {} |
| sample-077 | 24 / 0 | 1 / 0 | {} |
| sample-091 | 28 / 0 | 0 / 0 | {} |
| sample-100 | 8 / 3 | 1 / 1 | {"weak_short":1} |

> “与变速区相交”只表示时间重叠，不证明候选 BPM 等于红线 BPM；用于定位过滤阶段，不作为精确段级正确率。
