// src/osu/timelineSelect.ts
var EDGE_TOLERANCE_PX = 40;
var EDGE_MAX_VELOCITY = 10;
var EDGE_RAMP_MS = 5e3;
function edgeScrollVelocity(pointerX, width) {
  let amount = 0;
  if (pointerX > width - EDGE_TOLERANCE_PX) amount = pointerX - (width - EDGE_TOLERANCE_PX);
  else if (pointerX < EDGE_TOLERANCE_PX) amount = pointerX - EDGE_TOLERANCE_PX;
  if (amount === 0) return 0;
  return Math.sign(amount) * Math.min(EDGE_MAX_VELOCITY, Math.pow(Math.min(Math.abs(amount), EDGE_TOLERANCE_PX), 2));
}
function edgeScrollRamp(dragMs) {
  return Math.min(1, dragMs / EDGE_RAMP_MS);
}
function marqueeObjectIds(objects, endOf, msA, msB) {
  return objects.filter((o) => endOf(o) >= msA && o.time <= msB).map((o) => o.id);
}
function marqueeGreenTimes(points, msA, msB) {
  return points.filter((tp) => !tp.uninherited && tp.time >= msA && tp.time <= msB).map((tp) => tp.time);
}
var GREEN_PILL_TOP = 76.5;
var PILL_HEIGHT = 13;
function bandHit(ya, yb, top, h = PILL_HEIGHT) {
  return Math.min(ya, yb) <= top + h && Math.max(ya, yb) >= top;
}

// verifier/v102/tests.ts
var failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  } else console.log("  ok:", msg);
}
var near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
assert(
  EDGE_TOLERANCE_PX === 40 && EDGE_MAX_VELOCITY === 10 && EDGE_RAMP_MS === 5e3,
  `lazer \u5E38\u91CF 40/10/5000 (\u5B9E\u9645 ${EDGE_TOLERANCE_PX}/${EDGE_MAX_VELOCITY}/${EDGE_RAMP_MS})`
);
{
  const W = 1e3;
  assert(edgeScrollVelocity(500, W) === 0, "\u4E2D\u592E\u4E0D\u6EDA\u52A8");
  assert(edgeScrollVelocity(40, W) === 0, "\u5DE6\u5BB9\u5DEE\u8FB9\u754C\u4E0A\u4E0D\u6EDA\u52A8");
  assert(edgeScrollVelocity(960, W) === 0, "\u53F3\u5BB9\u5DEE\u8FB9\u754C\u4E0A\u4E0D\u6EDA\u52A8");
  assert(near(edgeScrollVelocity(39, W), -1), "\u5DE6\u8D85 1px => -1 (\u5E73\u65B9\u66F2\u7EBF)");
  assert(near(edgeScrollVelocity(38, W), -4), "\u5DE6\u8D85 2px => -4 (\u5E73\u65B9\u66F2\u7EBF)");
}
{
  const W = 1e3;
  const v5 = edgeScrollVelocity(40 - 5, W);
  assert(near(v5, -10), `\u5DE6\u8D85 5px => cap 10 (25>10, \u5B9E\u9645 ${v5})`);
  const v40 = edgeScrollVelocity(W - 40 + 40, W);
  assert(near(v40, 10), `\u53F3\u8D85 40px => cap 10 (\u5B9E\u9645 ${v40})`);
  const v100 = edgeScrollVelocity(W - 40 + 100, W);
  assert(near(v100, 10), `\u53F3\u8D85 100px \u4ECD cap 10 (\u5B9E\u9645 ${v100})`);
}
{
  assert(near(edgeScrollRamp(0), 0), "ramp(0) = 0");
  assert(near(edgeScrollRamp(EDGE_RAMP_MS / 2), 0.5), "ramp(2500) = 0.5");
  assert(near(edgeScrollRamp(EDGE_RAMP_MS * 2), 1), "ramp \u5C01\u9876 1");
  assert(near(edgeScrollVelocity(0, 1e3) * edgeScrollRamp(EDGE_RAMP_MS / 2), -5), "\u5408\u6210: \u534A ramp \u534A\u901F");
}
{
  const objs = [
    { id: 1, time: 1e3 },
    { id: 2, time: 2e3 },
    { id: 3, time: 3e3 }
  ];
  const endOf = (o) => o.time + (o.id === 2 ? 800 : 0);
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 1500, 1900)) === "[]", "\u533A\u95F4\u4E0D\u76F8\u4EA4\u4E0D\u4E2D");
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 1500, 2100)) === "[2]", "\u5934\u5728\u533A\u95F4\u5185\u4E2D");
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 2500, 2700)) === "[2]", "\u5C3E\u5728\u533A\u95F4\u5185\u4E5F\u4E2D (\u76F8\u4EA4\u8BED\u4E49)");
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 0, 4e3)) === "[1,2,3]", "\u5168\u8986\u76D6\u5168\u4E2D");
}
{
  const tps = [
    { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
    { time: 1e3, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
    { time: 2e3, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
    { time: 3e3, beatLength: 400, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }
  ];
  assert(JSON.stringify(marqueeGreenTimes(tps, 1e3, 2e3)) === "[1000,2000]", "\u7AEF\u70B9\u542B\u5165, \u7EA2\u7EBF\u6392\u9664");
  assert(JSON.stringify(marqueeGreenTimes(tps, 1001, 1999)) === "[]", "\u5F00\u533A\u95F4\u5916\u4E0D\u4E2D");
}
{
  assert(bandHit(0, 10, 0, 60), "\u7269\u4EF6\u884C\u5185\u76F8\u4EA4");
  assert(!bandHit(70, 90, 0, 60), "\u7EB5\u8DE8\u4E0D\u53CA\u7269\u4EF6\u884C\u4E0D\u76F8\u4EA4");
  assert(bandHit(70, 90, GREEN_PILL_TOP, PILL_HEIGHT), "\u8986\u76D6\u7EFF\u7EBF\u836F\u4E38\u5E26\u76F8\u4EA4");
  assert(bandHit(0, 92, GREEN_PILL_TOP, PILL_HEIGHT), "\u5168\u9AD8\u5EA6\u6846\u8986\u76D6\u836F\u4E38\u5E26");
}
if (failures) {
  console.error(`
V102_TESTS_FAILED: ${failures} \u5904\u5931\u8D25`);
  process.exit(1);
}
console.log("\nV102_TESTS_PASSED");
