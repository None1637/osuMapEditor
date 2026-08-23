// CDP v77 端到端: Electron 菜单渲染端逻辑 (经 window.__osuMenuCmd 驱动; 原生菜单本身为 CJS 源码断言)
// A) 非 Electron 环境: window.osuEditor 不存在, 菜单模块惰性 (应用正常, 无异常)
// B) __osuMenuCmd open: 经服务器目录加载夹具难度 => beatmap 切换 + mapSource 记录 (folderRel/fileName)
// C) 同文件夹第二个难度 => 切换成功 ("打开一个难度" 路径)
// D) 打开不存在的文件 => 静默失败, 当前谱面不变
// 布景: 临时写 local-dirs.json 指向夹具 Songs 目录 (vite 中间件每请求重读), 结束后恢复
// 运行: node verifier/v77/cdp-v77.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL_DIRS = path.join(ROOT, 'local-dirs.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// ---------- 夹具: 临时 Songs 目录 (两难度) + local-dirs.json 指向它 ----------
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'v77-songs-'));
const songDir = path.join(fixture, 'FixtureSong');
fs.mkdirSync(songDir, { recursive: true });
const osuText = (title, version) => `osu file format v14

[General]
AudioFilename: none.mp3
Mode: 0

[Metadata]
Title:${title}
Artist:Verifier
Creator:CDP
Version:${version}

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
256,192,1000,1,0,0:0:0:0:
300,192,1500,1,0,0:0:0:0:
`;
fs.writeFileSync(path.join(songDir, 'diff1.osu'), osuText('V77 Fixture One', 'Hard'), 'utf-8');
fs.writeFileSync(path.join(songDir, 'diff2.osu'), osuText('V77 Fixture Two', 'Insane'), 'utf-8');
const localDirsBackup = fs.existsSync(LOCAL_DIRS) ? fs.readFileSync(LOCAL_DIRS, 'utf-8') : null;
fs.writeFileSync(LOCAL_DIRS, JSON.stringify({ songsDir: fixture.replace(/\\/g, '/'), skinDir: '' }), 'utf-8');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v77-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
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
  if (r.error) throw new Error('CDP 错误: ' + JSON.stringify(r.error).slice(0, 300));
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuMenuCmd)');
  }
  if (!ready) throw new Error('应用未就绪');

  console.log('== A) 非 Electron: 菜单模块惰性, window.osuEditor 不存在');
  {
    const r = await evalJs(`[typeof window.osuEditor, typeof window.__osuMenuCmd]`);
    assert(r[0] === 'undefined', 'window.osuEditor undefined (浏览器/dev)');
    assert(r[1] === 'function', '__osuMenuCmd 调试暴露');
  }

  console.log('== B) open 命令: 加载夹具难度 1');
  {
    await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'FixtureSong', file: 'diff1.osu' })`);
    await sleep(500);
    const r = await evalJs(`(() => {
      const s = window.__osuStore;
      return [s.beatmap.metadata.title, s.beatmap.metadata.version, s.mapSource?.fileName ?? null, s.mapSource?.dir?.serverRel ?? null];
    })()`);
    assert(r[0] === 'V77 Fixture One' && r[1] === 'Hard', `难度 1 已加载 (${r[0]} [${r[1]}])`);
    assert(r[2] === 'diff1.osu' && r[3] === 'FixtureSong', `mapSource 记录 (file=${r[2]}, rel=${r[3]})`);
  }

  console.log('== C) open 命令: 切换同文件夹难度 2 ("打开一个难度" 路径)');
  {
    await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'FixtureSong', file: 'diff2.osu' })`);
    await sleep(500);
    const r = await evalJs(`[window.__osuStore.beatmap.metadata.title, window.__osuStore.beatmap.metadata.version]`);
    assert(r[0] === 'V77 Fixture Two' && r[1] === 'Insane', `难度 2 已加载 (${r[0]} [${r[1]}])`);
  }

  console.log('== D) open 不存在文件: 静默失败, 谱面不变');
  {
    await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'FixtureSong', file: 'ghost.osu' })`);
    await sleep(400);
    const r = await evalJs(`window.__osuStore.beatmap.metadata.title`);
    assert(r === 'V77 Fixture Two', `谱面保持 (${r})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  // 恢复 local-dirs.json
  try {
    if (localDirsBackup !== null) fs.writeFileSync(LOCAL_DIRS, localDirsBackup, 'utf-8');
    else fs.rmSync(LOCAL_DIRS, { force: true });
  } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
  try { fs.rmSync(fixture, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V77_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V77_CDP_PASSED');
