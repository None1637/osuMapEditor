// 验证器 v144: ① 缩圈按物件 (combo) 颜色染色 ② 音量设置 (主/歌曲/音效三级, 显示设置左侧按钮)
// 运行: node verifier/v144/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v144/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v144/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 增益纯函数断言 (内部自报 V144_TESTS_*)
fs.unlinkSync(out);

section('缩圈染色 (renderer.ts)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/function drawApproach\(g: CanvasRenderingContext2D, skin: Skin, color: string/.test(src), 'drawApproach 接收 combo 色参数');
  assert(/g\.drawImage\(tintedSprite\(skin\.approachcircle, color\)/.test(src), '缩圈贴图走 tintedSprite 乘算染色 (与 hitcircle 同款, 带缓存)');
  // v215 适配: 滑条头新增暂留贴边分支 (pinned) + else 分支, 调用点 2 → 4
  assert((src.match(/drawApproach\(g, skin, color, /g) || []).length === 4, '四个调用点 (单点 + 滑条头暂留贴边/常规/兜底) 均传 color');
  assert(!/drawImage\(skin\.approachcircle/.test(src), '不再直接画未染色的 approachcircle');
}

section('volumeSettings.ts: 三级音量数据层');
{
  const src = readSrc('src/osu/volumeSettings.ts');
  assert(/master: number;[\s\S]*music: number;[\s\S]*effects: number;/.test(src), 'master/music/effects 三字段');
  assert(/export function musicGain\(\): number \{ return \(volumeSettings\.master \/ 100\) \* \(volumeSettings\.music \/ 100\); \}/.test(src), '音乐增益 = 主×歌曲');
  assert(/export function effectsGain\(\): number \{ return \(volumeSettings\.master \/ 100\) \* \(volumeSettings\.effects \/ 100\); \}/.test(src), '音效增益 = 主×音效');
  assert(/'osu-editor:volume-settings'/.test(src), 'localStorage 持久化');
  assert(/Math\.max\(0, Math\.min\(100, Math\.round\(v\)\)\)/.test(src), '0-100 钳制取整');
}

section('store.ts: 音量总线接线');
{
  const src = readSrc('src/osu/store.ts');
  assert(/volumePanelOpen = false;/.test(src) && /setVolumePanelOpen/.test(src), '面板开关');
  assert(/setVolume\(k: keyof VolumeSettings, v: number\) \{ applyVolume\(k, v\); this\.applyVolumeBuses\(\); this\.emitSelection\(\); \}/.test(src), 'setVolume: 持久化 + 同步总线 + 重绘');
  assert(/private ensureMusicBus\(\): GainNode/.test(src) && /this\.musicBus\.gain\.value = musicGain\(\)/.test(src), '音乐总线 (增益 = 主×歌曲)');
  assert(/sg\.connect\(this\.ensureMusicBus\(\)\)/.test(src), '常速 source 经 sourceGain → 音乐总线 (v216: 中间插 per-source 增益)');
  assert(/g\.connect\(this\.ensureMusicBus\(\)\)/.test(src), '变速 tempoNode 经 tempoGain → 音乐总线 (v216: 中间插支路增益)');
  assert(/this\.hitBus\.gain\.value = HITSOUND_BUS_GAIN \* effectsGain\(\)/.test(src), 'hitsound 总线增益 = 0.8 × 主×音效 (v101 余量保留)');
  assert(/this\.audio\.volume = musicGain\(\)/.test(src), '兜底 <audio> 音量');
  assert(/private applyVolumeBuses\(\)/.test(src) && /if \(this\.hitBus\) this\.hitBus\.gain\.value = HITSOUND_BUS_GAIN \* effectsGain\(\);/.test(src), 'applyVolumeBuses 同步现存总线');
}

section('VolumePanel + App 接线');
{
  const vp = readSrc('src/components/VolumePanel.tsx');
  assert(vp.includes('DraggableDialog'), 'DraggableDialog 模式');
  assert((vp.match(/data-volume-slider=/g) || []).length === 1 && (vp.match(/key: '(master|music|effects)'/g) || []).length === 3, '三条滑条 (map 模板 + 三行配置, 测试挂钩)');
  assert(vp.includes('store.setVolume('), '滑条经 store.setVolume');
  const app = readSrc('src/App.tsx');
  assert(app.includes('data-volume-panel-btn') && app.includes('store.setVolumePanelOpen('), '音量按钮 (显示设置左侧)');
  assert(app.indexOf('data-volume-panel-btn') < app.indexOf('data-display-panel-btn'), '音量按钮在显示设置按钮左边');
  assert(app.includes('{store.volumePanelOpen && <VolumePanel />}'), 'App 挂载 VolumePanel');
}

console.log(failures ? `\nV144_CHECK_FAILED: ${failures}` : '\nV144_CHECK_PASSED');
process.exit(failures ? 1 : 0);
