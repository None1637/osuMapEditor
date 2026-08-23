// CDP v94 端到端: exe 启动恢复上次谱面
// 方式: 注入 mock window.osuEditor (Page.addScriptToEvaluateOnNewDocument) 模拟 Electron 环境,
//       并在页面层 mock /api/local-fs/* (内存虚拟歌曲目录, 不依赖 dev server 真实曲库配置)
// A) recents[0] = 虚拟难度 => 启动自动打开该谱面 (mapSource.fileName 命中), 直进编辑器 (曲库界面不出现)
// B) recents = [] => 回退演示谱面, 曲库界面显示 (exe 默认行为)
// 运行: node verifier/v94/cdp-v94.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const FOLDER = '12345 FakeArtist - FakeTitle';
const OSU_FILE = 'FakeArtist - FakeTitle (me) [Hard].osu';
const OSU_TEXT = `osu file format v14

[General]
AudioFilename: a.mp3

[Metadata]
Title:FakeTitle
Artist:FakeArtist
Creator:me
Version:Hard

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,1,0,80,1,0

[HitObjects]
100,100,1000,5,0
200,100,1500,1,0
`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v94-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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

/** mock window.osuEditor (ElectronAPI) + /api/local-fs/* (内存虚拟歌曲目录); recents 由参数注入 */
function mockScript(recents) {
  return `
    window.osuEditor = {
      isElectron: true,
      getSettings: async () => ({ osuPath: null, songsDir: null, skinDir: null, skinName: null, firstRun: false, suggestedOsuPath: null }),
      pickOsuDir: async () => null,
      listSkinDirs: async () => [],
      saveSettings: async () => ({ songsDir: null, skinDir: null, skinName: null }),
      onOpenSetup: () => {},
      menuState: () => {},
      onMenuCommand: () => () => {},
      getRecents: async () => ${JSON.stringify(recents)},
    };
    (() => {
      const realFetch = window.fetch.bind(window);
      const json = (o, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status }));
      window.fetch = (input, init) => {
        const url = String(input);
        if (!url.includes('api/local-fs/')) return realFetch(input, init);
        if (url.includes('api/local-fs/config'))
          return json({ songsDir: 'C:\\\\fake\\\\Songs', skinDir: null, songsName: 'Songs', skinName: null });
        if (url.includes('api/local-fs/list')) {
          const rel = new URL(url, location.origin).searchParams.get('rel') ?? '';
          return json(rel === ''
            ? [{ name: ${JSON.stringify(FOLDER)}, kind: 'directory' }]
            : [{ name: 'a.mp3', kind: 'file' }, { name: ${JSON.stringify(OSU_FILE)}, kind: 'file' }]);
        }
        if (url.includes('api/local-fs/file')) {
          const rel = new URL(url, location.origin).searchParams.get('rel') ?? '';
          if (rel.endsWith('.osu')) return Promise.resolve(new Response(${JSON.stringify(OSU_TEXT)}, { status: 200 }));
          if (rel.endsWith('.mp3')) return Promise.resolve(new Response('fake-audio', { status: 200 }));
          return Promise.resolve(new Response('not found', { status: 404 }));
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      };
    })();
  `;
}

async function waitStore(desc, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(500);
    try { if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)')) return; } catch { /* 导航中 */ }
  }
  throw new Error('等待超时: ' + desc);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');

  console.log('== A) recents[0] 存在 => 启动自动恢复该谱面, 直进编辑器');
  {
    const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript([{ folderRel: FOLDER, file: OSU_FILE }]) });
    await send('Page.navigate', { url: APP_URL });
    await waitStore('谱面加载');
    const src = await evalJs(`window.__osuStore.mapSource?.fileName ?? null`);
    assert(src === OSU_FILE, `恢复上次谱面 (实际 ${src})`);
    const title = await evalJs(`window.__osuStore.beatmap.metadata.title`);
    assert(title === 'FakeTitle', `谱面内容正确 (实际 ${title})`);
    await sleep(800); // 等 setShowLibrary(false) 生效
    const libVisible = await evalJs(`document.body.innerText.includes('📁 歌曲库')`);
    assert(!libVisible, '曲库界面未显示 (直进编辑器)');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }

  console.log('== B) recents 空 => 回退演示谱面, 曲库界面显示');
  {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript([]) });
    await send('Page.navigate', { url: APP_URL });
    await waitStore('演示谱面加载');
    const src = await evalJs(`window.__osuStore.mapSource ?? null`);
    assert(src === null, '演示谱面 (无来源)');
    const libVisible = await evalJs(`document.body.innerText.includes('📁 歌曲库')`);
    assert(libVisible, '曲库界面显示 (exe 默认行为)');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V94_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V94_CDP_PASSED');
