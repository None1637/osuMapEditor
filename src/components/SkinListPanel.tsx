import { useEffect, useRef, useState } from 'react';
import { Check, Palette, X } from 'lucide-react'; // v181: ✓/🎨/✕ → lucide
import { getElectronAPI, ipcErrorMessage } from '../osu/electronBridge';
import { applyServerSkin } from '../osu/serverSkin';
import { skinSourceName } from '../osu/skin';
import { useCounterZoom } from '../osu/uiZoom';

/**
 * exe 皮肤面板: 列出 <osu!>/Skins 下的全部皮肤, 点击即应用并保存到 settings.json。
 * (浏览器/dev 环境用 SkinPicker —— 那里只能走 File System Access 选目录)
 */

// v150: Row 提升到模块级 — 组件内定义会让 React 每次渲染都视为新组件类型并重挂载按钮;
// 播放中 EditorCanvas 每帧 emitPlayback → App 60fps 重渲染 → 按钮每帧重挂载, mousedown 后 mouseup 落在被卸载的节点上,
// click 永不触发 (表现为"播放时无法点击皮肤窗口中的任意皮肤"); 模块级组件类型稳定, 重渲染只走 reconciliation
function Row({ name, label, current, busy, onChoose }: {
  name: string | null; label: string; current: string | null; busy: boolean;
  onChoose: (name: string | null) => void;
}) {
  return (
    <button
      data-skin-current={current === name ? '1' : undefined} // v172: 打开时滚动定位用
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left disabled:opacity-40 ${current === name ? 'bg-[#e6437d]/25 text-white' : 'text-slate-300 hover:bg-[#22222c]'}`}
      disabled={busy}
      onClick={() => onChoose(name)}>
      <span className="w-4 shrink-0">{current === name ? <Check className="w-3.5 h-3.5" /> : ''}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function SkinListPanel({ onClose }: { onClose: () => void }) {
  const cz = useCounterZoom(); // v249: 抗全局缩放
  const api = getElectronAPI();
  const [osuPath, setOsuPath] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [skins, setSkins] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // v172: 列表加载完成后, 把当前选中皮肤滚动到尽量居中 (scrollIntoView block:'center' — 列表太短/行贴边时自动贴边)
  useEffect(() => {
    listRef.current?.querySelector('[data-skin-current="1"]')?.scrollIntoView({ block: 'center' });
  }, [skins, current]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      const s = await api.getSettings();
      if (cancelled) return;
      setOsuPath(s.osuPath);
      setCurrent(s.skinName);
      if (s.osuPath) {
        const list = await api.listSkinDirs(s.osuPath);
        if (!cancelled) setSkins(list);
      }
    })().catch(e => !cancelled && setError(ipcErrorMessage(e)));
    return () => { cancelled = true; };
  }, [api]);

  const choose = async (name: string | null) => {
    if (!api || !osuPath || busy) return;
    setBusy(true); setError(null);
    try {
      await api.saveSettings({ osuPath, skinName: name });
      await applyServerSkin(name);
      setCurrent(name);
      onClose();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div ref={cz.ref} style={cz.style} className="w-[480px] max-w-[92vw] bg-[#16161d] border border-[#333] rounded-lg flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2c2c38]">
          <span className="text-sm font-semibold flex items-center gap-1.5"><Palette className="w-4 h-4" />皮肤</span>
          <span className="text-xs text-slate-500 truncate">当前: {skinSourceName}</span>
          <div className="flex-1" />
          <button className="text-xs px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] flex items-center" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="p-3 flex flex-col gap-2">
          {error && <div className="text-xs text-red-400 px-1">{error}</div>}
          {!osuPath && !error && (
            <div className="text-xs text-slate-400 p-3 text-center">未配置 osu! 目录 (菜单: 设置 → 重新配置 osu! 目录与皮肤)</div>
          )}
          {osuPath && (
            <>
              <div className="text-[11px] text-slate-500 px-1 truncate">{osuPath}/Skins · 点击即应用 (贴图 + hitsound)</div>
              <div ref={listRef} className="max-h-80 overflow-y-auto border border-[#2c2c38] rounded">
                <Row name={null} label="默认皮肤 (内置)" current={current} busy={busy} onChoose={choose} />
                {skins.map(name => <Row key={name} name={name} label={name} current={current} busy={busy} onChoose={choose} />)}
                {skins.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">Skins 目录为空</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
