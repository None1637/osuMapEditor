// v505: 多层波形+频谱预览 — 每层上面波形、下面频谱图, 后一层接续上一层时间;
// 默认缩放与上方时间轴一致 (win = 6000/timelineZoom); 检出红线 (红竖线+BPM)、
// 已有红线 (灰, 供对比)、当前 beatSnap 细分刻度、每 4 拍 (放大时每 1 拍) 时间标注、
// 播放位置 (青), 点击定位播放头, 滚轮缩放每行时长。
import { useEffect, useRef } from 'react';
import { drawWave, drawSpectro, type SpectroScroll } from '@/osu/waveformDraw';
import { store } from '@/osu/store';
import { formatMsTime } from '@/osu/timingEdit';

export interface PreviewLine { time: number; bpm: number; meter?: number }

export function BpmPreview({ buf, lines, secPerRow, onSeek, onZoom }: {
  buf: AudioBuffer;
  lines: PreviewLine[];
  secPerRow: number;
  onSeek: (ms: number) => void;
  onZoom?: (dir: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectroRefs = useRef<Record<number, { current: SpectroScroll | null }>>({});
  const durMs = buf.duration * 1000;
  const W = 560;
  const waveH = 48, specH = 64, rowH = waveH + specH;
  const rows = Math.max(1, Math.ceil(durMs / (secPerRow * 1000)));
  const winMs = secPerRow * 1000;
  const snap = store.beatSnap || 4;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = rows * rowH * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${rows * rowH}px`;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    const existing = (store.beatmap?.timingPoints ?? []).filter(tp => tp.uninherited);
    const cur = store.currentTime;
    for (let r = 0; r < rows; r++) {
      const t0 = r * winMs;
      g.save();
      g.translate(0, r * rowH);
      drawWave(g, buf, t0, winMs, W, waveH, dpr);
      g.translate(0, waveH);
      if (!spectroRefs.current[r]) spectroRefs.current[r] = { current: null };
      drawSpectro(g, buf, t0, winMs, W, specH, spectroRefs.current[r]);
      g.translate(0, -waveH);
      const xOf = (t: number) => ((t - t0) / winMs) * W;
      // 已有红线 (灰, 供对比)
      g.strokeStyle = 'rgba(180,180,180,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (const tp of existing) {
        if (tp.time < t0 || tp.time >= t0 + winMs) continue;
        const x = xOf(tp.time);
        g.moveTo(x, 0); g.lineTo(x, rowH);
      }
      g.stroke();
      // 当前线节拍刻度: 细分 (beatSnap) + 每 4 拍强线 + 时间标注
      g.font = '9px sans-serif';
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        const end = i + 1 < lines.length ? lines[i + 1].time : durMs;
        const spb = 60000 / L.bpm;
        const meter = L.meter ?? 4;
        const everyN = secPerRow <= 3 ? 1 : meter; // 放大时每 1 拍也标注
        let k = 0;
        for (let t = L.time; t < end; t += spb, k++) {
          const isBar = k % everyN === 0;
          if (isBar) {
            g.strokeStyle = 'rgba(255,255,255,0.55)';
            g.lineWidth = 1;
            g.beginPath();
            if (t >= t0 && t < t0 + winMs) {
              const x = xOf(t);
              g.moveTo(x, 0); g.lineTo(x, rowH);
              g.fillStyle = 'rgba(255,255,255,0.75)';
              g.fillText(formatMsTime(t), Math.min(x + 3, W - 62), 10);
            }
            g.stroke();
          } else if (t >= t0 && t < t0 + winMs) {
            const x = xOf(t);
            g.strokeStyle = 'rgba(255,255,255,0.4)';
            g.beginPath();
            g.moveTo(x, rowH * 0.5); g.lineTo(x, rowH * 0.72);
            g.stroke();
          }
          // 细分刻度 (beatSnap)
          for (let s = 1; s < snap; s++) {
            const ts = t + (spb * s) / snap;
            if (ts >= end || ts < t0 || ts >= t0 + winMs) continue;
            const x = xOf(ts);
            g.strokeStyle = 'rgba(255,255,255,0.22)';
            g.beginPath();
            g.moveTo(x, rowH * 0.62); g.lineTo(x, rowH * 0.8);
            g.stroke();
          }
        }
      }
      // 检出红线 + BPM 文本
      for (const L of lines) {
        if (L.time < t0 || L.time >= t0 + winMs) continue;
        const x = xOf(L.time);
        g.strokeStyle = '#ff5566';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x, rowH);
        g.stroke();
        g.fillStyle = '#ff8899';
        g.fillText(`${L.bpm.toFixed(1)}`, Math.min(x + 3, W - 38), 22);
      }
      // 播放位置 (青)
      if (cur >= t0 && cur < t0 + winMs) {
        const x = xOf(cur);
        g.strokeStyle = '#44ccff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x, rowH);
        g.stroke();
      }
      // 行时间标签
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText(`${Math.round(t0 / 1000)}s`, 4, rowH - 4);
      g.restore();
    }
  }, [buf, lines, secPerRow, rows, rowH, winMs, durMs, snap]);

  // v503: 原生 wheel (React onWheel 为 passive, 无法 preventDefault)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !onZoom) return;
    const h = (e: WheelEvent) => { e.preventDefault(); onZoom(e.deltaY < 0 ? -1 : 1); };
    cv.addEventListener('wheel', h, { passive: false });
    return () => cv.removeEventListener('wheel', h);
  }, [onZoom]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', cursor: 'crosshair', width: W }}
      onClick={e => {
        const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
        const row = Math.floor((e.clientY - rect.top) / rowH);
        const t0 = row * winMs;
        const x = e.clientX - rect.left;
        onSeek(t0 + (x / rect.width) * winMs);
      }}
    />
  );
}
