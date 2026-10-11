// v383: CDP 验证器环境归一 — 共享 helper (纯测试基建, 不动 app 行为)
//
// 背景 (v383 根因调查): 早代 CDP 验证器直接用真实 userData (%APPDATA%/osu-map-editor) 跑 Electron —
//   每次运行加载谱面 → menu-state IPC → electron/main.cjs writeSettings 非原子 writeFileSync settings.json
//   (recents 持久化), verifier 收尾 electron.kill() (Windows = TerminateProcess, 立即断) 落在写入窗口
//   就把 settings.json 截成 0 字节; v281 等脚本还从 Node 侧直写真实 settings.json。
//   settings.json 一丢: firstRun 向导遮罩 (z-[60]) 吃点击、recents 丢失 → 停在曲库界面 →
//   App.tsx 快捷键处理直接 return → 热键类用例全灭; localStorage (i18n.lang / osu-editor:hotkeys /
//   osu-editor:display-settings) 被用例改写同样跨运行漂移。
//
// 方案: launchIsolatedElectron 每次运行 mkdtemp 独立 --user-data-dir, 播种真实 settings.json 副本
//   (缺失/损坏则不播种, 由 normalizeEnv 页面内兜底); settings/localStorage 写入全部落在临时 profile,
//   真实 userData 只读不写, 跑完 killIsolated 回收。normalizeEnv 在断言前统一页面环境。
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function realSettingsPath() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'osu-map-editor', 'settings.json');
}

// 启动隔离 Electron: 临时 user-data-dir (+ 默认播种真实 settings.json 副本, 可用 settingsPatch 合并改动,
// 例如 v281 的 hideTitleBar 开关 — 不再直写真实配置)。seed=false 模拟配置丢失场景 (首跑向导 + 曲库界面会出现)。
// 返回 { proc, profile }; 收尾必须 killIsolated(proc, profile)。
export function launchIsolatedElectron(root, port, { seed = true, settingsPatch = null, extraArgs = [] } = {}) {
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-verifier-'));
  if (seed) {
    try {
      const raw = fs.readFileSync(realSettingsPath(), 'utf8');
      const s = raw.trim() ? JSON.parse(raw) : null; // 0 字节/损坏 → 不播种
      if (s) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settingsPatch ? { ...s, ...settingsPatch } : s, null, 2) + '\n');
    } catch { /* 真实配置缺失/损坏 → 不播种, 走 normalizeEnv 兜底 */ }
  }
  const proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...extraArgs], { cwd: root, stdio: 'ignore' });
  return { proc, profile };
}

// 收尾: 杀进程 + 回收临时 profile (Windows 上句柄释放有延迟, 重试 ~8s; 失败仅告警不炸用例)
export async function killIsolated(proc, profile) {
  try { proc.kill(); } catch { /* 已退出 */ }
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); return; } catch { /* 重试 */ }
  }
  console.error('  warn: 临时 profile 清理失败 (可手工删除):', profile);
}

// 断言前环境归一 (evalJs = 各验证器已有的 Runtime.evaluate 封装):
//   1) 等 __osuStore.beatmap 就绪 (播种缺失时 App 回退演示谱面, beatmap 一样会有);
//   2) __osuSetLang('en') — 统一英文断言, 顺带关 v349 首跑语言框 (LangFirstRun 监听外部改语言);
//   3) resetSkinToDefault — 用户皮肤会让颜色类断言漂移 (v362/v378 教训; 仅改运行内存);
//   4) 清已知会被用例污染的 localStorage 键 (临时 profile 本是干净的, 双保险;
//      绝不 localStorage.clear() 全清 — 会触发 v349 首跑语言框);
//   5) 关曲库面板 — 走面板自己的 backdrop 语义 (mousedown+mouseup 都落在遮罩本体 → onClose,
//      见 SongLibrary.tsx 顶部注释); 不能只摘 DOM: App.tsx 快捷键在 showLibrary 时直接 return;
//   6) 首跑向导 (z-[60], 播种缺失时出现) 不动它 — 实测两种「关法」都炸:
//      el.remove() 摘 DOM → React 对不上节点, 下次 commit 崩溃; display:none →
//      向导内 useCounterZoom 量到 0 尺寸陷入 setState 死循环 (React #185), 整棵树卸载。
//      好在向导不拦快捷键、合成事件也不吃遮罩, 仅挡 CDP 真实点击 — 用真实 Input 域的
//      用例须走播种路径 (seed=true, 默认)。
// 返回 { wizardSeen, libraryClosed, beatmap } 供调用方按需断言。
export async function normalizeEnv(evalJs, { timeoutS = 30 } = {}) {
  let ready = false;
  for (let i = 0; i < timeoutS * 2 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
  }
  if (!ready) throw new Error('应用未就绪 (normalizeEnv)');
  return evalJs(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.__osuSetLang && window.__osuSetLang('en');
    window.__osuSkin && window.__osuSkin.resetSkinToDefault();
    for (const k of Object.keys(localStorage)) {
      if (k === 'osu-editor:hotkeys' || k === 'osu-editor:display-settings' || k.startsWith('osu-editor:conv:'))
        localStorage.removeItem(k);
    }
    // 首跑向导 (z-[60] 遮罩, 播种缺失时出现): 不动它 — el.remove() 会让 React commit 崩溃,
    //   display:none 会让向导内 useCounterZoom 死循环 (React #185, 整树卸载), v383 实测。
    //   它不拦快捷键, 合成事件也不吃遮罩; 仅挡 CDP 真实点击 (这类用例须走 seed=true 路径)。
    const wizardSeen = [...document.querySelectorAll('div.fixed.inset-0')].some(el => el.className.includes('z-[60]'));
    // 曲库面板 (z-50, 标题栏带 FolderOpen 图标): backdrop 按下+松开 → onClose → showLibrary=false
    let libraryClosed = false;
    for (let i = 0; i < 25; i++) {
      const ov = [...document.querySelectorAll('div.fixed.inset-0.z-50')].find(el => el.querySelector('svg.lucide-folder-open'));
      if (!ov) { libraryClosed = true; break; }
      ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      ov.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      await sleep(200);
    }
    await sleep(200);
    return { wizardSeen, libraryClosed, beatmap: !!window.__osuStore.beatmap };
  })()`);
}
