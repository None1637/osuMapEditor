// v460: stable 风「地图已保存」中央横条 — Ctrl+S (含原生菜单 accelerator) 保存成功后弹出。
// 动画 (用户需求): 黑底以垂直中心为原点迅速扩大 — scaleY 0.5 → 1.1 过冲 → 回到 1.0, 约 0.1s;
// 随后停留约 1.2s, 末尾 0.3s 淡出。悬浮于所有控件之上 (z-[200] + pointer-events-none),
// 与 FpsCounter 同挂在 v217 zoom 容器外 (App 外层), 不随界面缩放 — 小分辨率下字号恒定。
// 连续保存: store.saveFlashSeq 自增 → key 重挂载, 动画重新播放。
import { useEffect, useState } from 'react';
import { useEditor } from '@/osu/store';
import { useT } from '@/i18n';

const DURATION_MS = 1600; // 与下方 keyframes 总时长一致: 0.1s 展开 + 停留 + 0.3s 淡出

export function SavedFlash() {
  const store = useEditor();
  const t = useT();
  const seq = store.saveFlashSeq;
  const [shownSeq, setShownSeq] = useState(0);
  useEffect(() => {
    if (!seq) return;
    setShownSeq(seq);
    const timer = setTimeout(() => setShownSeq(0), DURATION_MS);
    return () => clearTimeout(timer);
  }, [seq]);
  if (!shownSeq) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none select-none">
      <style>{`
@keyframes saved-flash-bar {
  0% { opacity: 0; transform: scaleY(0.5); }
  2% { opacity: 1; }
  3.75% { transform: scaleY(1.1); }
  6.25% { transform: scaleY(1); }
  81% { opacity: 1; transform: scaleY(1); }
  100% { opacity: 0; transform: scaleY(1); }
}`}</style>
      <div key={shownSeq} data-saved-flash
        className="w-full h-14 bg-black/70 flex items-center justify-center text-white text-xl tracking-widest"
        style={{ animation: `saved-flash-bar ${DURATION_MS}ms linear both` }}>
        {t('app.saved_flash', 'Map saved')}
      </div>
    </div>
  );
}
