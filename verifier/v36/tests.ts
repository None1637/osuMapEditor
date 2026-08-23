// 验证器 v36: F1 滑条转连打 — streamTimes/computeStream 纯函数测试
import { streamTimes, streamFractions, computeStream, DEFAULT_STREAM_PARAMS, type StreamParams } from '../../src/osu/convert/stream';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 合成谱面: 红线 0/500, SliderMultiplier 1 -> vel = 100*1/500 = 0.2 px/ms
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 },
} as unknown as Beatmap;

// 直线滑条 (100,100)->(300,100), length 200 -> 单程 1000ms
const slider: HitObject = {
  id: 1, type: 'slider', x: 100, y: 100, time: 2000,
  curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200,
  hitSound: 10, newCombo: true, comboSkip: 0, hitSampleRaw: '1:2:0:80:',
};

section('streamTimes: 等距');
{
  const p: StreamParams = { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 5 };
  const t = streamTimes(1000, p, 300);
  assert(t.length === 5 && t[0] === 0 && Math.abs(t[4] - 1000) < 1e-9, `count=5 等距: 5 点覆盖 [0,1000] (${t.join(',')})`);
  assert(Math.abs(t[1] - 250) < 1e-9, '间隔 250ms');
  const p2: StreamParams = { ...DEFAULT_STREAM_PARAMS, mode: 'spacing' }; // v40: spacingMs 由调用方按拍解析后传入
  const t2 = streamTimes(1000, p2, 300);
  assert(t2.join(',') === '0,300,600,900', `spacingMs=300: 0,300,600,900 (${t2.join(',')})`);
}

section('streamFractions: 变距只改空间分布, 时间恒等距 (v41 语义)');
{
  const p: StreamParams = { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 5, curve: 'linear', endPercent: 50 };
  const t = streamTimes(1000, p, 300);
  assert(t.join(',') === '0,250,500,750,1000', `变距时时间仍等距 (${t.join(',')})`);
  const f = streamFractions(p, t, 1000);
  assert(f.length === 5 && f[0] === 0 && Math.abs(f[4] - 1) < 1e-9, '位置比例覆盖 [0,1] (变距末点恒在路径尾)');
  const gaps = f.slice(1).map((v, i) => v - f[i]);
  assert(gaps[0] > gaps[3], `空间间距前疏后密 (${gaps.map(g => g.toFixed(3)).join(',')})`);
  // 间距比 = 权重比: 线性 w=1+(k-1)p, k=0.5
  const ratio = gaps[0] / gaps[3];
  const expect = (1 - 0.5 * 0.125) / (1 - 0.5 * 0.875);
  assert(Math.abs(ratio - expect) < 0.01, `空间间距比 ${ratio.toFixed(3)} ≈ 理论 ${expect.toFixed(3)}`);
  // bell: 两端 100%, 中段最密
  const fb = streamFractions({ ...p, curve: 'bell' }, t, 1000);
  const gb = fb.slice(1).map((v, i) => v - fb[i]);
  assert(Math.abs(gb[0] - gb[3]) < 1e-9 && gb[1] < gb[0], `bell 对称且中段密 (${gb.map(g => g.toFixed(3)).join(',')})`);
  // endPercent=0: 权重按段中点采样, 末段趋近 0 但不精确为 0; 验证合法单调且覆盖 [0,1]
  const f0 = streamFractions({ ...p, endPercent: 0 }, t, 1000);
  const g0 = f0.slice(1).map((v, i) => v - f0[i]);
  assert(Math.abs(f0[4] - 1) < 1e-9 && g0.every((g, j) => j === 0 || g < g0[j - 1]),
    `endPercent=0: 严格递减覆盖 [0,1] (${f0.map(v => v.toFixed(3)).join(',')})`);
  // 等距曲线: 按间距模式位置比例 = 时间比例; 按数量模式 = 索引均布 (v43)
  const fe = streamFractions({ ...p, mode: 'spacing', curve: 'equal' }, [0, 300, 600, 900], 1000);
  assert(fe.join(',') === '0,0.3,0.6,0.9', `等距@spacing: 位置比例跟随时间 (${fe.join(',')})`);
  const fc = streamFractions({ ...p, curve: 'equal' }, [0, 300, 600, 900], 1000);
  assert(fc.map(v => v.toFixed(2)).join(',') === '0.00,0.33,0.67,1.00', `等距@count: 位置索引均布 (${fc.map(v => v.toFixed(2)).join(',')})`);
}

section('computeStream: 位置/时间/hitsound (lazer 语义)');
{
  const circles = computeStream(bm, [slider], { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 5 });
  assert(circles.length === 5, '5 个单点');
  assert(circles.map(c => c.x).join(',') === '100,150,200,250,300', `沿路径均布 x (${circles.map(c => c.x).join(',')})`);
  assert(circles.every(c => c.y === 100), 'y 恒 100');
  assert(circles.map(c => c.time).join(',') === '2000,2250,2500,2750,3000', `时间 (${circles.map(c => c.time).join(',')})`);
  assert(circles[0].newCombo === true && circles.slice(1).every(c => !c.newCombo), '首圆保留 newCombo, 其余普通');
  assert(circles.every(c => c.hitSound === 10 && c.hitSampleRaw === '1:2:0:80:'), '全部复制头部 hitSound/hitSample');
}

section('computeStream: 折返方向 (slides=2, lazer 奇数 span 反向)');
{
  const s2 = { ...slider, id: 2, slides: 2 };
  const circles = computeStream(bm, [s2], { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 5 });
  // duration = 2000ms; v43: 位置按数量均布 fracs=0,0.25,0.5,0.75,1 -> withRepeats=0,0.5,1,1.5,2
  // pos: 0, 0.5, 1(反向), 0.5(反向), 0 -> x: 100,200,300,200,100
  assert(circles.map(c => c.x).join(',') === '100,200,300,200,100', `折返采样 x (${circles.map(c => c.x).join(',')})`);
  // v43: 时间 = head + i*div (1/2 拍 = 250ms), 不再摊满全时长
  assert(circles.map(c => c.time).join(',') === '2000,2250,2500,2750,3000', `时间 head+i*250 (${circles.map(c => c.time).join(',')})`);
}

if (failures) { console.error(`\nV36_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV36_TESTS_PASSED');
