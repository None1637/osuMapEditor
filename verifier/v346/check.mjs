// 验证器 v346: 多语言模块 (简体中文/繁體中文/English, lazer TranslatableString 式架构)
//   静态段:
//     A. src 全部静态 t()/tNow() 调用 key ⊆ zh-CN 词典; 同 key 英文原文不冲突
//     B. 词典 key 全部被使用 (源码字面出现或属动态前缀域)
//     C. src (i18n 外) 无残留 CJK 字符串字面量 (注释/console/白名单数据除外)
//     D. 动态前缀域数据校验: hotkey.action.*/hotkey.cat.*/convert.curve_*/volume.*
//     E. s2t 覆盖率 (词典用字 ⊆ 字表∪同形集) + esbuild 真跑转换抽样 (术语/字表/回退)
//     F. tsc -b
//   运行时段 (需先 npm run build):
//     G. Electron CDP: zh-CN/en/zh-TW/debug 四语言切换 DOM 断言 + localStorage 持久化 + 切换器跟随
// 运行: node verifier/v346/check.mjs  (G 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(root, rel), 'utf8');

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1');

const SRC = path.join(root, 'src');
const files = walk(SRC).filter(f => !f.includes(`${path.sep}i18n${path.sep}`));
const dictDir = path.join(SRC, 'i18n', 'dicts', 'zh-CN');

// 词典 (分片源码正则提取, 避免 TS import)
const dict = {};
const dictVal = {};
for (const f of fs.readdirSync(dictDir)) {
  const src = read(path.join('src/i18n/dicts/zh-CN', f));
  for (const m of src.matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g)) { dict[m[1]] = f; dictVal[m[1]] = m[2]; }
}
const dictKeys = Object.keys(dict);

const STATIC_RE = /(?:\bt|\btNow)\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
const used = new Map(); // key -> Set(enDefault)
for (const f of files) {
  const code = stripComments(read(f));
  for (const m of code.matchAll(STATIC_RE)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(m[2]);
  }
}
const usedKeys = [...used.keys()];

section('A: 静态调用 key 完整性 + 英文原文一致性');
{
  const missing = usedKeys.filter(k => !(k in dict));
  assert(missing.length === 0, `调用 key 均有 zh-CN 译文 (缺失 ${missing.length}${missing.length ? ': ' + missing.slice(0, 8).join(', ') : ''})`);
  const conflict = usedKeys.filter(k => used.get(k).size > 1);
  assert(conflict.length === 0, `同 key 英文原文一致 (冲突 ${conflict.length})`);
}

section('B: 词典 key 全部被使用');
{
  const allSrc = files.map(f => read(f)).join('\n');
  const dynOk = (k) => k.startsWith('hotkey.action.') || k.startsWith('hotkey.cat.') || k.startsWith('convert.curve_') || k.startsWith('volume.');
  const extra = dictKeys.filter(k => !used.has(k) && !allSrc.includes(`'${k}'`) && !allSrc.includes(`"${k}"`) && !dynOk(k));
  assert(extra.length === 0, `无闲置词典 key (多余 ${extra.length}${extra.length ? ': ' + extra.slice(0, 8).join(', ') : ''})`);
}

section('C: src (i18n 外) 无残留 CJK 字符串字面量');
{
  // 白名单: 被多处消费的数据字段 / 持久化数据名
  const CJK_OK_FILES = ['src/osu/hotkeys.ts']; // 注册表 label/category 中文数据 (显示处经 t() 翻译)
  const CJK_OK_LITERALS = ['默认皮肤', '未分类']; // 持久化数据名 (显示处匹配后翻译)
  const hits = [];
  const STR_RE = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (CJK_OK_FILES.includes(rel)) continue;
    const codeLines = stripComments(read(f)).split('\n');
    codeLines.forEach((line, i) => {
      if (/console\.(log|warn|error|info|debug)/.test(line)) return;
      for (const m of line.matchAll(STR_RE)) {
        const body = m[1].slice(1, -1);
        if (/[一-鿿]/.test(body) && !CJK_OK_LITERALS.some(ok => body.includes(ok))) {
          hits.push(`${rel}:${i + 1}: ${m[1].slice(0, 60)}`);
          break;
        }
      }
    });
  }
  assert(hits.length === 0, `无遗漏 CJK 文案 (残留 ${hits.length}${hits.length ? ' -> ' + hits.slice(0, 6).join(' | ') : ''})`);
}

