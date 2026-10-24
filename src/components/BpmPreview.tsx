// v503: 多层波形/频谱预览 — 每行一段连续时间 (下一行接续上一行), 叠加检出红线
//   (红竖线+BPM)、当前线节拍刻度 (白)、已有红线 (灰, 供对比)、播放位置 (青)。
//   滚轮缩放每行时长 (5~60s), 点击定位播放头; 波形/频谱两种模式复用 waveformDraw。
import { useEffect, useRef } from 'react';
import { drawWave, drawSpectro, type SpectroScroll } from '@/osu/waveformDraw';
import { store } from '@/osu/store';

export interface PreviewLine { time: number; bpm: number; meter?: number }

export function BpmPreview({ buf, lines, secPerRow, onSeek, onZoom, spectro = false }: {
  buf: AudioBuffer;
  lines: PreviewLine[];
  secPerRow: number;
  onSeek: (ms: number) => void;
  onZoom?: (dir: number) => void;
  spectro?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectroRefs = useRef<Record<number, { current: SpectroScroll | null }>>({});
  const durMs = buf.duration * 1000;
  const W = 560;
  const rowH = spectro ? 88 : 64;
  const rows = Math.max(1, Math.ceil(durMs / (secPerRow * 1000)));
  const winMs = secPerRow * 1000;

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
      if (spectro) {
        if (!spectroRefs.current[r]) spectroRefs.current[r] = { current: null };
        drawSpectro(g, buf, t0, winMs, W, rowH, spectroRefs.current[r]);
      } else {
        drawWave(g, buf, t0, winMs, W, rowH, dpr);
      }
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
      // 当前线节拍刻度 (白): 以每根检出线为起点, 到下根线/曲尾
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        const end = i + 1 < lines.length ? lines[i + 1].time : durMs;
        const spb = 60000 / L.bpm;
        for (let t = L.time; t < end; t += spb) {
          if (t < t0 || t >= t0 + winMs) continue;
          const x = xOf(t);
          g.moveTo(x, rowH * 0.55); g.lineTo(x, rowH * 0.8);
        }
      }
      g.stroke();
      // 检出红线 + BPM 文本
      g.font = '10px sans-serif';
      for (const L of lines) {
        if (L.time < t0 || L.time >= t0 + winMs) continue;
        const x = xOf(L.time);
        g.strokeStyle = '#ff5566';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x, rowH);
        g.stroke();
        g.fillStyle = '#ff8899';
        g.fillText(`${L.bpm.toFixed(1)}`, Math.min(x + 3, W - 38), 12);
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
  }, [buf, lines, secPerRow, rows, rowH, winMs, durMs, spectro]);

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
