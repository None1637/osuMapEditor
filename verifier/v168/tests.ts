// 验证器 v168 纯函数测试: displaySettings.bgBrightness 默认值与 setDisplayNumber 钳制/持久化
// localStorage 用内存 shim (node 环境无 localStorage)
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
};

const { displaySettings, setDisplayNumber, setDisplayFlag } = await import('../../src/osu/displaySettings');

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('默认值 = 旧固定亮度 (35 = alpha 0.35)');
assert(displaySettings.bgBrightness === 35, `默认 35 (得 ${displaySettings.bgBrightness})`);

section('setDisplayNumber: 写入 + 钳制 + 持久化');
{
  setDisplayNumber('bgBrightness', 60);
  assert(displaySettings.bgBrightness === 60, `设 60 (得 ${displaySettings.bgBrightness})`);
  assert(JSON.parse(mem.get('osu-editor:display-settings')!).bgBrightness === 60, '已持久化到 localStorage');
  setDisplayNumber('bgBrightness', 150);
  assert(displaySettings.bgBrightness === 100, `150 钳到 100 (得 ${displaySettings.bgBrightness})`);
  setDisplayNumber('bgBrightness', -20);
  assert(displaySettings.bgBrightness === 0, `-20 钳到 0 (得 ${displaySettings.bgBrightness})`);
  setDisplayNumber('bgBrightness', 35); // 还原默认
  assert(displaySettings.bgBrightness === 35, '还原 35');
}

section('回归: 布尔开关不受影响');
{
  setDisplayFlag('sliderPathLine', true);
  assert(displaySettings.sliderPathLine === true, '布尔开关仍可用');
  setDisplayFlag('sliderPathLine', false);
  assert(displaySettings.bgBrightness === 35, '布尔开关不影响 bgBrightness');
}

if (failures) { console.error(`V168_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V168_TESTS_PASSED');
