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

/** 皮肤选择面板: 选择/拖拽 osu! 皮肤文件夹 (贴图 + hitsound), 记住选择, 可恢复默认 */
export function SkinPicker({ onClose }: { onClose: () => void }) {
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
    say(`加载皮肤「${name}」…`);
    try {
      const r = await applySkinFromDir(dir, name);
      say(`贴图: ${r.loaded}/${r.total} 张已加载 (缺失的使用回退贴图)`);
      const samples = await collectSampleFiles(dir);
      if (samples.size) {
        const n = await store.applySkinSamples(samples);
        say(`hitsound: ${n} 个采样已应用 (覆盖内置默认)`);
      } else say('目录中无 hitsound 采样, 沿用内置默认');
      setSource(name);
      store.emitPlayback();
    } catch (e) {
      say('加载失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  }, [say]);

  // 打开面板时恢复上次记住的皮肤目录
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 会话内记忆优先 (含服务器直读模式): 免浏览器权限
      const mem = getRememberedSkinDir();
      if (mem) { say(`已从会话记忆恢复「${mem.dir.name}」`); apply(mem.dir, mem.dir.name); return; }
      if (!supported) { say('不支持 File System Access API, 可拖拽导入'); return; }
      const r = await restoreSkinDir(); // IndexedDB 恢复
      if (cancelled) return;
      if (!r) return;
      setNativeHandle(r.handle);
      if (r.granted) {
        // 写入会话记忆: 本会话内再次打开直接走记忆快速通道, 不再查权限
        rememberSkinDir(asDirLike(r.handle), r.handle);
        say(`已恢复目录「${r.handle.name}」`);
        apply(asDirLike(r.handle), r.handle.name);
      } else { setPermNeeded(true); say(`已记住「${r.handle.name}」, 需要重新授权`); }
    })();
    return () => { cancelled = true; };
  }, [supported, apply, say]);

  const chooseDir = async () => {
    say('打开目录选择器…');
    try {
      const h = await pickSkinDir();
      if (!h) { say('选择被取消 → 也可把皮肤文件夹直接拖进本窗口'); return; }
      setNativeHandle(h); setPermNeeded(false);
      apply(asDirLike(h), h.name);
    } catch (e) {
      say('选择器报错: ' + (e instanceof Error ? `${e.name} ${e.message}` : String(e)) + ' —— 可改用拖拽');
    }
  };

  const grantPerm = async () => {
    if (!nativeHandle) return;
    const ok = await requestReadPermission(nativeHandle);
    say('权限结果: ' + (ok ? '已授权' : '被拒绝'));
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
    if (!d) { say('拖入内容不是文件夹'); return; }
    if (d.native) {
      const ok = await persistSkinDirHandle(d.native);
      say(ok ? '目录已记住 (下次自动恢复)' : '跨会话记忆写入失败: ' + (getLastPersistError() ?? '未知错误'));
      setNativeHandle(d.native);
      rememberSkinDir(d.dir, d.native);
    } else {
      say('当前浏览器不支持拖拽句柄持久化, 仅本次会话内记住');
      setNativeHandle(null);
      rememberSkinDir(d.dir, null);
    }
    setPermNeeded(false);
    apply(d.dir, d.dir.name + ' (拖拽)');
  };

  const resetDefault = () => {
    resetSkinToDefault();
    store.resetSkinSamples();
    forgetSkinDir();
    setSource('默认皮肤');
    setNativeHandle(null); setPermNeeded(false);
    say('已恢复默认皮肤与内置 hitsound');
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
          <span className="text-sm font-semibold flex items-center gap-1.5"><Palette className="w-4 h-4" />皮肤</span>
          <span className="text-xs text-slate-500 truncate">当前: {source}</span>
          <div className="flex-1" />
          <button className="text-xs px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] flex items-center" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="p-5 flex flex-col items-center gap-3 relative">
          {dropActive && (
            <div className="absolute inset-0 z-10 bg-[#e6437d]/15 border-2 border-dashed border-[#e6437d] flex items-center justify-center text-sm text-pink-200 pointer-events-none">
              松开以导入皮肤文件夹
            </div>
          )}
          <div className="text-xs text-slate-400 text-center leading-5">
            选择 osu! 皮肤文件夹 (含 hitcircle.png / normal-hitnormal.wav 等的目录)。
            <br />贴图与 hitsound 都会应用；选择会被记住，下次自动恢复。
          </div>
          {permNeeded ? (
            <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium disabled:opacity-40"
                    disabled={busy} onClick={grantPerm}>
              授权访问「{nativeHandle?.name}」
            </button>
          ) : (
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium disabled:opacity-40"
                      disabled={busy} onClick={chooseDir}>
                {busy ? '加载中…' : '选择皮肤文件夹…'}
              </button>
              <button className="px-4 py-2 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] text-sm disabled:opacity-40"
                      disabled={busy} onClick={resetDefault}>
                恢复默认皮肤
              </button>
            </div>
          )}
          <div className="text-[11px] text-slate-600 text-center">
            也可以<strong className="text-pink-300">直接把皮肤文件夹拖进这个窗口</strong>（拖拽导入不会被记住）
          </div>
        </div>

        <div className="shrink-0 border-t border-[#2c2c38] px-3 py-1 bg-[#101016]">
          {log.length === 0
            ? <div className="text-[10px] text-slate-600">日志</div>
            : log.map((l, i) => <div key={i} className="text-[10px] text-slate-500 font-mono truncate">{l}</div>)}
        </div>
      </div>
    </div>
  );
}
