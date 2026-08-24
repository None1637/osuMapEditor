// v220: 右下角帧数显示 — 悬浮于其他所有控件之上 (z-[100] + pointer-events-none),
// 挂在 v217 zoom 容器之外 (App 外层), 不随 uiZoom 缩放; 独立 rAF 计帧, 每 500ms 刷新一次读数
import { useEffect, useState } from 'react';

export function FpsCounter() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0, frames = 0, last = performance.now();
    const loop = (t: number) => {
      frames++;
      if (t - last >= 500) {
        setFps(Math.round(frames * 1000 / (t - last)));
        frames = 0; last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="fixed bottom-2 right-3 z-[100] pointer-events-none select-none
      rounded px-1.5 py-0.5 bg-black/40 text-xs font-mono text-white/60">
      {fps} FPS
    </div>
  );
}
