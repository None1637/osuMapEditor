// v120: 未保存改动提示 — 切换谱面/难度或关闭编辑器前弹窗: 保存并继续 / 废弃改动 / 取消
// store.pendingAction 非空时显示 (guardUnsaved 拦截时设置); 保存失败不执行后续动作, 弹窗保留
import { useState } from 'react';
import { TriangleAlert } from 'lucide-react'; // v181: ⚠ → lucide
import { store, useEditor } from '@/osu/store';
import { useCounterZoom } from '@/osu/uiZoom';

export function UnsavedDialog() {
  useEditor();
  const [saving, setSaving] = useState(false);
  const cz = useCounterZoom(); // v249: 抗全局缩放
  const action = store.pendingAction;
  if (!action) return null;
  const m = store.beatmap?.metadata;
  const title = m ? `${m.artist || m.artistUnicode} - ${m.title || m.titleUnicode} [${m.version}]` : '';

  const saveAndContinue = async () => {
    setSaving(true);
    const ok = await store.save();
    setSaving(false);
    if (ok) store.resolvePendingAction(true); // 保存成功才继续 (后续动作多为 load, 会重置脏标记)
    // 保存失败: 弹窗保留, saveMessage 已在游玩区左下角提示原因
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center" data-unsaved-dialog="root">
      <div ref={cz.ref} style={cz.style} className="w-[420px] max-w-[92vw] bg-[#16161d] border border-[#333] rounded-lg p-5 shadow-2xl">
        <div className="text-sm font-semibold mb-1 flex items-center gap-1.5"><TriangleAlert className="w-4 h-4" />未保存的改动</div>
        <div className="text-xs text-slate-400 mb-4 break-all">
          当前谱面{title ? ` (${title})` : ''}有未保存的改动, 继续将丢失这些改动。
        </div>
        <div className="flex gap-2 justify-end">
          <button
            className="text-xs px-3 py-1.5 rounded bg-[#2c2c38] hover:bg-[#3c3c4c]"
            onClick={() => store.resolvePendingAction(false)} data-unsaved-dialog="cancel">
            取消
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-red-900/60 hover:bg-red-800/60 border border-red-700/50"
            onClick={() => store.resolvePendingAction(true)} data-unsaved-dialog="discard">
            废弃改动
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-cyan-700/60 hover:bg-cyan-600/60 border border-cyan-500/50 disabled:opacity-40"
            disabled={saving}
            onClick={() => void saveAndContinue()} data-unsaved-dialog="save">
            {saving ? '保存中…' : '保存并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}
