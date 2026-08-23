// 内置演示谱面: 覆盖 单点/直线滑条/圆弧滑条/贝塞尔滑条/转盘 + 多条 timing
import type { Beatmap } from './parser';
import { parseOsu, genId } from './parser';

const OSU = `osu file format v14

[General]
AudioFilename: demo.wav
AudioLeadIn: 0
PreviewTime: 4000
Mode: 0

[Metadata]
Title:Demo Beatmap
TitleUnicode:Demo Beatmap
Artist:Kimi Editor
ArtistUnicode:Kimi Editor
Creator:Kimi
Version:Normal
BeatmapID:0

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[Events]

[TimingPoints]
1000,500,4,1,0,80,1,0
1000,-100,4,1,0,80,0,0
13000,-50,4,1,0,80,0,1
21000,375,3,2,0,90,1,0
21000,-75,3,2,0,90,0,0

[Colours]
Combo1 : 255,105,180
Combo2 : 70,180,255
Combo3 : 255,215,70
Combo4 : 107,255,107

[HitObjects]
128,192,1000,5,0,0:0:0:0:
256,96,1500,1,0,0:0:0:0:
384,192,2000,1,0,0:0:0:0:
256,288,2500,1,0,0:0:0:0:
96,96,3000,5,0,0:0:0:0:
96,96,3500,2,0,L|416:96,1,448,0|0,0:0|0:0,0:0:0:0:
128,288,4500,5,0,0:0:0:0:
128,288,5000,2,0,P|256:160|384:288,1,380,0|0,0:0|0:0,0:0:0:0:
416,96,6000,5,0,0:0:0:0:
416,96,6500,2,0,B|480:96|480:192|416:240|352:192|352:96,2,420,0|0,0:0|0:0,0:0:0:0:
64,192,8000,5,0,0:0:0:0:
64,192,8500,2,0,B|160:64|256:320|352:64|448:320,1,600,0|0,0:0|0:0,0:0:0:0:
256,192,10000,1,0,0:0:0:0:
96,96,10500,5,0,0:0:0:0:
96,96,11000,2,0,C|196:40|316:200|416:96,1,450,0|0,0:0|0:0,0:0:0:0:
256,192,12000,12,0,13500,0:0:0:0:
128,96,14000,5,0,0:0:0:0:
256,192,14250,1,0,0:0:0:0:
384,288,14500,1,0,0:0:0:0:
256,96,14750,5,0,0:0:0:0:
256,96,15125,2,0,L|128:288|384:288,1,380,0|0,0:0|0:0,0:0:0:0:
64,192,16000,5,0,0:0:0:0:
192,288,16375,1,0,0:0:0:0:
320,96,16750,1,0,0:0:0:0:
448,192,17125,1,0,0:0:0:0:
256,192,17500,2,0,P|128:320|128:64,2,500,0|0,0:0|0:0,0:0:0:0:
256,192,19000,12,0,19800,0:0:0:0:
64,64,21000,5,0,0:0:0:0:
192,64,21375,1,0,0:0:0:0:
320,64,21750,1,0,0:0:0:0:
448,64,22125,1,0,0:0:0:0:
448,192,22500,2,0,B|448:288|352:320|256:288|160:320|64:288|64:192,1,600,0|0,0:0|0:0,0:0:0:0:
`;

export function createSampleBeatmap(): Beatmap {
  const bm = parseOsu(OSU);
  bm.hitObjects.forEach(o => { o.id = genId(); });
  return bm;
}

// 生成一段简单的合成音频(WAV)作为演示音乐: 节拍滴答 + 简单旋律
export function generateDemoAudio(bpmChanges: { time: number; beatLength: number }[]): string {
  const sr = 22050;
  const dur = 24; // 秒
  const n = sr * dur;
  const data = new Float32Array(n);
  const freqs = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ms = t * 1000 + 1000;
    let beatLen = 500;
    for (const b of bpmChanges) if (ms >= b.time) beatLen = b.beatLength;
    const beatPhase = (ms % beatLen) / beatLen;
    // 每拍滴答
    if (beatPhase < 0.06) {
      const env = 1 - beatPhase / 0.06;
      data[i] += Math.sin(2 * Math.PI * 1000 * t) * env * 0.35;
    }
    // 旋律: 每两拍一个音
    const noteIdx = Math.floor(ms / (beatLen * 2)) % freqs.length;
    const notePhase = (ms % (beatLen * 2)) / (beatLen * 2);
    if (notePhase < 0.5) {
      const env = Math.exp(-notePhase * 6);
      data[i] += Math.sin(2 * Math.PI * freqs[noteIdx] * t) * env * 0.18;
      data[i] += Math.sin(2 * Math.PI * freqs[noteIdx] * 2 * t) * env * 0.05;
    }
  }
  // 编码 WAV
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  const blob = new Blob([buf], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
