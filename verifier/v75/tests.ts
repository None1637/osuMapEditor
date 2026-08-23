// 验证器 v75 纯函数测试: 落盘弧段贝塞尔锚点转换 (preserveArcsForBezier) + 反转 (reverseSlider/reverseSelection)
import { preserveArcsForBezier, SliderPath, sliderGeometryLength } from '../../src/osu/sliderPath';
import { reverseSlider, reverseSelection } from '../../src/osu/reverse';
import type { Beatmap, HitObject, TimingPoint, Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function maxDeviation(P: Vec2[], Q: Vec2[]): number {
  let max = 0;
  for (const p of P) {
    let min = Infinity;
    for (let i = 0; i < Q.length - 1; i++) min = Math.min(min, distToSeg(p, Q[i], Q[i + 1]));
    if (min > max) max = min;
  }
  return max;
}
function mkSlider(x: number, y: number, curveType: string, cps: Vec2[], length: number, time = 1000): HitObject {
  return { id: 1, type: 'slider', x, y, time, curveType, curvePoints: cps, slides: 1, length, newCombo: false, comboSkip: 0, hitSound: 0 };
}

section('preserveArcsForBezier: 非 B 原样返回');
{
  const ctrl = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  assert(preserveArcsForBezier('P', ctrl) === ctrl && preserveArcsForBezier('L', ctrl) === ctrl && preserveArcsForBezier('B4', ctrl) === ctrl, 'P/L/B4 原样返回 (引用不变)');
}

section('preserveArcsForBezier: 3 点弧段 => 圆预设贝塞尔锚点, 形状保持');
{
  const ctrl = [{ x: 100, y: 300 }, { x: 150, y: 200 }, { x: 200, y: 300 }];
  const out = preserveArcsForBezier('B', ctrl);
  assert(out.length > 3, `弧段扩展为多个贝塞尔锚点 (实际 ${out.length})`);
  assert(Math.abs(out[0].x - 100) <= 1 && Math.abs(out[0].y - 300) <= 1, '段首锚点不动');
  assert(Math.abs(out[out.length - 1].x - 200) <= 1 && Math.abs(out[out.length - 1].y - 300) <= 1, '段尾锚点不动');
  const arc = SliderPath.computeRawPath('P', ctrl);
  const bez = SliderPath.computeRawPath('B', out);
  const dev = Math.max(maxDeviation(arc, bez), maxDeviation(bez, arc));
  assert(dev < 1.6, `转换后形状与圆弧一致 (偏差 ${dev.toFixed(2)}px < 1.6)`);
  // 不转换时 3 点段被当二次贝塞尔, 与圆弧偏差显著 (证明修复必要)
  const raw = SliderPath.computeRawPath('B', ctrl);
  const devRaw = Math.max(maxDeviation(arc, raw), maxDeviation(raw, arc));
  assert(devRaw > 10, `旧行为 (直接 B) 形状明显塌掉 (偏差 ${devRaw.toFixed(1)}px > 10)`);
}

section('preserveArcsForBezier: 共线 3 点段 / 2 点 / 4+ 点段不动');
{
  const collinear = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  assert(JSON.stringify(preserveArcsForBezier('B', collinear)) === JSON.stringify(collinear), '共线 3 点段 => 原样 (退化直线, 形状不变)');
  const four = [{ x: 0, y: 0 }, { x: 30, y: 50 }, { x: 60, y: 50 }, { x: 90, y: 0 }];
  assert(JSON.stringify(preserveArcsForBezier('B', four)) === JSON.stringify(four), '4 点段 => 原样');
  const two = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert(JSON.stringify(preserveArcsForBezier('B', two)) === JSON.stringify(two), '2 点段 => 原样');
}

section('preserveArcsForBezier: 多段 (红锚点重复对保留, 仅 3 点段转换)');
{
  const ctrl = [
    { x: 100, y: 300 }, { x: 150, y: 200 }, { x: 200, y: 300 }, // 段1: 3 点弧
    { x: 200, y: 300 }, { x: 300, y: 300 },                       // 段2: 2 点直线
  ];
  const out = preserveArcsForBezier('B', ctrl);
  // 段间红锚点重复对 (200,300) 保留且相邻
  let pairAt = -1;
  for (let i = 0; i < out.length - 1; i++) if (out[i].x === out[i + 1].x && out[i].y === out[i + 1].y) { pairAt = i; break; }
  assert(pairAt > 0 && out[pairAt].x === 200 && out[pairAt].y === 300, `红锚点重复对保留 (位于 ${pairAt})`);
  assert(out[out.length - 1].x === 300 && out[out.length - 1].y === 300, '末段直线尾点不动');
  assert(pairAt >= 4, `段1 扩展为 >3 个锚点 (pair 位于 ${pairAt})`);
}

section('reverseSlider: 未截断直线 => 头尾互换');
{
  const o = mkSlider(100, 100, 'L', [{ x: 300, y: 100 }], 200);
  reverseSlider(o);
  assert(o.x === 300 && o.y === 100, `新头 = 旧尾 (${o.x},${o.y})`);
  assert(o.curvePoints!.length === 1 && o.curvePoints![0].x === 100 && o.curvePoints![0].y === 100, '旧头成为最末控制点');
  assert(o.length === 200, 'length 不变');
}

section('reverseSlider: 未截断贝塞尔 => 形状精确反转');
{
  const cps = [{ x: 50, y: 100 }, { x: 100, y: 0 }];
  // v148 适配: 原 length=150 > 几何全长 ~147.9, SliderPath 末端延长语义 (lazer calculateLength) 生效后
  // "旧尾"变为延长点 (101,-2) 且反转不再保形 — 测试意图是"未截断"反转, 改用几何全长作为 length
  const oldPts = [{ x: 0, y: 0 }, ...cps];
  const geoLen = sliderGeometryLength('B', oldPts);
  const o = mkSlider(0, 0, 'B', cps.map(p => ({ ...p })), geoLen);
  const oldPath = SliderPath.computeRawPath('B', oldPts);
  reverseSlider(o);
  assert(o.x === 100 && o.y === 0, `新头 = 旧尾 (${o.x},${o.y})`);
  const newPts = [{ x: o.x, y: o.y }, ...o.curvePoints!];
  const newPath = SliderPath.computeRawPath('B', newPts);
  const dev = Math.max(maxDeviation(oldPath, newPath), maxDeviation(newPath, oldPath));
  assert(dev < 0.6, `反转后几何曲线不变 (偏差 ${dev.toFixed(2)}px)`);
}

section("reverseSlider: 截断 'P' => 重算中点保形, 新头 = PositionAt(length)");
{
  const pts = [{ x: 0, y: 0 }, { x: 50, y: -100 }, { x: 100, y: 0 }];
  const geoLen = sliderGeometryLength('P', pts); // v148 适配: 原哨兵 100000 现会触发末端延长 (lazer 语义), 改用几何全长
  const L = Math.round(geoLen * 0.6);
  const path = new SliderPath('P', pts, L);
  const E = path.positionAt(L);
  const o = mkSlider(0, 0, 'P', pts.slice(1).map(p => ({ ...p })), L);
  reverseSlider(o);
  assert(Math.abs(o.x - Math.round(E.x)) <= 1 && Math.abs(o.y - Math.round(E.y)) <= 1, `新头 ≈ 截断真尾端 (${o.x},${o.y} vs ${E.x.toFixed(1)},${E.y.toFixed(1)})`);
  assert(o.curvePoints!.length === 2, 'P 反转后仍 3 点 (头+2 控制点)');
  const lastCp = o.curvePoints![o.curvePoints!.length - 1];
  assert(lastCp.x === 0 && lastCp.y === 0, '旧头成为最末控制点');
  // 形状: 新路径 vs 旧截断路径的反转
  const oldTrunc: Vec2[] = [];
  for (let i = 0; i <= 40; i++) oldTrunc.push(path.positionAt(L * i / 40));
  const newPath = new SliderPath('P', [{ x: o.x, y: o.y }, ...o.curvePoints!], L);
  const newSamp: Vec2[] = [];
  for (let i = 0; i <= 40; i++) newSamp.push(newPath.positionAt(newPath.totalLength * i / 40));
  const dev = Math.max(maxDeviation(oldTrunc, newSamp), maxDeviation(newSamp, oldTrunc));
  assert(dev < 2.5, `截断弧反转后形状保持 (偏差 ${dev.toFixed(2)}px < 2.5)`);
}

section('reverseSlider: 截断多段 B => 丢尾端整段');
{
  // 3 段直线各 100px (红锚点分段), length=150 => 保留 2 段
  const cps = [{ x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }];
  const o = mkSlider(0, 0, 'B', cps.map(p => ({ ...p })), 150);
  reverseSlider(o);
  assert(o.x === 150 && o.y === 0, `新头 = PositionAt(150) (${o.x},${o.y})`);
  assert(o.curvePoints!.length === 3, `尾段整段被丢 (剩 3 控制点: ${JSON.stringify(o.curvePoints)})`);
  assert(o.curvePoints![0].x === 100 && o.curvePoints![1].x === 100, '红锚点重复对反转后仍相邻');
  const lastCp = o.curvePoints![o.curvePoints!.length - 1];
  assert(lastCp.x === 0 && lastCp.y === 0, '旧头成为最末控制点');
}

section('reverseSlider: edgeSounds/edgeSets 按端点反转');
{
  const o = mkSlider(0, 0, 'L', [{ x: 100, y: 0 }], 100);
  o.slides = 2; o.length = 100;
  o.edgeSoundsRaw = '0|2|4'; o.edgeSetsRaw = '0:0|1:0|2:1';
  reverseSlider(o);
  assert(o.edgeSoundsRaw === '4|2|0', `edgeSounds 反转 (${o.edgeSoundsRaw})`);
  assert(o.edgeSetsRaw === '2:1|1:0|0:0', `edgeSets 反转 (${o.edgeSetsRaw})`);
}

// ---------- reverseSelection (时间镜像 + newCombo 保持) ----------
const TP: TimingPoint[] = [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
const bm = { timingPoints: TP, difficulty: { sliderMultiplier: 1.4 } } as unknown as Beatmap; // vel = 0.28 px/ms
let nextId = 100;
function mkCircle(time: number, newCombo: boolean): HitObject {
  return { id: nextId++, type: 'circle', x: 100, y: 100, time, newCombo, comboSkip: 0, hitSound: 0 };
}

section('reverseSelection: 多选时间镜像 + newCombo 时序保持');
{
  const A = mkCircle(1000, true);
  const S = mkSlider(150, 150, 'L', [{ x: 290, y: 150 }], 140, 1500); // duration = 140/0.28 = 500ms => end 2000
  S.id = nextId++;
  const B = mkCircle(1800, false);
  const sliders = reverseSelection(bm, [A, S, B]);
  // startTime=1000, endTime=2000; A: 2000-(1000-1000)=2000; S: 2000-(2000-1000)=1000; B: 2000-(1800-1000)=1200
  assert(A.time === 2000 && S.time === 1000 && B.time === 1200, `时间镜像 (A=${A.time} S=${S.time} B=${B.time})`);
  // 重排后 [S(1000), B(1200), A(2000)], newCombo 保持时序位置 [true, false, false]
  assert(S.newCombo === true && B.newCombo === false && A.newCombo === false, 'newCombo 保持时序位置 (不随物件走)');
  assert(sliders.length === 1 && sliders[0] === S, '返回被反转的滑条');
  assert(S.x === 290 && S.curvePoints![0].x === 150, '滑条路径已反向');
}

section('reverseSelection: 单选非滑条 => 时间不动; 单滑条只反向路径');
{
  const A = mkCircle(1000, true);
  reverseSelection(bm, [A]);
  assert(A.time === 1000 && A.newCombo === true, '单 circle: 无操作');
  const S = mkSlider(0, 0, 'L', [{ x: 200, y: 0 }], 200, 3000);
  reverseSelection(bm, [S]);
  assert(S.time === 3000, '单滑条: 时间不变');
  assert(S.x === 200 && S.curvePoints![0].x === 0, '单滑条: 路径反向');
}

if (failures) { console.error(`\nTESTS_V75_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V75_ALL_PASSED');
