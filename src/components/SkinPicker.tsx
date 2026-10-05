import { useCallback, useEffect, useState } from 'react';
import { Palette, X } from 'lucide-react'; // v181: 🎨/✕ → lucide
import { store } from '../osu/store';
import { applySkinFromDir, resetSkinToDefault, skinSourceName } from '../osu/skin';
import {
  asDirLike, collectSampleFiles, dirHandleFromDropEx, forgetSkinDir,
  getLastPersistError, getRememberedSkinDir, isFileSystemAccessSupported,
  persistSkinDirHandle, pickSkinDir, rememberSkinDir,
  requestReadPermission, restoreSkinDir,
  type FsDirLike,
} from '../osu/library';
import { tNow, useT } from '@/i18n';

/** 皮肤选择面板: 选择/拖拽 osu! 皮肤文件夹 (贴图 + hitsound), 记住选择, 可恢复默认 */
export function SkinPicker({ onClose }: { onClose: () => void }) {
  const t = useT();
  const supported = isFileSystemAccessSupported();
  const [source, setSource] = useState(skinSourceName);
  const [nativeHandle, setNativeHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [permNeeded, setPermNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const say = useCallback((s: string) => {
    console.log('[皮肤]', s);
    setLog(prev => [...prev.slice(-5), new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + s]);
  }, []);

  const apply = useCallback(async (dir: FsDirLike, name: string) => {
    setBusy(true);
    say(tNow('skin.log_loading_skin', 'Loading skin "{name}"…', { name }));
    try {
      const r = await applySkinFromDir(dir, name);
      say(tNow('skin.log_textures_loaded', 'Textures: {loaded}/{total} loaded (fallback for missing)', { loaded: r.loaded, total: r.total }));
      const samples = await collectSampleFiles(dir);
      if (samples.size) {
        const n = await store.applySkinSamples(samples);
        say(tNow('skin.log_samples_applied', 'Hitsounds: {n} samples applied (overriding built-in defaults)', { n }));
      } else say(tNow('skin.log_no_samples', 'No hitsound samples in folder; keeping built-in defaults'));
      setSource(name);
      store.emitPlayback();
    } catch (e) {
      say(tNow('skin.log_load_failed', 'Load failed: {error}', { error: e instanceof Error ? e.message : String(e) }));
    } finally { setBusy(false); }
  }, [say]);

  // 打开面板时恢复上次记住的皮肤目录
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 会话内记忆优先 (含服务器直读模式): 免浏览器权限
      const mem = getRememberedSkinDir();
      if (mem) { say(tNow('skin.log_restored_session', 'Restored "{name}" from session memory', { name: mem.dir.name })); apply(mem.dir, mem.dir.name); return; }
      if (!supported) { say(tNow('skin.log_no_fs_api', 'File System Access API not supported; drag & drop to import')); return; }
      const r = await restoreSkinDir(); // IndexedDB 恢复
      if (cancelled) return;
      if (!r) return;
      setNativeHandle(r.handle);
      if (r.granted) {
        // 写入会话记忆: 本会话内再次打开直接走记忆快速通道, 不再查权限
        rememberSkinDir(asDirLike(r.handle), r.handle);
        say(tNow('skin.log_restored_dir', 'Restored folder "{name}"', { name: r.handle.name }));
        apply(asDirLike(r.handle), r.handle.name);
      } else { setPermNeeded(true); say(tNow('skin.log_remembered_need_auth', 'Remembered "{name}"; re-authorization required', { name: r.handle.name })); }
    })();
    return () => { cancelled = true; };
  }, [supported, apply, say]);

  const chooseDir = async () => {
    say(tNow('skin.log_opening_picker', 'Opening folder picker…'));
    try {
      const h = await pickSkinDir();
      if (!h) { say(tNow('skin.log_pick_cancelled', 'Selection cancelled — you can also drag a skin folder into this window')); return; }
      setNativeHandle(h); setPermNeeded(false);
      apply(asDirLike(h), h.name);
    } catch (e) {
      say(tNow('skin.log_picker_error', 'Picker error: {error} — try drag & drop instead', { error: e instanceof Error ? `${e.name} ${e.message}` : String(e) }));
    }
  };

  const grantPerm = async () => {
    if (!nativeHandle) return;
    const ok = await requestReadPermission(nativeHandle);
    say(tNow('skin.log_perm_result', 'Permission: {result}', { result: ok ? tNow('skin.perm_granted', 'Granted') : tNow('skin.perm_denied', 'Denied') }));
    setPermNeeded(!ok);
    if (ok) {
      // 授权成功后写入会话记忆: 避免部分环境同会话内反复要求授权
      rememberSkinDir(asDirLike(nativeHandle), nativeHandle);
      apply(asDirLike(nativeHandle), nativeHandle.name);
    }
  };

  const onDropDir = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDropActive(false);
    const item = [...e.dataTransfer.items].find(i => i.kind === 'file');
    if (!item) return;
    const d = await dirHandleFromDropEx(item);
    if (!d) { say(tNow('skin.log_not_a_folder', 'Dropped item is not a folder')); return; }
    if (d.native) {
      const ok = await persistSkinDirHandle(d.native);
      say(ok
        ? tNow('skin.log_dir_remembered', 'Folder remembered (auto-restored next time)')
        : tNow('skin.log_persist_failed', 'Failed to save cross-session memory: {error}', { error: getLastPersistError() ?? tNow('skin.unknown_error', 'Unknown error') }));
      setNativeHandle(d.native);
      rememberSkinDir(d.dir, d.native);
    } else {
      say(tNow('skin.log_no_handle_persist', 'Browser does not support drag-handle persistence; remembered for this session only'));
      setNativeHandle(null);
      rememberSkinDir(d.dir, null);
    }
    setPermNeeded(false);
    apply(d.dir, d.dir.name + tNow('skin.drag_suffix', ' (drag)'));
  };

  const resetDefault = () => {
    resetSkinToDefault();
    store.resetSkinSamples();
    forgetSkinDir();
    setSource('默认皮肤');
    setNativeHandle(null); setPermNeeded(false);
    say(tNow('skin.log_reset_default', 'Restored default skin and built-in hitsounds'));
    store.emitPlayback();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div className="w-[520px] max-w-[92vw] bg-[#16161d] border border-[#333] rounded-lg flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}
           onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropActive(true); }}
           onDragLeave={e => { e.stopPropagation(); setDropActive(false); }}
           onDrop={onDropDir}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2c2c38]">
          <span className="text-sm font-semibold flex items-center gap-1.5"><Palette className="w-4 h-4" />{t('skin.title', 'Skin')}</span>
          <span className="text-xs text-slate-500 truncate">{t('skin.current', 'Current: {name}', { name: source === '默认皮肤' ? t('skin.defaultSkinName', 'Default Skin') : source })}</span>
          <div className="flex-1" />
          <button className="text-xs px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] flex items-center" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="p-5 flex flex-col items-center gap-3 relative">
          {dropActive && (
            <div className="absolute inset-0 z-10 bg-[#e6437d]/15 border-2 border-dashed border-[#e6437d] flex items-center justify-center text-sm text-pink-200 pointer-events-none">
              {t('skin.drop_hint', 'Release to import skin folder')}
            </div>
          )}
          <div className="text-xs text-slate-400 text-center leading-5">
            {t('skin.desc_line1', 'Choose an osu! skin folder (a directory containing hitcircle.png / normal-hitnormal.wav etc.)')}
            <br />{t('skin.desc_line2', 'Textures and hitsounds are both applied; your choice is remembered and restored next time.')}
          </div>
          {permNeeded ? (
            <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium disabled:opacity-40"
                    disabled={busy} onClick={grantPerm}>
              {t('skin.grant_access', 'Grant access to "{name}"', { name: nativeHandle?.name ?? '' })}
            </button>
          ) : (
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium disabled:opacity-40"
                      disabled={busy} onClick={chooseDir}>
                {busy ? t('skin.loading', 'Loading…') : t('skin.choose_folder', 'Choose Skin Folder…')}
              </button>
              <button className="px-4 py-2 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] text-sm disabled:opacity-40"
                      disabled={busy} onClick={resetDefault}>
                {t('skin.reset_default', 'Restore Default Skin')}
              </button>
            </div>
          )}
          <div className="text-[11px] text-slate-600 text-center">
            {t('skin.drag_hint_prefix', 'You can also ')}<strong className="text-pink-300">{t('skin.drag_hint_strong', 'drag a skin folder into this window')}</strong>{t('skin.drag_hint_suffix', ' (drag import is not remembered)')}
          </div>
        </div>

        <div className="shrink-0 border-t border-[#2c2c38] px-3 py-1 bg-[#101016]">
          {log.length === 0
            ? <div className="text-[10px] text-slate-600">{t('skin.log_label', 'Log')}</div>
            : log.map((l, i) => <div key={i} className="text-[10px] text-slate-500 font-mono truncate">{l}</div>)}
        </div>
      </div>
    </div>
  );
}
