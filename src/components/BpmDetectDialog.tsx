// v498: 自动 BPM 检测对话框 — worker 后台分析音频, 直接显示恒速 BPM + offset
//   (可编辑), 应用为单条红线; 检出多个疑似变速段时给出提示 (恒速结果只保主速度段)。
import { useEffect, useRef, useState } from 'react';
import { DraggableDialog, DraftNum } from './DraggableDialog';
import { store } from '@/osu/store';
import { useT } from '@/i18n';

export function BpmDetectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<'running' | 'done' | 'error'>('running');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [bpm, setBpm] = useState(120);
  const [offset, setOffset] = useState(0);
  const [coverage, setCoverage] = useState(1);
  const [variableSections, setVariableSections] = useState(0); // v499: 疑似真变速段数 (非碎段数)
  const [confirmReplace, setConfirmReplace] = useState(false);
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
        const c = m.result?.constant;
        if (!c) {
          setError(t('timing.bpmdetect_empty', 'No beats detected — try timing manually'));
          setPhase('error');
          return;
        }
        setBpm(c.bpm);
        setOffset(c.offsetMs);
        setCoverage(c.coverage);
        setVariableSections((c.variableSections ?? []).length);
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

  const redCount = store.beatmap?.timingPoints.filter(tp => tp.uninherited).length ?? 0;
  const apply = () => {
    if (!(bpm > 0) || !isFinite(bpm) || !isFinite(offset)) return;
    if (redCount > 0 && !confirmReplace) { setConfirmReplace(true); return; }
    store.applyDetectedTiming([{ time: Math.round(offset), bpm, meter: 4 }]);
    onClose();
  };

  return (
    <DraggableDialog title={t('timing.bpmdetect_title', 'Auto BPM Detection')} onClose={onClose} width={340} testid="bpm-detect-dialog">
      <div className="p-3 flex flex-col gap-2 text-sm">
        {phase === 'running' && (
          <div data-testid="bpm-detect-progress">
            <div className="mb-1 text-white/70">{t('timing.bpmdetect_running', 'Analyzing audio… {p}%', { p: progress })}</div>
            <div className="h-1.5 rounded bg-white/10 overflow-hidden"><div className="h-full bg-sky-400" style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {phase === 'error' && <div className="text-red-300 break-all" data-testid="bpm-detect-error">{t('timing.bpmdetect_error', 'Detection failed: {msg}', { msg: error })}</div>}
        {phase === 'done' && (
          <>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1">BPM <DraftNum value={bpm} set={setBpm} testid="bpm-detect-bpm" min={1} max={2000} step={0.1} digits={3} w="w-24" /></label>
              <label className="flex items-center gap-1">{t('timing.bpmdetect_offset', 'Offset (ms)')} <DraftNum value={offset} set={setOffset} testid="bpm-detect-offset" min={-60000} max={3600000} step={1} w="w-24" /></label>
            </div>
            <div className="text-white/50 text-xs" data-testid="bpm-detect-info">
              {t('timing.bpmdetect_coverage', 'Main grid covers {n}% of detected beats', { n: Math.round(coverage * 100) })}
              {variableSections > 0 && <div className="text-amber-300/90 mt-0.5">{t('timing.bpmdetect_variable_hint', '{n} possible tempo-change sections found; the constant result fits only the main tempo — adjust other sections manually', { n: variableSections })}</div>}
            </div>
            {confirmReplace && <div className="text-amber-300 text-xs">{t('timing.bpmdetect_confirm_replace', 'This replaces all {n} existing timing points. Click Apply again to confirm.', { n: redCount })}</div>}
            <div className="flex gap-2 mt-1">
              <button data-testid="bpm-detect-apply" onClick={apply} className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 text-white font-bold">
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
