// v493: GitHub Releases 更新提示 — 启动 3s 后自动静默检测 (仅 Electron; 失败/无更新静默);
//   发现新版本 → 右下角悬浮徽章「发现新版本 vX (点击查看)」(✕ = 本次忽略, 仅当前会话);
//   点击徽章 → 确认窗口: 当前→新版本号 + 发布日期 + 更新内容 (release notes 原文),
//   [立即更新] = 用户主动确认 → 系统浏览器打开 release 页; [跳过此版本] localStorage 记忆不再提示;
//   [暂不] 关窗保留徽章。关于菜单「检查更新」手动触发: 检查中/已最新/失败均给 toast 反馈。
// CDP 测试钩子: window.__osuUpdateTest(info, manual) — 注入假更新信息走同一 UI 路径。
import { useEffect, useState } from 'react';
import { getElectronAPI, type ElectronUpdateResult } from '@/osu/electronBridge';
import { tNow, useT } from '@/i18n';

type UpdateInfo = NonNullable<ElectronUpdateResult['update']>;
const SKIP_KEY = 'osu-editor:updateSkip';

type UpdateEvent =
  | { kind: 'toast'; text: string }
  | { kind: 'available'; info: UpdateInfo; current: string; manual: boolean };
const listeners = new Set<(ev: UpdateEvent) => void>();
function emitUpdate(ev: UpdateEvent) { listeners.forEach(f => f(ev)); }

/** 手动检查 (关于菜单「检查更新」) — 任何结果都有 toast/窗口反馈 */
export async function manualCheckUpdate(): Promise<void> {
  const api = getElectronAPI();
  if (!api) return;
  emitUpdate({ kind: 'toast', text: tNow('update.checking', 'Checking for updates…') });
  try {
    const r = await api.checkUpdate();
    if (!r.ok) emitUpdate({ kind: 'toast', text: tNow('update.failed', 'Update check failed: {err}', { err: r.error ?? '' }) });
    else if (r.update) emitUpdate({ kind: 'available', info: r.update, current: r.current, manual: true });
    else emitUpdate({ kind: 'toast', text: tNow('update.latest', 'Already up to date (v{v})', { v: r.current }) });
  } catch (e) {
    emitUpdate({ kind: 'toast', text: tNow('update.failed', 'Update check failed: {err}', { err: String(e) }) });
  }
}

export function UpdatePrompt() {
  const t = useT();
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<{ info: UpdateInfo; current: string } | null>(null); // 徽章 (未确认)
  const [dialog, setDialog] = useState<{ info: UpdateInfo; current: string } | null>(null); // 确认窗口

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    const onEv = (ev: UpdateEvent) => {
      if (ev.kind === 'toast') {
        setToast(ev.text);
        setTimeout(() => setToast(cur => (cur === ev.text ? null : cur)), 3000);
        return;
      }
      // 手动检查: 跳过标记也照常开窗 (用户主动要求); 自动: 已跳过的版本不再提示
      if (ev.manual) { setDialog({ info: ev.info, current: ev.current }); return; }
      if (localStorage.getItem(SKIP_KEY) === ev.info.version) return;
      setPending({ info: ev.info, current: ev.current });
    };
    listeners.add(onEv);
    // 测试钩子 (verifier 注入假数据走同一 UI 路径)
    (window as unknown as { __osuUpdateTest?: unknown }).__osuUpdateTest =
      (info: UpdateInfo, manual = false) => onEv({ kind: 'available', info, current: '0.0.0', manual });
    // 启动自动静默检测
    const timer = setTimeout(async () => {
      try {
        const r = await api.checkUpdate();
        if (r.ok && r.update) onEv({ kind: 'available', info: r.update, current: r.current, manual: false });
      } catch { /* 离线/失败静默 */ }
    }, 3000);
    return () => {
      listeners.delete(onEv);
      clearTimeout(timer);
      delete (window as unknown as { __osuUpdateTest?: unknown }).__osuUpdateTest;
    };
  }, []);

  return (
    <>
      {pending && !dialog && (
        <div className="fixed right-3 bottom-3 z-[85] flex items-center gap-2 rounded-lg bg-[#1a1a24] border border-pink-400/50 px-3 py-2 text-sm shadow-xl" data-update-badge>
          <button className="text-pink-300 hover:text-pink-200 font-bold" data-update-open onClick={() => setDialog(pending)}>
            {t('update.badge', 'New version v{v} available (click to view)', { v: pending.info.version })}
          </button>
          <button data-update-dismiss onClick={() => setPending(null)} className="px-1 text-white/50 hover:text-white" title={t('update.dismiss', 'Dismiss (this session)')}>✕</button>
        </div>
      )}
      {toast && (
        <div className="fixed right-3 bottom-14 z-[85] rounded bg-black/70 border border-white/15 px-3 py-1.5 text-sm text-white/85" data-update-toast>{toast}</div>
      )}
      {dialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" data-update-dialog>
          <div className="w-[480px] max-h-[70vh] flex flex-col rounded-lg bg-[#1a1a24] border border-white/15 p-4 space-y-2 text-sm text-white/85 shadow-xl">
            <div className="text-base font-bold text-white">{t('update.title', 'New version v{v} available', { v: dialog.info.version })}</div>
            <div className="text-white/50">
              {t('update.current', 'Current: v{v}', { v: dialog.current })}
              {dialog.info.publishedAt ? ` · ${dialog.info.publishedAt.slice(0, 10)}` : ''}
            </div>
            <div className="flex-1 min-h-[80px] overflow-y-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-white/75" data-update-body>
              {dialog.info.body || t('update.no_notes', '(no release notes)')}
            </div>
            <div className="flex gap-2 pt-1">
              <button data-update-accept
                onClick={() => { void getElectronAPI()?.openExternal(dialog.info.url); setDialog(null); setPending(null); }}
                className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 text-white font-bold">
                {t('update.accept', 'Update now')}
              </button>
              <button data-update-skip
                onClick={() => { localStorage.setItem(SKIP_KEY, dialog.info.version); setDialog(null); setPending(null); }}
                className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">
                {t('update.skip', 'Skip this version')}
              </button>
              <button data-update-later onClick={() => setDialog(null)} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">
                {t('update.later', 'Not now')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
