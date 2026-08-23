// CDP 冒烟测试: 用无头 Edge 驱动真实 app, 注入 mock 目录句柄, 验证曲库选目录→扫描→选难度全流程
// 运行: node verifier/v8/cdp-smoke.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9333;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

// ---------- 启动无头 Edge ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const targets = await res.json();
      const page = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleLogs = [];
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled')
    consoleLogs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500); // 等 vite dev 编译 + React 挂载

  console.log('== 环境检查');
  const env = await evalJs(`JSON.stringify({
    picker: typeof window.showDirectoryPicker,
    idb: typeof indexedDB,
    title: document.title,
    buttons: [...document.querySelectorAll('button')].length,
  })`);
  console.log(' ', env);
  const envObj = JSON.parse(env);
  assert(envObj.title.includes('osu'), 'app 已加载');

  console.log('== 注入 mock Songs 目录 + 错误收集');
  await evalJs(`(() => {
    window.__errs = [];
    window.addEventListener('unhandledrejection', e => window.__errs.push('unhandledrejection: ' + (e.reason?.message ?? e.reason)));
    const OSU = [
      'osu file format v14', '', '[General]', 'AudioFilename: audio.mp3', 'Mode: 0', '',
      '[Metadata]', 'Title:TestSong', 'TitleUnicode:测试歌曲', 'Artist:TestArtist', 'Creator:Tester', 'Version:Insane', '',
      '[Difficulty]', 'ApproachRate:9', 'SliderMultiplier:1.4', '',
      '[TimingPoints]', '1000,500,4,1,0,80,1,0', '',
      '[HitObjects]', '256,192,5000,5,0', ''].join('\\n');
    const mkFile = (name, text) => ({ kind: 'file', name, getFile: async () => new File([text], name) });
    const mkDir = (name, children) => ({
      kind: 'directory', name,
      entries: async function* () { for (const [n, c] of Object.entries(children)) yield [n, c]; },
      getFileHandle: async (n) => {
        const c = children[n];
        if (!c || c.kind !== 'file') throw new DOMException('not found', 'NotFoundError');
        return c;
      },
    });
    const song = (id) => mkDir(id + ' TestArtist - TestSong', {
      ['TestArtist - TestSong (Tester) [Insane].osu']: mkFile('TestArtist - TestSong (Tester) [Insane].osu', OSU),
      'audio.mp3': mkFile('audio.mp3', 'fake'),
    });
    const children = {};
    for (let i = 1; i <= 50; i++) children['song' + i] = song(i);
    const root = mkDir('Songs', children);
    root.queryPermission = async () => 'granted';
    root.requestPermission = async () => 'granted';
    window.showDirectoryPicker = async (opts) => { window.__pickerOpts = opts; return root; };
    return 'injected';
  })()`);
  assert(true, 'mock 已注入 (50 个歌曲目录)');

  console.log('== 打开曲库面板');
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'))?.click()`);
  await sleep(400);
  const panel = await evalJs(`JSON.stringify({
    open: !!document.querySelector('.fixed.inset-0'),
    hasChooseBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('选择 Songs 目录')),
  })`);
  const p = JSON.parse(panel);
  assert(p.open, '曲库面板已打开');
  assert(p.hasChooseBtn, '显示「选择 Songs 目录」按钮');

  console.log('== 点击「选择 Songs 目录…」');
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('选择 Songs 目录…'))?.click()`);
  await sleep(1500);
  const after = await evalJs(`JSON.stringify({
    uiError: document.querySelector('.fixed.inset-0 .text-red-400')?.textContent ?? null,
    header: document.querySelector('.fixed.inset-0 .text-xs.text-slate-500')?.textContent ?? null,
    rowTexts: [...document.querySelectorAll('.fixed.inset-0 div[style*="absolute"]')].slice(0, 5).map(e => e.textContent),
    rowCount: document.querySelectorAll('.fixed.inset-0 div[style*="absolute"]').length,
    listClientH: document.querySelector('.fixed.inset-0 .overflow-y-auto')?.clientHeight ?? 0,
    badge: [...document.querySelectorAll('.fixed.inset-0 div[style*="absolute"] span')].map(e => e.textContent).find(t => t && t.includes('难度')) ?? null,
    errs: window.__errs,
  })`);
  const a = JSON.parse(after);
  console.log('  header:', a.header, '| 可见行数:', a.rowCount, '| 列表高度:', a.listClientH, '| 徽标:', a.badge);
  assert(a.uiError === null, '选择目录后无 UI 错误' + (a.uiError ? ': ' + a.uiError : ''));
  assert(a.header && a.header.includes('50 个歌曲目录'), '头部显示扫描到 50 个目录');
  // 列表容器被约束在面板内 (< 内容总高 50*26=1300), 即可滚动 = min-h-0 修复生效
  assert(a.listClientH > 200 && a.listClientH < 50 * 26, '滚动容器高度被约束 (' + a.listClientH + 'px < 1300px 内容高)');
  assert(a.rowCount > 0 && a.rowCount <= Math.ceil(a.listClientH / 26) + 21, '渲染行数在虚拟化窗口内 (' + a.rowCount + ' 行)');
  assert(a.badge !== null, '难度数徽标已懒加载 (' + a.badge + ')');
  assert(a.errs.length === 0, '无未捕获 Promise 异常' + (a.errs.length ? ': ' + a.errs[0] : ''));

  console.log('== 点击第一个歌曲目录 -> 难度列表');
  await evalJs(`document.querySelector('.fixed.inset-0 div[style*="absolute"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(600);
  const diffs = await evalJs(`JSON.stringify({
    diffTexts: [...document.querySelectorAll('.fixed.inset-0 .flex-1.overflow-y-auto:last-child .truncate, .fixed.inset-0 .flex-1.min-h-0 .truncate')].map(e => e.textContent).slice(0, 6),
    hasInsane: document.querySelector('.fixed.inset-0')?.textContent.includes('[Insane]') ?? false,
    errs: window.__errs,
  })`);
  const d = JSON.parse(diffs);
  assert(d.hasInsane, '难度列表显示 [Insane]');
  assert(d.errs.length === 0, '选目录无异常');

  console.log('== 控制台与异常');
  const errs = consoleLogs.filter(l => l.startsWith('error') || l.startsWith('warning'));
  if (errs.length) console.log('  console:', errs.slice(0, 5).join(' | '));
  if (exceptions.length) console.log('  exceptions:', exceptions.slice(0, 5).join(' | '));
  assert(exceptions.length === 0, '无页面异常');
} finally {
  try { ws.close(); } catch { }
  edge.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nCDP_SMOKE_ALL_PASSED' : `\n${failures} 条断言失败`);
process.exit(failures ? 1 : 0);
