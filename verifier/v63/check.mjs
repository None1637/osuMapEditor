// 验证器 v63: 上时间轴 +红/+绿 插入按钮 + 双击 BPM/SV 胶囊开全参数编辑弹窗
// 运行: cd app && node verifier/v63/check.mjs; node verifier/v63/cdp-v63.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v63/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v63/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('store.ts: 弹窗状态机 (open/close/apply/remove)');
{
  const src = readSrc('src/osu/store.ts');
  assert(/timingPointDialog: \{ mode: 'add' \| 'edit'; index: number; draft: TimingPoint \} \| null = null/.test(src), 'timingPointDialog 状态字段');
  assert(/openTimingPointDialog\(mode: 'add' \| 'edit', index: number, draft: TimingPoint\)/.test(src), 'openTimingPointDialog');
  assert(/applyTimingPointDialog/.test(src) && /pushUndo\(\)/.test(src) && /timingPoints\.sort\(\(a, b\) => a\.time - b\.time\)/.test(src), 'apply: pushUndo + 替换/插入 + 排序 (一次 undo)');
  assert(/removeTimingPointAt\(index: number\)/.test(src) && /timingPoints\.splice\(index, 1\)/.test(src), 'removeTimingPointAt (弹窗内删除)');
}

section('TimingPointDialog.tsx: 全参数表单 (.osu 行 8 字段)');
{
  const src = readSrc('src/components/TimingPointDialog.tsx');
  assert(/testid="time"/.test(src) && /testid="bpmOrSv"/.test(src) && /testid="meter"/.test(src), '时间/BPM或SV/拍号输入');
  assert(/data-tpdlg="sampleSet"/.test(src) && /testid="sampleIndex"/.test(src) && /testid="volume"/.test(src), '音效集/序号/音量');
  assert(/data-tpdlg="kiai"/.test(src) && /data-tpdlg="omitBar"/.test(src) && /red && \(/.test(src), 'kiai + 省略小节线 (仅红线)');
  assert(/data-tpdlg="ok"/.test(src) && /data-tpdlg="cancel"/.test(src), '确定/取消按钮');
  assert(/dlg\.mode === 'edit' && \(/.test(src) && /data-tpdlg="delete"/.test(src), 'edit 模式才有删除按钮');
  assert(/60000 \/ draft\.beatLength/.test(src) && /-100 \/ draft\.beatLength/.test(src), 'BPM<->beatLength / SV<->beatLength 换算');
}

section('Timelines.tsx: +红/+绿 按钮 + 双击胶囊命中');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/data-tp-add="red"/.test(src) && /data-tp-add="green"/.test(src), '+红/+绿 插入按钮');
  assert(/defaultNewPoint\(bm\.timingPoints, Math\.round\(store\.currentTime\), true\)/.test(src)
    && /defaultNewPoint\(bm\.timingPoints, Math\.round\(store\.currentTime\), false\)/.test(src), '插入草稿克隆当前时间生效点');
  assert(/const hitTestTimingPill/.test(src) && /measureText\(text\)\.width \+ 10/.test(src), '胶囊命中 = 文本宽+padding (与绘制同款)');
  assert(/onDoubleClick/.test(src) && /openTimingPointDialog\('edit', hit\.idx, hit\.tp\)/.test(src), '双击胶囊开 edit 弹窗 (v102: 命中返回 {idx,tp})');
}

section('App.tsx: 弹窗挂载');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ TimingPointDialog \}/.test(src) && /\{store\.timingPointDialog && <TimingPointDialog \/>\}/.test(src), 'TimingPointDialog 条件挂载');
}

if (failures) { console.error(`\nVERIFIER_V63_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V63_ALL_PASSED');