section('D: 动态前缀域数据校验');
{
  // hotkey.action.<id 连字符转下划线>
  const hk = read('src/osu/hotkeys.ts');
  const actionIds = [...hk.matchAll(/\{ id: '([^']+)'/g)].map(m => m[1]);
  const missAction = actionIds.filter(id => !(`hotkey.action.${id.replaceAll('-', '_')}` in dict));
  assert(actionIds.length > 40 && missAction.length === 0, `hotkey.action.* 覆盖全部 ${actionIds.length} 个动作 (缺 ${missAction.length}${missAction.length ? ': ' + missAction.slice(0, 5).join(',') : ''})`);
  // hotkey.cat.*
  const catKeys = [...hk.matchAll(/\{ key: '([^']+)', en:/g)].map(m => m[1]);
  const missCat = catKeys.filter(k => !(`hotkey.cat.${k}` in dict));
  assert(catKeys.length >= 8 && missCat.length === 0, `hotkey.cat.* 覆盖全部 ${catKeys.length} 个分类 (缺 ${missCat.length})`);
  // convert.curve_*
  const stream = read('src/components/convert/StreamDialog.tsx');
  const curveKeys = [...stream.matchAll(/\['\w+', '(curve_\w+)'/g)].map(m => m[1]);
  const missCurve = curveKeys.filter(k => !(`convert.${k}` in dict));
  assert(curveKeys.length === 5 && missCurve.length === 0, `convert.curve_* 覆盖全部 ${curveKeys.length} 条间距曲线 (缺 ${missCurve.length})`);
  // volume.*
  const vol = read('src/components/VolumePanel.tsx');
  const volKeys = [...vol.matchAll(/i18n: '(\w+)'/g)].map(m => m[1]);
  const missVol = volKeys.flatMap(k => [`volume.${k}`, `volume.${k}_desc`]).filter(k => !(k in dict));
  assert(volKeys.length === 3 && missVol.length === 0, `volume.* 覆盖全部 ${volKeys.length} 行 (缺 ${missVol.length})`);
  // 跨文件契约: App 用 startsWith(t('app.save_failed')) 判红, store.save_failed 必须以之开头
  const appEn = read('src/App.tsx').match(/t\('app\.save_failed', '([^']+)'\)/);
  const storeEn = read('src/osu/store.ts').match(/tNow\('store\.save_failed', '([^']+)'/);
  assert(!!appEn && !!storeEn && storeEn[1].startsWith(appEn[1]) && dictVal['store.save_failed'].startsWith(dictVal['app.save_failed']),
    'save_failed 前缀契约 (App startsWith 判红/绿, en+zh 双语成立)');
  // electron 主进程菜单语言通道
  const main = read('electron/main.cjs');
  assert(main.includes('ipcMain.on("menu-lang"') && main.includes('MENU_LABELS'), 'main.cjs: menu-lang IPC + 内嵌三语菜单标签表');
  assert(read('electron/preload.cjs').includes('menuLang'), 'preload 暴露 menuLang');
  assert(/onLangChange/.test(read('src/osu/electronMenu.ts')), 'electronMenu 订阅语言变化上报主进程');
}

section('E: s2t 覆盖率 + 转换抽样 (esbuild 真跑)');
{
  const s2tSrc = read('src/i18n/s2t.ts');
  const tableKeys = new Set([...s2tSrc.matchAll(/'(.)':\s*'/g)].map(m => m[1]));
  const sameM = s2tSrc.match(/S2T_SAME = new Set\(\s*'([\s\S]*?)',/);
  const same = new Set(sameM ? sameM[1] : '');
  const allZhChars = new Set();
  for (const f of fs.readdirSync(dictDir)) for (const ch of read(path.join('src/i18n/dicts/zh-CN', f))) if (/[一-鿿]/.test(ch)) allZhChars.add(ch);
  const uncovered = [...allZhChars].filter(c => !tableKeys.has(c) && !same.has(c));
  assert(uncovered.length === 0, `s2t 覆盖率 100% (${allZhChars.size} 字; 未覆盖 ${uncovered.length}${uncovered.length ? ': ' + uncovered.join('') : ''})`);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v346-')), 'bundle.mjs');
  fs.writeFileSync(path.join(root, 'verifier/v346/entry.ts'),
    `export { translate, getLang, setLang } from '@/i18n';\nexport { s2t, applyTwPhrases } from '@/i18n/s2t';\n`);
  execSync(`npx esbuild verifier/v346/entry.ts --bundle --format=esm --platform=node --outfile="${out}" --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
  const mod = await import('file:///' + out.replace(/\\/g, '/'));
  const samples = [
    ['选择', '選擇'], ['批量复制', '批量複製'], ['默认皮肤', '預設皮膚'], ['文件夹', '資料夾'],
    ['鼠标中键', '滑鼠中鍵'], ['设置', '設定'], ['保存失败', '保存失敗'], ['撤销', '撤銷'],
    ['网格吸附', '網格吸附'], ['锁定间距', '鎖定間距'], ['新建', '新增'], ['信息', '資訊'],
  ];
  let bad = 0;
  for (const [cn, tw] of samples) {
    const got = mod.s2t(mod.applyTwPhrases(cn));
    if (got !== tw) { bad++; console.error(`  FAIL: 转换 ${cn} -> ${got} (期望 ${tw})`); }
  }
  assert(bad === 0, `s2t+术语 转换抽样 ${samples.length} 条`);
  // translate 回退链: en=原文; zh-CN=词典; zh-TW=转换; 未知 key=en 原文
  mod.setLang('en');
  assert(mod.translate('en', 'app.undo', 'Undo') === 'Undo', 'en: 内联英文原文');
  mod.setLang('zh-CN');
  assert(mod.translate('zh-CN', 'app.undo', 'Undo') === dictVal['app.undo'], 'zh-CN: 词典译文');
  mod.setLang('zh-TW');
  assert(mod.translate('zh-TW', 'app.undo', 'Undo') === mod.s2t(mod.applyTwPhrases(dictVal['app.undo'])), 'zh-TW: 词典译文转换');
  assert(mod.translate('zh-TW', 'no.such.key', 'Fallback text') === 'Fallback text', '未知 key 回退英文原文');
  assert(mod.translate('zh-CN', 'no.such.key2', 'Fallback {n}', { n: 3 }) === 'Fallback 3', '插值 {n} 替换');
}

section('F: 编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

section('G: 运行时语言切换 (Electron CDP)');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9452;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: 'ignore' });
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
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuSetLang)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪 (无 __osuSetLang — 需先 npm run build)');
    const bodyText = () => evalJs('document.body.innerText');
    const switcherVal = () => evalJs(`document.querySelector('[data-lang-switcher] select')?.value ?? null`);

    await evalJs(`window.__osuSetLang('en')`); await sleep(400);
    let txt = await bodyText();
    assert(txt.includes('Undo') && txt.includes('Hotkeys') && !txt.includes('撤销'), 'en: 界面英文 (Undo/Hotkeys, 无中文)');
    assert(await evalJs(`localStorage.getItem('i18n.lang')`) === 'en', 'localStorage 持久化 en');
    assert(await switcherVal() === 'en', '切换器跟随 en');

    await evalJs(`window.__osuSetLang('zh-TW')`); await sleep(400);
    txt = await bodyText();
    assert(txt.includes('撤銷') && !txt.includes('撤销'), 'zh-TW: 界面繁體 (撤銷)');

    await evalJs(`window.__osuSetLang('debug')`); await sleep(400);
    txt = await bodyText();
    assert(txt.includes('[[app.undo]]'), 'debug: 渲染 [[key]] (lazer debug locale)');

    await evalJs(`window.__osuSetLang('zh-CN')`); await sleep(400);
    txt = await bodyText();
    assert(txt.includes('撤销') && txt.includes('快捷键'), 'zh-CN: 界面简体中文恢复');
    assert(await switcherVal() === 'zh-CN', '切换器跟随 zh-CN');
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: G 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

console.log(failures ? `\nVERIFIER_V346_FAILED: ${failures} 处失败` : '\nVERIFIER_V346_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
