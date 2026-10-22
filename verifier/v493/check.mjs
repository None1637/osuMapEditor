// 验证器 v493: GitHub Releases 更新检测
//   - updateCheckCore 纯函数 (parseSemverTag/isNewer/pickUpdateInfo; vXXX 构建标签忽略)
//   - main.cjs: check-update IPC (主进程 https 请求 GitHub API, 8s 超时) + open-external (仅 https)
//     + 关于菜单「检查更新」; preload/bridge 暴露; UpdatePrompt 徽章→确认窗→立即更新/跳过/暂不
//   - CDP: __osuUpdateTest 注入假更新 → 徽章 → 开窗看更新内容 → 暂不保留徽章 → 跳过记 localStorage
//     → 同版本自动不再提示, 手动仍开窗; 菜单定义含「检查更新」
// 运行: npm run build 后 node verifier/v493/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';
import { parseSemverTag, isNewer, pickUpdateInfo } from '../../server/updateCheckCore.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('updateCheckCore 纯函数');
{
  assert(JSON.stringify(parseSemverTag('v0.1.4')) === '[0,1,4]', '解析 v0.1.4');
  assert(JSON.stringify(parseSemverTag('1.2.3')) === '[1,2,3]', '解析无前缀 1.2.3');
  assert(parseSemverTag('v492') === null && parseSemverTag('') === null && parseSemverTag(null) === null, 'v492 构建标签/空值忽略');
  assert(isNewer([0, 1, 4], [0, 1, 3]) && isNewer([0, 2, 0], [0, 1, 9]) && isNewer([1, 0, 0], [0, 9, 9]), 'isNewer 逐位比较');
  assert(!isNewer([0, 1, 3], [0, 1, 3]) && !isNewer([0, 1, 2], [0, 1, 3]), '同版/旧版不提示');
  const rel = { tag_name: 'v0.2.0', name: 'v0.2.0', body: '- 修复A', html_url: 'https://github.com/x/r/releases/tag/v0.2.0', published_at: '2026-01-01', draft: false };
  const info = pickUpdateInfo(rel, '0.1.3');
  assert(info && info.version === '0.2.0' && info.body === '- 修复A' && info.url.includes('releases'), 'pickUpdateInfo 提取');
  assert(pickUpdateInfo(rel, '0.2.0') === null && pickUpdateInfo({ ...rel, draft: true }, '0.1.3') === null
    && pickUpdateInfo({ ...rel, tag_name: 'v493' }, '0.1.3') === null, '同版/草稿/非语义 tag → null');
}

