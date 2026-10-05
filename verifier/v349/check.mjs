// 验证器 v349: 默认语言英文 + 首次启动先选语言
//   - i18n detect: ?lang= > localStorage > navigator.language 探测 > 'en'
//     (v349b: 系统语言探测放回作回退, 仅排在存储之后);
//   - 无 ?lang= 且无存储 → LangFirstRun 浮层 (z 最高) 强制先选, 选后持久化不再出现;
//   - setLang 未变化也落盘 (首启默认 en 时选 English 需持久化, 否则下次还弹)。
// 运行: npm run build 后 node verifier/v349/check.mjs  (B 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('A: 源码形态');
{
  const i18n = read('src/i18n/index.ts');
  assert(/urlLang\(\) \?\? savedLang\(\)/.test(i18n) && /navigator\.language/.test(i18n) && /nav\.startsWith\('zh'\)\) return 'zh-CN'/.test(i18n), '默认链: ?lang= > 存储 > 系统语言探测 > en (v349b 探测放回)');
  const detectBody = i18n.match(/function detect\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert(detectBody.indexOf('savedLang()') < detectBody.indexOf('navigator.language') && detectBody.indexOf('navigator.language') < detectBody.lastIndexOf("return 'en'"), '探测仅作回退: detect 体内排在存储之后、默认 en 之前');
  assert(/export function isLangUnset/.test(i18n) && /!urlLang\(\) && !savedLang\(\)/.test(i18n), 'isLangUnset 首启判定导出');
  const setLangBody = i18n.match(/export function setLang[\s\S]*?\n\}/)?.[0] ?? '';
  assert(setLangBody.indexOf('localStorage.setItem') < setLangBody.indexOf('if (l === lang) return'), 'setLang 未变化也先持久化');
  const app = read('src/App.tsx');
  assert(/<LangFirstRun \/>/.test(app), 'App 渲染 LangFirstRun');
  const lfr = read('src/components/LangFirstRun.tsx');
  assert(/isLangUnset/.test(lfr) && /data-lang-first-run/.test(lfr) && /data-lang-pick/.test(lfr), 'LangFirstRun: 首启判定 + 探针钩子');
  assert(/translate\('zh-CN', TITLE_KEY/.test(lfr) && /translate\('zh-TW', TITLE_KEY/.test(lfr) && /translate\('en', TITLE_KEY/.test(lfr), '标题三语并列 (不依赖当前语言)');
  assert(read('src/i18n/dicts/zh-CN/app.ts').includes("'app.lang_first_title': '选择语言'"), 'zh-CN 词典含 app.lang_first_title');
}

section('B: CDP 首启流程 (清存储 → 浮层 → 选繁體 → 持久化 → 重启不再弹)');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9454;
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
    const waitReady = async () => {
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(500);
        ready = await evalJs('!!(window.__osuStore && document.querySelector(\'[data-lang-switcher]\'))').catch(() => false);
      }
      if (!ready) throw new Error('应用未就绪');
    };
    // reload 后等待新页面: 旧页置标记, 新页标记消失才算就绪 (否则 waitReady 会命中旧页 DOM)
    const reloadAndWait = async () => {
      await evalJs('window.__v349Old = 1');
      await send('Page.reload', { ignoreCache: true });
      let fresh = false;
      for (let i = 0; i < 60 && !fresh; i++) {
        await sleep(500);
        fresh = await evalJs('!window.__v349Old && !!(window.__osuStore && document.querySelector(\'[data-lang-switcher]\'))').catch(() => false);
      }
      if (!fresh) throw new Error('reload 后新页面未就绪');
    };
    await waitReady();

    // 清掉语言偏好 + 强制系统语言 en-US (v349b: navigator 探测作回退, 需固定系统语言才能确定性断言)
    await evalJs(`localStorage.removeItem('i18n.lang')`);
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source:
      `Object.defineProperty(navigator, 'language', { get: () => 'en-US', configurable: true });
       Object.defineProperty(navigator, 'languages', { get: () => ['en-US'], configurable: true });` });
    await reloadAndWait();

    assert(await evalJs(`!!document.querySelector('[data-lang-first-run]')`), '首启: 语言选择浮层出现');
    assert(await evalJs(`document.body.innerText.includes('Choose your language')`), '浮层标题含英文行');
    assert(await evalJs(`!!document.querySelector('[data-lang-pick="zh-CN"]') && !!document.querySelector('[data-lang-pick="zh-TW"]') && !!document.querySelector('[data-lang-pick="en"]')`), '三个语言按钮齐全');
    assert(await evalJs(`document.querySelector('[data-hotkey-panel-btn]')?.textContent.includes('Hotkeys')`), '系统语言 en: 未选择前界面默认英文 (Hotkeys)');

    // v349b: 系统语言 zh-TW → 探测回退生效 (仍未选择, 浮层在, 界面已繁體)
    await send('Page.addScriptToEvaluateOnNewDocument', { source:
      `Object.defineProperty(navigator, 'language', { get: () => 'zh-TW', configurable: true });
       Object.defineProperty(navigator, 'languages', { get: () => ['zh-TW'], configurable: true });` });
    await reloadAndWait();
    assert(await evalJs(`!!document.querySelector('[data-lang-first-run]')`), '系统语言 zh-TW: 浮层仍出现 (未持久化)');
    assert(await evalJs(`document.querySelector('[data-hotkey-panel-btn]')?.textContent.includes('快捷鍵')`), '系统语言 zh-TW: 探测生效界面繁體 (快捷鍵)');

    await evalJs(`document.querySelector('[data-lang-pick="zh-TW"]').click()`);
    await sleep(500);
    assert(await evalJs(`!document.querySelector('[data-lang-first-run]')`), '选择后浮层消失');
    assert(await evalJs(`localStorage.getItem('i18n.lang')`) === 'zh-TW', '选择持久化 zh-TW');
    assert(await evalJs(`document.querySelector('[data-hotkey-panel-btn]')?.textContent.includes('快捷鍵')`), '界面切换繁體 (快捷鍵)');

    await reloadAndWait();
    assert(await evalJs(`!document.querySelector('[data-lang-first-run]')`), '二次启动: 浮层不再出现');
    assert(await evalJs(`document.querySelector('[data-hotkey-panel-btn]')?.textContent.includes('快捷鍵')`), '二次启动: 语言保持繁體');
    // 还原为 en, 避免影响后续 verifier 的 DOM 断言
    await evalJs(`window.__osuSetLang('en')`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('C: 编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V349_FAILED: ${failures} 处失败` : '\nVERIFIER_V349_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
