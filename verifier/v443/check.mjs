// 验证器 v443: 滑条长度吸附细分 ×2 开关 (editorPrefs.sliderHalfSnap, 设置菜单 checkbox, 默认关)
// 背景: v218 起滑条长度吸附固定用当前细分的 1/2 (分母 ×2; 配置中无 ×2 细分则退回当前细分),
//   soulten 要求做成开关且默认关闭 (关 = 按当前细分整格吸附; 开 = 恢复 v218 行为)。
// 接线: editorPrefs.ts 加字段 (默认 false) → sliderPath.ts sliderLengthSnapDivisor 读开关
//   (全部吸附路径 placementLength/snapSliderLength/resnapSliderLength 都经此函数) →
//   设置菜单 checkbox (v386 通道: main.cjs 菜单项 → menu-cmd → electronMenu.ts → store.setEditorPref
//   → App.tsx 订阅回报 editor-prefs-state 重建勾选)。
// 运行: npm run build 后 node verifier/v443/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v443/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v443/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 纯函数测试 (开关两态的 divisor/snapSliderLength/placementLength)
await import('file://' + out);
fs.unlinkSync(out);

section('editorPrefs.ts: sliderHalfSnap 字段 (默认关)');
{
  const ep = read('src/osu/editorPrefs.ts');
  assert(/sliderHalfSnap: boolean;/.test(ep), 'EditorPrefs 接口含 sliderHalfSnap');
  assert(/sliderHalfSnap: false,\s*\/\/ v443/.test(ep), '默认值 false');
  assert(/sliderHalfSnap: p\.sliderHalfSnap === true/.test(ep), '持久化读取默认 false (遗留数据无此键取关)');
  assert(/从属于 sliderTailSnap 总开关/.test(ep), '注释说明与 sliderTailSnap 总开关的从属关系');
}

section('sliderPath.ts: 吸附细分读开关');
{
  const sp = read('src/osu/sliderPath.ts');
  assert(/if \(!editorPrefs\.sliderHalfSnap\) return beatSnap; \/\/ v443/.test(sp), 'sliderLengthSnapDivisor 关 = 当前细分整格');
  assert(/const half = beatSnap \* 2;[\s\S]{0,80}BEAT_SNAP_OPTIONS\.includes\(half\) \? half : beatSnap/.test(sp), '开 = v218 ×2 逻辑保留 (配置内 ×2, 否则退回)');
  assert(/v443: ×2 改为开关/.test(sp), 'v443 文档注释');
  assert(/const div = sliderLengthSnapDivisor\(beatSnap\);/.test(sp), 'snapSliderLength 经 sliderLengthSnapDivisor');
  assert(/const tickPx = vel \* red\.beatLength \/ sliderLengthSnapDivisor\(beatSnap\);/.test(sp), 'placementLength 经 sliderLengthSnapDivisor');
}

section('设置菜单接线 (v386 通道)');
{
  const mc = read('electron/main.cjs');
  assert(/"menu\.slider_half_snap": \{ en: .+, "zh-CN": .+, "zh-TW": .+ \}/.test(mc), '菜单文案 en/zh-CN/zh-TW 三语');
  assert(/sliderHalfSnap: false, svRedlineBoost: false, svTailRestore: true \}/.test(mc), '主进程勾选状态默认 (v455: +svRedlineBoost; v457: +svTailRestore 默认开)');
  assert(/sliderHalfSnap: s\?\.sliderHalfSnap === true/.test(mc), 'editor-prefs-state 上报解析默认 false');
  assert(/mT\("menu\.slider_half_snap"\), type: "checkbox", checked: editorPrefsState\.sliderHalfSnap, click: \(\) => send\(\{ type: "settings-toggle-editor-pref", key: "sliderHalfSnap" \}\)/.test(mc), '设置菜单 checkbox 项');
  const br = read('src/osu/electronBridge.ts');
  assert(/sliderHalfSnap: boolean; \/\/ v443/.test(br), 'ElectronEditorPrefsState 含 sliderHalfSnap');
  assert(/key: 'dragAdjustNumbers' \| 'moveDeadzone2px' \| 'sliderHalfSnap'/.test(br), 'menu-cmd key 联合类型含 sliderHalfSnap');
  const app = read('src/App.tsx');
  assert(/menuEditorPrefsState\(\{ dragAdjustNumbers: editorPrefs\.dragAdjustNumbers, moveDeadzone2px: editorPrefs\.moveDeadzone2px, sliderHalfSnap: editorPrefs\.sliderHalfSnap, svRedlineBoost: editorPrefs\.svRedlineBoost, svTailRestore: editorPrefs\.svTailRestore \}\)/.test(app), 'App.tsx 勾选状态上报含 sliderHalfSnap (v455: +svRedlineBoost; v457: +svTailRestore)');
}

section('CDP: 运行期翻转开关即时生效 (setEditorPref → __osuSnap.sliderLengthSnapDivisor)');
{
  const PORT = 9502;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    const r = await evalJs(`(() => {
      const store = window.__osuStore, snap = window.__osuSnap;
      const d0 = snap.sliderLengthSnapDivisor(4);       // 默认关
      store.setEditorPref('sliderHalfSnap', true);
      const d1 = snap.sliderLengthSnapDivisor(4);       // 开 → ×2
      const d16 = snap.sliderLengthSnapDivisor(16);     // 开但配置无 32 → 退回
      store.setEditorPref('sliderHalfSnap', false);
      const d2 = snap.sliderLengthSnapDivisor(4);       // 关 → 还原
      const persisted = JSON.parse(localStorage.getItem('osu-editor:editor-prefs') || '{}').sliderHalfSnap;
      return { d0, d1, d16, d2, persisted };
    })()`);
    assert(r.d0 === 4, `默认关: divisor(4)=4 (实际 ${r.d0})`);
    assert(r.d1 === 8 && r.d16 === 16, `开: divisor(4)=8, divisor(16)=16 退回 (实际 ${r.d1}/${r.d16})`);
    assert(r.d2 === 4, `关还原: divisor(4)=4 (实际 ${r.d2})`);
    assert(r.persisted === false, `翻转经 setEditorPref 持久化到 localStorage (sliderHalfSnap=${r.persisted})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V443_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V443_ALL_TESTS_PASSED');
