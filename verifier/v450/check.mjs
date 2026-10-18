// v450: Electron 服务器模式音频解码缓存 (v444) 生效 — /api/local-fs/file 带真实 mtime
// 背景: serverFile.getFile() 旧实现 new File([blob], name) 不带 lastModified (=构造时刻, 每次取件都不同),
//   v444 audioKey (name:size:lastModified) 在服务器模式永不命中 → 每次刷新谱面都重新 fetch+decodeAudioData (秒级)。
//   修复: 服务端 localFsCore 响应头 X-File-Mtime 带真实 mtimeMs (两个挂载点 main.cjs/vite.config.ts 透传),
//   前端 serverFile 构造 File 时写入 lastModified (头缺失回退旧行为); 所有 getFile 消费者同受益。
// CDP 实测: 隔离 Electron 开 cygnus → 插桩 actx.decodeAudioData 计数 (按 >1MB 负载区分歌曲/采样) →
//   刷新 ×2 应 0 次歌曲解码且 audioCache.key 稳定 (缓存命中); 然后 Node 侧 utimes 改 audio.mp3 mtime
//   (+60s, 测完还原) 再刷新 → 应恰好 1 次解码且 key 变更 (外部修改正确重解码)。
// 运行: node verifier/v450/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv, realSettingsPath } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9465;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAP = { folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' };

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ---------- a) 静态断言 ----------
{
  const core = fs.readFileSync(path.join(root, 'server/localFsCore.mjs'), 'utf8');
  check('localFsCore file 端点 stat 取 mtime', /fs\.promises\.stat\(abs\)/.test(core));
  check('localFsCore 响应头 X-File-Mtime', /headers:\s*\{\s*"X-File-Mtime":\s*String\(Math\.round\(mtimeMs\)\)/.test(core));
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  check('main.cjs 透传附加响应头', /\.\.\.\(r\.headers \?\? \{\}\)/.test(main));
  const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  check('vite.config.ts 透传附加响应头', /if \(r\.headers\) for \(const \[k, v\] of Object\.entries\(r\.headers\)\)/.test(vite));
  const dts = fs.readFileSync(path.join(root, 'server/localFsCore.d.mts'), 'utf8');
  check('d.mts 类型含 headers', /headers\?:\s*Record<string, string>/.test(dts));
  const sfs = fs.readFileSync(path.join(root, 'src/osu/serverFs.ts'), 'utf8');
  check('serverFs 读 X-File-Mtime 写 lastModified', /X-File-Mtime/.test(sfs) && /new File\(\[blob\], name, \{ lastModified: mtime \}\)/.test(sfs));
  check('serverFs 头缺失回退旧行为', /Number\.isFinite\(mtime\) && mtime > 0/.test(sfs) && /: new File\(\[blob\], name\)/.test(sfs));
}

// ---------- b) CDP 实测 ----------
const { proc, profile } = launchIsolatedElectron(root, PORT);
let target;
let audioAbs = null; // utimes 还原用
let origMtime = null;
try {
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('CONNECT_FAILED');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };

  await normalizeEnv(evalJs);
  await evalJs(`window.__osuMenuCmd(${JSON.stringify({ type: 'open', ...MAP })})`);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (await evalJs(`(() => !!window.__osuStore.audioBuffer)()`)) break;
  }
  const opened = await evalJs(`(() => {
    const s = window.__osuStore;
    return s.audioBuffer ? { key: s.audioCache?.key ?? null, audioFile: s.beatmap.general.audioFilename, durS: +s.audioBuffer.duration.toFixed(1) } : null;
  })()`);
  if (!opened) throw new Error('首次加载/解码未完成');
  check('首次加载解码完成 (audioCache 已入栈)', !!opened.key, opened.key);
  const firstKey = opened.key;

  // 插桩: actx.decodeAudioData 计数 (>1MB 负载 = 歌曲解码; hitsound 采样 KB 级不计)
  await evalJs(`(() => {
    const s = window.__osuStore;
    const orig = s.actx.decodeAudioData.bind(s.actx);
    window.__v450 = { big: 0, small: 0 };
    s.actx.decodeAudioData = (buf, ...rest) => {
      if (buf.byteLength > 1048576) window.__v450.big++; else window.__v450.small++;
      return orig(buf, ...rest);
    };
  })()`);

  // 刷新并计时; expectMiss=true 时额外等新 AudioBuffer 落地 (解码完成)
  const reload = (expectMiss) => evalJs(`(async () => {
    const s = window.__osuStore; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const prevBm = s.beatmap, prevBuf = s.audioBuffer;
    const t0 = performance.now();
    document.querySelector('[data-reload-map-btn]').click();
    while (s.beatmap === prevBm) { if (performance.now() - t0 > 20000) return { ms: -1, err: 'timeout-load' }; await sleep(50); }
    const loadMs = performance.now() - t0;
    let decodeMs = 0;
    if (${expectMiss}) {
      const t1 = performance.now();
      while (s.audioBuffer === prevBuf || !s.audioBuffer) { if (performance.now() - t1 > 40000) return { ms: -1, err: 'timeout-decode' }; await sleep(100); }
      decodeMs = performance.now() - t1;
    }
    return { ms: Math.round(loadMs + decodeMs), loadMs: Math.round(loadMs), decodeMs: Math.round(decodeMs), key: s.audioCache?.key ?? null };
  })()`);

  // 刷新 ×2: 应命中缓存 (0 次歌曲解码, key 稳定)
  const r1 = await reload(false);
  const r2 = await reload(false);
  const big1 = await evalJs(`window.__v450.big`);
  console.log(`  刷新#1 ${r1.ms}ms / 刷新#2 ${r2.ms}ms (命中缓存); 歌曲解码次数 = ${big1}`);
  check('刷新×2 零歌曲解码 (v444 缓存命中)', big1 === 0, `big=${big1}`);
  check('audioCache.key 跨刷新稳定 (真实 mtime)', r1.key === firstKey && r2.key === firstKey, `${firstKey} → ${r1.key} → ${r2.key}`);

  // mtime 变化用例: Node 侧 utimes +60s → 刷新应重新解码且 key 变更 (测完 finally 还原)
  const songsDir = JSON.parse(fs.readFileSync(realSettingsPath(), 'utf8')).songsDir;
  audioAbs = path.join(songsDir, MAP.folderRel, opened.audioFile);
  origMtime = fs.statSync(audioAbs).mtimeMs;
  const d = new Date(origMtime + 60000);
  fs.utimesSync(audioAbs, d, d);
  await sleep(300);
  const r3 = await reload(true);
  const big2 = await evalJs(`window.__v450.big`);
  console.log(`  刷新#3 (mtime+60s) ${r3.ms}ms (load ${r3.loadMs} + decode ${r3.decodeMs}); 歌曲解码次数 = ${big2}`);
  check('mtime 变化后正确重新解码 (恰好 1 次)', big2 === 1, `big=${big2}`);
  check('mtime 变化后 audioCache.key 更新', !!r3.key && r3.key !== firstKey, `${r3.key}`);
  check('缓存命中刷新显著快于重解码', r1.ms < r3.ms, `${r1.ms}ms vs ${r3.ms}ms`);

  // 功能: 解码缓存链路的音频仍可播放
  const playOk = await evalJs(`(async () => {
    const s = window.__osuStore; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    s.seek(1000); s.play(); await sleep(500);
    const playing = s.playing; s.pause();
    return { playing, bg: !!(s.backgroundImg && s.backgroundImg.naturalWidth) };
  })()`);
  check('刷新后播放/暂停可用', playOk.playing === true);
  check('背景图照常加载 (getFile 消费者回归)', playOk.bg === true);
} finally {
  if (audioAbs && origMtime !== null) {
    try { const d = new Date(origMtime); fs.utimesSync(audioAbs, d, d); } catch (e) { console.error('  warn: mtime 还原失败', String(e)); }
  }
  await killIsolated(proc, profile);
}

if (failures > 0) { console.error(`\n${failures} 项断言失败`); process.exit(1); }
console.log('\n全部断言通过');