section('源码');
{
  const main = read('electron/main.cjs');
  assert(/ipcMain\.handle\("check-update"/.test(main) && /RELEASES_LATEST_URL/.test(main), 'check-update IPC');
  assert(/"User-Agent": "osuMapEditor-update-check"/.test(main) && /timeout: 8000/.test(main), 'GitHub API UA + 超时');
  assert(/updateCheckCore\.pickUpdateInfo\(rel, APP_VERSION\)/.test(main), '主进程版本比较');
  assert(/ipcMain\.handle\("open-external"[\s\S]*?url\.startsWith\("https:\/\/"\)[\s\S]*?shell\.openExternal/.test(main), 'open-external 仅放行 https');
  assert(/"menu\.check_update"/.test(main) && /send\(\{ type: "check-update" \}\)/.test(main), '关于菜单「检查更新」');
  const pre = read('electron/preload.cjs');
  assert(/checkUpdate: \(\) => ipcRenderer\.invoke\("check-update"\)/.test(pre) && /openExternal: \(url\)/.test(pre), 'preload 暴露');
  const br = read('src/osu/electronBridge.ts');
  assert(/checkUpdate\(\): Promise<ElectronUpdateResult>/.test(br) && /\{ type: 'check-update' \}/.test(br), 'bridge 类型');
  const up = read('src/components/UpdatePrompt.tsx');
  assert(/data-update-badge/.test(up) && /data-update-dialog/.test(up) && /data-update-body/.test(up), '徽章 + 确认窗 + 更新内容区');
  assert(/data-update-accept/.test(up) && /data-update-skip/.test(up) && /data-update-later/.test(up), '立即更新/跳过此版本/暂不');
  assert(/SKIP_KEY = 'osu-editor:updateSkip'/.test(up), '跳过版本 localStorage 记忆');
  assert(/__osuUpdateTest/.test(up), 'CDP 测试钩子');
  const app = read('src/App.tsx');
  assert(/cmd\.type === 'check-update'\) \{ void manualCheckUpdate\(\)/.test(app) && /<UpdatePrompt \/>/.test(app), 'App 接线');
  const dict = read('src/i18n/dicts/zh-CN/app.ts');
  for (const k of ['update.badge', 'update.title', 'update.accept', 'update.skip', 'update.later', 'update.checking', 'update.latest', 'update.failed'])
    assert(dict.includes(`'${k}'`), `zh-CN ${k}`);
}

section('CDP: 徽章 → 确认窗 → 跳过/手动链路');
{
  const PORT = 9507;
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
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const info = { version: '9.9.9', name: 'v9.9.9', body: '- 修复A\\n- 新增B', url: 'https://github.com/None1637/osuMapEditor/releases/tag/v9.9.9', publishedAt: '2026-10-21T00:00:00Z' };
      const out = {};
      const q = (s) => document.querySelector(s);
      // 菜单定义含「检查更新」(normalizeEnv 置英文 → About/Check for Updates)
      const def = await window.osuEditor.getMenuDefinition();
      const about = def.find(m => m.label === '关于' || m.label === 'About');
      out.menuItem = !!(about && about.submenu.some(m => m.label === '检查更新' || m.label === 'Check for Updates'));
      // 1) 注入假更新 → 徽章
      window.__osuUpdateTest(info, false);
      await sleep(250);
      out.badge = !!q('[data-update-badge]');
      // 2) 点击徽章 → 确认窗显示更新内容
      q('[data-update-open]').click();
      await sleep(200);
      out.dialog = !!q('[data-update-dialog]');
      out.body = q('[data-update-body]') ? q('[data-update-body]').textContent : '';
      // 3) 暂不 → 关窗保留徽章
      q('[data-update-later]').click();
      await sleep(150);
      out.laterKeepsBadge = !q('[data-update-dialog]') && !!q('[data-update-badge]');
      // 4) 重开 → 跳过此版本
      q('[data-update-open]').click();
      await sleep(150);
      q('[data-update-skip]').click();
      await sleep(150);
      out.skipSaved = localStorage.getItem('osu-editor:updateSkip') === '9.9.9';
      out.goneAfterSkip = !q('[data-update-dialog]') && !q('[data-update-badge]');
      // 5) 同版本自动检测不再提示, 手动仍开窗
      window.__osuUpdateTest(info, false);
      await sleep(200);
      out.autoSuppressed = !q('[data-update-badge]');
      window.__osuUpdateTest(info, true);
      await sleep(200);
      out.manualStillOpens = !!q('[data-update-dialog]');
      q('[data-update-later]').click();
      localStorage.removeItem('osu-editor:updateSkip');
      return out;
    })()`);

    assert(out.menuItem === true, '关于菜单含「检查更新」');
    assert(out.badge === true, '注入更新 → 右下角徽章');
    assert(out.dialog === true && /修复A/.test(out.body || '') && /新增B/.test(out.body || ''), `确认窗显示更新内容 (实际 "${(out.body || '').slice(0, 40)}")`);
    assert(out.laterKeepsBadge === true, '暂不 → 关窗保留徽章');
    assert(out.skipSaved === true && out.goneAfterSkip === true, '跳过此版本 → localStorage 记忆 + 徽章/窗口关闭');
    assert(out.autoSuppressed === true, '已跳过版本自动检测不再提示');
    assert(out.manualStillOpens === true, '手动检查已跳过版本仍开窗');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V493_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V493_ALL_TESTS_PASSED');
