// v521: 参考 osu!lazer 新建空谱面 (文件菜单/Ctrl+N → Song Setup → 独立保存)
// 运行: npm run build 后 node verifier/v521/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v521/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const rawText = {
  name: 'raw-text', setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw-text' }));
    b.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
  },
};

console.log('== A: 纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v521/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle, plugins: [rawText] });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 源码契约');
{
  const main = read('electron/main.cjs'), bridge = read('src/osu/electronBridge.ts');
  const menu = read('src/osu/electronMenu.ts'), app = read('src/App.tsx');
  const hotkeys = read('src/osu/hotkeys.ts'), store = read('src/osu/store.ts');
  assert(/menu\.new/.test(main) && /type: "new"/.test(main), '主进程文件菜单新建项');
  assert(/"menu.new"\s*:\s*\{[^}]*新建谱面/.test(main), '新建菜单三语标签');
  assert(/\{ type: 'new' \}/.test(bridge), 'ElectronMenuCommand new 类型');
  assert(/id: 'new'/.test(hotkeys) && /Ctrl\+N/.test(hotkeys), 'Ctrl+N 纳入快捷键注册表');
  assert(/newBeatmap/.test(menu) && /guardUnsaved/.test(menu), '新建前未保存保护');
  assert(/handleMenuCommand\(cmd, \(\) => setTab\('setup'\)\)/.test(app), '新建及未保存确认重入都进入 Song Setup');
  assert(/initialDirty = false/.test(store) && /initialDirty \? null : this\.fingerprint/.test(store), 'initialDirty 可选且普通加载不受影响');
}

console.log('== C: CDP 未保存保护/新建/首次保存 (内存写入 stub)');
{
  const PORT = 9535;
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
    let msgId = 0; const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    await sleep(2100);

    const out = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const circle = { id: 521001, type: 'circle', x: 256, y: 192, time: 1000, newCombo: true, comboSkip: 0, hitSound: 0 };
      s.load({ ...base, hitObjects: [circle] }, s.audioUrl);
      s.beatmap.metadata.title = 'unsaved-old-map'; s.emit();
      const out = { dirtyBefore: s.dirty };
      out.firstResult = await window.__osuMenuCmd({ type: 'new' });
      out.guarded = !!s.pendingAction && s.beatmap.hitObjects.some(o => o.id === 521001);
      s.resolvePendingAction(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(120);
      out.guardAgain = !!s.pendingAction;
      s.resolvePendingAction(true); // 废弃旧改动并继续新建
      await sleep(500);
      out.created = {
        objects: s.beatmap.hitObjects.length,
        bpm: 60000 / s.beatmap.timingPoints[0].beatLength,
        cs: s.beatmap.difficulty.cs,
        source: s.mapSource?.dir.serverRel,
        dirty: s.dirty,
        setup: document.body.textContent.includes('[General] General'),
      };
      let saved = null;
      s.mapSource.dir.writeFile = async (name, text) => { saved = { name, text }; };
      s.backupNow = async () => {}; // 不写 exe 备份目录; 本用例只验证保存路由与脏状态
      out.saveOk = await s.save();
      out.savedName = saved?.name;
      out.savedHas60 = !!saved && /0,1000,4,2,0,100,1,0/.test(saved.text);
      out.savedEmpty = !!saved && !/^[0-9]+,[0-9]+,[0-9]+,/m.test(saved.text.split('[HitObjects]')[1] || '');
      out.dirtyAfterSave = s.dirty;
      return out;
    })()`);

    assert(out.dirtyBefore && out.firstResult === false && out.guarded && out.guardAgain, '旧谱面未保存时先拦截新建');
    assert(out.created.objects === 0 && out.created.bpm === 60 && out.created.cs === 5,
      `新建为空且采用 lazer 默认值 (${JSON.stringify(out.created)})`);
    assert(/^New Beatmap-\d+$/.test(out.created.source || ''), `独立保存目录 (${out.created.source})`);
    assert(out.created.dirty && out.created.setup, '新建未保存并进入 Song Setup');
    assert(out.saveOk && out.savedName === 'New Beatmap.osu' && out.savedHas60 && out.savedEmpty,
      '首次保存写出空谱面与默认红线 (内存 stub)');
    assert(out.dirtyAfterSave === false, '首次保存后清除未保存状态');

    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V521_FAILED: ${failures} 处失败` : '\nVERIFIER_V521_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
