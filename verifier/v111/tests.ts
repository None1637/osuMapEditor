// v111 纯函数单测: spectroScrollStep 频谱滚动平移簿记 — 任何速率下误差不累积 (恒 ≤0.5px)
// 运行: npx esbuild verifier/v111/tests.ts --bundle --platform=node --outfile=/tmp/v111.cjs && node /tmp/v111.cjs
import { pixelShift, spectroScrollStep } from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// ---- T1: 基本步进 — 位移 3.2px → dx=3, newImgT0 精确对应 3px (残差 0.2px 留在 imgT0) ----
{
  const win = 6000, W = 1000; // 6ms/px
  const { dx, newImgT0 } = spectroScrollStep(0, 19.2, win, W); // 19.2ms = 3.2px
  assert(dx === 3, `T1 3.2px → dx=3 (实际 ${dx})`);
  assert(Math.abs(newImgT0 - 18) < 1e-9, `T1 newImgT0 = 3px*6ms = 18ms (实际 ${newImgT0})`);
  // 下一帧从 newImgT0 出发, 剩余 0.2px 参与下次取整 → 不丢
  const s2 = spectroScrollStep(newImgT0, 19.2 + 19.2, win, W); // 再 +3.2px: 距 imgT0(18ms) 3.4px → 3
  assert(s2.dx === 3 && Math.abs(s2.newImgT0 - 36) < 1e-9, `T1 第二步 dx=3 newImgT0=36 (实际 ${s2.dx}, ${s2.newImgT0})`);
}

// ---- T2: 不变式 — 各播放速率模拟 10000 帧 (≈2.8 分钟), 位图时间基准与视口偏差恒 ≤0.5px ----
// 0.25x/0.5x 慢速滚动时 dx=0 帧占比高 — 旧簿记正是在这些帧上双计累计位移
for (const rate of [0.25, 0.5, 0.75, 1, 1.25, 2, 4]) {
  const win = 6000, W = 900;
  let t = 0, imgT0 = -win / 2, maxErr = 0;
  const dt = (1000 / 60) * rate;
  for (let f = 0; f < 10000; f++) {
    t += dt;
    const t0 = t - win / 2;
    const { dx, newImgT0 } = spectroScrollStep(imgT0, t0, win, W);
    if (dx !== 0) imgT0 = newImgT0;
    maxErr = Math.max(maxErr, Math.abs(pixelShift(imgT0, t0, win, W)));
  }
  assert(maxErr <= 0.5 + 1e-9, `T2 ${rate}x 10000 帧最大偏差 ≤0.5px (实际 ${maxErr.toFixed(4)}px)`);
}

// ---- T3: 倒退/跳跃也不漂移 (seek 回退 + 前进交替) ----
{
  const win = 6000, W = 900;
  let imgT0 = -win / 2, maxErr = 0;
  let t = 0;
  for (let f = 0; f < 3000; f++) {
    t += (f % 120 < 60 ? 1 : -1) * (1000 / 60) * 0.5; // 0.5x 前进 60 帧再倒退 60 帧
    const t0 = t - win / 2;
    const { dx, newImgT0 } = spectroScrollStep(imgT0, t0, win, W);
    if (dx !== 0 && Math.abs(dx) < W) imgT0 = newImgT0;
    else if (Math.abs(dx) >= W) imgT0 = t0; // 组件全量重绘分支
    maxErr = Math.max(maxErr, Math.abs(pixelShift(imgT0, t0, win, W)));
  }
  assert(maxErr <= 0.5 + 1e-9, `T3 反复进退 3000 帧最大偏差 ≤0.5px (实际 ${maxErr.toFixed(4)}px)`);
}

// ---- T4: 对照 — 旧簿记 (t0+frac) 在同样 0.25x 慢速滚动下确实漂移, 证明 T2 断言能抓住该 bug ----
{
  const win = 6000, W = 900;
  let t = 0, scT0 = -win / 2, frac = 0, imgMs = -win / 2, maxErr = 0;
  const dt = (1000 / 60) * 0.25;
  for (let f = 0; f < 600; f++) { // 仅 10 秒墙钟 (2.5s 歌曲时间)
    t += dt;
    const t0 = t - win / 2;
    const dxF = pixelShift(scT0, t0, win, W) + frac; // 旧实现: dx=0 帧不更新 scT0, 累计位移全塞进 frac → 双计
    const dx = Math.round(dxF);
    frac = dxF - dx;
    if (dx !== 0) { imgMs += (dx * win) / W; scT0 = t0; }
    maxErr = Math.max(maxErr, Math.abs(pixelShift(imgMs, t0, win, W)));
  }
  console.log(`  T4 旧簿记 600 帧 (0.25x) 漂移: ${maxErr.toFixed(2)}px`);
  assert(maxErr > 2, `T4 旧簿记 0.25x 下 600 帧漂移 >2px (实际 ${maxErr.toFixed(2)}px) — 证明 T2 有效`);
}

console.log(failures ? `\nV111_TESTS_FAILED: ${failures}` : '\nV111_TESTS_PASSED');
process.exit(failures ? 1 : 0);
