// v498: 自动 BPM 检测对话框 — worker 后台分析音频, 恒速模式直接显示 BPM + offset
//   (可编辑), 应用为单条红线; 检出多个疑似变速段时给出提示 (恒速结果只保主速度段)。
// v500: ① 容差 ms 可选 (调整 1/8/1/6 细分合并判定, 本地重算不用重跑检测);
//       ② 恒速(假设歌曲恒速)/变速(假设歌曲变速) 模式 — 变速模式列出全部检出段
//       (时间+BPM, 可删误检段), 应用写入多条红线。
import { useEffect, useMemo, useRef, useState } from 'react';
import { DraggableDialog, DraftNum } from './DraggableDialog';
import { store } from '@/osu/store';
import { useT } from '@/i18n';
import { extractConstantTempo, type BpmDetectResult } from '@/osu/bpmDetect';
import { formatMsTime } from '@/osu/timingEdit';

export function BpmDetectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<'running' | 'done' | 'error'>('running');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BpmDetectResult | null>(null);
  const [mode, setMode] = useState<'constant' | 'variable'>('constant');
  const [tolMs, setTolMs] = useState(15);
  const [bpm, setBpm] = useState(120);
  const [offset, setOffset] = useState(0);
  const [manualEdit, setManualEdit] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [deletedSegs, setDeletedSegs] = useState<Set<number>>(new Set());
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const buf = store.getAudioBuffer();
    if (!buf) {
      setError(t('timing.bpmdetect_no_audio', 'Audio not loaded yet — cannot detect BPM'));
      setPhase('error');
      return;
    }
    const worker = new Worker(new URL('../osu/bpmDetectWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = ev => {
      const m = ev.data;
      if (m?.type === 'progress') setProgress(Math.round(m.p * 100));
      else if (m?.type === 'done') {
        if (!m.result?.constant) {
          setError(t('timing.bpmdetect_empty', 'No beats detected — try timing manually'));
          setPhase('error');
          return;
        }
        setResult(m.result as BpmDetectResult);
        setPhase('done');
      } else if (m?.type === 'error') {
        setError(m.message ?? 'error');
        setPhase('error');
      }
    };
    worker.onerror = e => { setError(e.message ?? 'worker error'); setPhase('error'); };
    const channels: Float32Array[] = [];
    for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i).slice());
    worker.postMessage({ type: 'detect', channels, sampleRate: buf.sampleRate, length: buf.length }, channels.map(c => c.buffer as ArrayBuffer));
    return () => { worker.terminate(); workerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v500: 容差变化本地重算恒速结果 (音频分析只跑一次)
  const constant = useMemo(() => result ? extractConstantTempo(result, 0.1, tolMs) : null, [result, tolMs]);
  useEffect(() => {
    if (!constant || manualEdit) return;
    setBpm(constant.bpm);
    setOffset(constant.offsetMs);
  }, [constant, manualEdit]);

  const redCount = store.beatmap?.timingPoints.filter(tp => tp.uninherited).length ?? 0;
  const apply = () => {
    if (redCount > 0 && !confirmReplace) { setConfirmReplace(true); return; }
    if (mode === 'constant') {
      if (!(bpm > 0) || !isFinite(bpm) || !isFinite(offset)) return;
      store.applyDetectedTiming([{ time: Math.round(offset), bpm, meter: 4 }]);
    } else {
      if (!result || !constant) return;
      const points = constant.lines.filter((_, i) => !deletedSegs.has(i)); // v501: 合并后红线列 (恒速不再列碎段)
      if (!points.length) return;
      store.applyDetectedTiming(points);
    }
    onClose();
  };
  const applyDisabled = mode === 'variable' && (!constant || constant.lines.every((_, i) => deletedSegs.has(i)));

  return (
    <DraggableDialog title={t('timing.bpmdetect_title', 'Auto BPM Detection')} onClose={onClose} width={380} testid="bpm-detect-dialog">
      <div className="p-3 flex flex-col gap-2 text-sm">
        {phase === 'running' && (
          <div data-testid="bpm-detect-progress">
            <div className="mb-1 text-white/70">{t('timing.bpmdetect_running', 'Analyzing audio… {p}%', { p: progress })}</div>
            <div className="h-1.5 rounded bg-white/10 overflow-hidden"><div className="h-full bg-sky-400" style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {phase === 'error' && <div className="text-red-300 break-all" data-testid="bpm-detect-error">{t('timing.bpmdetect_error', 'Detection failed: {msg}', { msg: error })}</div>}
        {phase === 'done' && result && constant && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="bpm-detect-mode" checked={mode === 'constant'} onChange={() => setMode('constant')} data-testid="bpm-detect-mode-constant" />
                {t('timing.bpmdetect_mode_constant', 'Constant (assume fixed tempo)')}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="bpm-detect-mode" checked={mode === 'variable'} onChange={() => setMode('variable')} data-testid="bpm-detect-mode-variable" />
                {t('timing.bpmdetect_mode_variable', 'Variable (assume tempo changes)')}
              </label>
              <label className="flex items-center gap-1">{t('timing.bpmdetect_tolerance', 'Tolerance (ms)')}
                <DraftNum value={tolMs} set={v => { setTolMs(v); setManualEdit(false); }} testid="bpm-detect-tolerance" min={1} max={100} step={1} w="w-16" />
              </label>
            </div>
            {mode === 'constant' ? (
              <>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1">BPM <DraftNum value={bpm} set={v => { setBpm(v); setManualEdit(true); }} testid="bpm-detect-bpm" min={1} max={2000} step={0.1} digits={3} w="w-24" /></label>
                  <label className="flex items-center gap-1">{t('timing.bpmdetect_offset', 'Offset (ms)')} <DraftNum value={offset} set={v => { setOffset(v); setManualEdit(true); }} testid="bpm-detect-offset" min={-60000} max={3600000} step={1} w="w-24" /></label>
                </div>
                <div className="text-white/50 text-xs" data-testid="bpm-detect-info">
                  {t('timing.bpmdetect_coverage', 'Main grid covers {n}% of detected beats', { n: Math.round(constant.coverage * 100) })}
                  {constant.variableSections.length > 0 && <div className="text-amber-300/90 mt-0.5">{t('timing.bpmdetect_variable_hint', '{n} possible tempo-change sections found; the constant result fits only the main tempo — adjust other sections manually', { n: constant.variableSections.length })}</div>}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="text-white/50 text-xs">{t('timing.bpmdetect_segments', '{n} timing sections detected (click × to drop false ones)', { n: constant.lines.length - deletedSegs.size })}</div>
                <div className="max-h-48 overflow-y-auto border border-white/10 rounded" data-testid="bpm-detect-segments">
                  {constant.lines.map((s, i) => !deletedSegs.has(i) && (
                    <div key={i} className="flex items-center gap-2 px-2 py-0.5 text-xs odd:bg-white/5">
                      <span className="w-24">{formatMsTime(s.time)}</span>
                      <span className="flex-1">{s.bpm.toFixed(2)} BPM</span>
                      <button className="text-red-300 hover:text-red-200 px-1" data-seg-del={i}
                        onClick={() => setDeletedSegs(prev => new Set(prev).add(i))}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {confirmReplace && <div className="text-amber-300 text-xs">{t('timing.bpmdetect_confirm_replace', 'This replaces all {n} existing timing points. Click Apply again to confirm.', { n: redCount })}</div>}
            <div className="flex gap-2 mt-1">
              <button data-testid="bpm-detect-apply" onClick={apply} disabled={applyDisabled} className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
                {confirmReplace ? t('timing.bpmdetect_confirm_apply', 'Confirm Replace') : t('timing.bpmdetect_apply', 'Apply')}
              </button>
              <button onClick={onClose} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">{t('timing.bpmdetect_cancel', 'Cancel')}</button>
            </div>
          </>
        )}
      </div>
    </DraggableDialog>
  );
}
