// verifier/v503/real.ts
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// src/osu/fft.ts
function fft(re, im) {
  const n = re.length;
  if (n !== im.length || n < 2 || (n & n - 1) !== 0) throw new Error("fft: length must be power of 2");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const xr = re[b] * cwr - im[b] * cwi;
        const xi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}
function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  return w;
}

// src/osu/bpmDetect.ts
var ANALYSIS_SR = 11025;
var WIN = 512;
var HOP = 64;
function mixDownResample(buf2, targetSr = ANALYSIS_SR) {
  const sr = buf2.sampleRate;
  const n = buf2.length;
  const ch0 = buf2.getChannelData(0);
  const ch1 = buf2.numberOfChannels > 1 ? buf2.getChannelData(1) : ch0;
  if (sr === targetSr) {
    const out2 = new Float32Array(n);
    for (let i = 0; i < n; i++) out2[i] = (ch0[i] + ch1[i]) * 0.5;
    return out2;
  }
  const ratio = sr / targetSr;
  const m = Math.floor(n / ratio);
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    const a = j < n ? j : n - 1, b = j + 1 < n ? j + 1 : n - 1;
    out[i] = ((ch0[a] + ch1[a]) * (1 - f) + (ch0[b] + ch1[b]) * f) * 0.5;
  }
  return out;
}
function onsetEnvelope(samples, sr, win = WIN, hop = HOP) {
  const frames = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  const hann = hannWindow(win);
  const re = new Float32Array(win), im = new Float32Array(win);
  const bins = win >> 1;
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) {
      re[i] = samples[off + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(bins);
    for (let b = 0; b < bins; b++) mag[b] = Math.log1p(100 * Math.hypot(re[b], im[b]) / (1 + b / 24));
    if (prev === null) {
      prev = mag;
      continue;
    }
    let flux = 0;
    for (let b = 0; b < bins; b++) {
      const d = mag[b] - prev[b];
      if (d > 0) flux += d;
    }
    prev = mag;
    env[f] = flux;
  }
  const w = Math.max(1, Math.round(1e3 / (hop / sr * 1e3)));
  const norm = new Float32Array(frames);
  let run = 0;
  const q = [];
  let maxV = 0;
  for (let i = 0; i < frames; i++) {
    q.push(env[i]);
    run += env[i];
    if (q.length > w) run -= q.shift();
    const v = Math.max(0, env[i] - run / q.length * 0.7);
    norm[i] = v;
    if (v > maxV) maxV = v;
  }
  if (maxV > 0) for (let i = 0; i < frames; i++) norm[i] /= maxV;
  return { env: norm, hopMs: hop / sr * 1e3 };
}
function acfFrac(seg, lag) {
  const n = seg.length;
  const l0 = Math.floor(lag), f = lag - l0;
  let s = 0, cnt = 0;
  for (let i = 0; i + l0 + 1 < n; i++) {
    s += seg[i] * (seg[i + l0] * (1 - f) + seg[i + l0 + 1] * f);
    cnt++;
  }
  return cnt ? s / cnt : 0;
}
function trackScore(env, P) {
  if (P < 2 || env.length < P * 3) return 0;
  let t = 0;
  {
    let bv = -1;
    const end = Math.min(env.length - 1, Math.round(P * 2));
    for (let i = 0; i <= end; i++) if (env[i] > bv) {
      bv = env[i];
      t = i;
    }
  }
  const beats = [];
  while (t < env.length) {
    beats.push(t);
    const j0 = Math.round(t + P * 0.85), j1 = Math.min(env.length - 1, Math.round(t + P * 1.15));
    if (j0 > j1) break;
    let bj = j0, bv = -1;
    for (let j = j0; j <= j1; j++) if (env[j] > bv) {
      bv = env[j];
      bj = j;
    }
    t = bj;
  }
  if (beats.length < 3) return 0;
  const meanEnv = beats.reduce((s, b) => s + env[b], 0) / beats.length;
  let varSum = 0;
  for (const b of beats) {
    const d = env[b] - meanEnv;
    varSum += d * d;
  }
  const cv = Math.sqrt(varSum / beats.length) / (meanEnv || 1);
  let peakE = 0, unexplained = 0;
  const thresh = meanEnv * 0.75;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] >= thresh) {
      peakE += env[i];
      let onGrid = false;
      for (const b of beats) if (Math.abs(b - i) <= P * 0.12) {
        onGrid = true;
        break;
      }
      if (!onGrid) unexplained += env[i];
    }
  }
  const resid = peakE > 0 ? unexplained / peakE : 1;
  return meanEnv * (1 - resid) * (1 - Math.min(0.5, cv));
}
function acfCandidates(seg, minLag, maxLag) {
  maxLag = Math.min(maxLag, (seg.length >> 1) - 2);
  if (maxLag <= minLag + 1) return [];
  const acf = new Float64Array(maxLag * 2 + 2);
  for (let lag = minLag; lag <= maxLag * 2 && lag < seg.length - 2; lag++) acf[lag] = acfFrac(seg, lag);
  const peaks = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const s = acf[lag] + 0.5 * acf[lag * 2];
    if (s >= acf[lag - 1] + 0.5 * acf[(lag - 1) * 2] && s > acf[lag + 1] + 0.5 * acf[(lag + 1) * 2]) peaks.push(lag);
  }
  peaks.sort((a, b) => acf[b] + 0.5 * acf[b * 2] - (acf[a] + 0.5 * acf[a * 2]));
  const cand = peaks.slice(0, 8);
  if (!cand.length) return [];
  let bestAcf = 0;
  const refd = [];
  for (const c2 of cand) {
    let bl = c2, bs = -Infinity;
    for (let d = -1; d <= 1.0001; d += 0.1) {
      const l = c2 + d;
      if (l < minLag || l > maxLag) continue;
      const s = acfFrac(seg, l) + 0.5 * acfFrac(seg, l * 2);
      if (s > bs) {
        bs = s;
        bl = l;
      }
    }
    if (bs > bestAcf) bestAcf = bs;
    refd.push({ lag: bl, adj: trackScore(seg, bl) });
  }
  if (bestAcf <= 2e-3) return [];
  refd.sort((a, b) => b.adj - a.adj);
  return refd.slice(0, 6);
}
function acfBestPeriod(seg, minLag, maxLag) {
  const c2 = acfCandidates(seg, minLag, maxLag);
  return c2.length ? { lag: c2[0].lag, score: c2[0].adj } : null;
}
function tempoPrior(env, hopMs, minBpm = 60, maxBpm = 440) {
  const minLag = Math.max(2, Math.round(6e4 / maxBpm / hopMs));
  const maxLag = Math.round(6e4 / minBpm / hopMs);
  return acfBestPeriod(env, minLag, maxLag)?.lag ?? Math.round(6e4 / 120 / hopMs);
}
function tempoCurve(env, hopMs, minBpm = 60, maxBpm = 440) {
  const minLag = Math.max(2, Math.round(6e4 / maxBpm / hopMs));
  const maxLag = Math.ceil(6e4 / minBpm / hopMs) + 1;
  const winFL = Math.round(4e3 / hopMs), winFS = Math.round(1600 / hopMs), hopF = Math.round(500 / hopMs);
  const LAMBDA = 1;
  const PRIOR_K = 0.1, PRIOR_SIG = 0.25;
  const fallback = tempoPrior(env, hopMs, minBpm, maxBpm);
  const wins = [];
  for (let w0 = 0; w0 + winFL <= env.length; w0 += hopF) {
    const cands = acfCandidates(env.subarray(w0, w0 + winFL), minLag, Math.min(maxLag, (winFL >> 1) - 1));
    if (w0 + winFS <= env.length) {
      const s0 = w0 + (winFL - winFS >> 1);
      for (const c2 of acfCandidates(env.subarray(s0, s0 + winFS), minLag, Math.min(maxLag, (winFS >> 1) - 1))) {
        const dup = cands.find((x) => Math.abs(Math.log(x.lag / c2.lag)) < 0.03);
        if (dup) {
          if (c2.adj > dup.adj) {
            dup.lag = c2.lag;
            dup.adj = c2.adj;
          }
        } else cands.push(c2);
      }
      cands.sort((a, b) => b.adj - a.adj);
      cands.length = Math.min(cands.length, 6);
    }
    if (cands.length) wins.push({ at: w0 + winFL / 2, cands });
    const win = wins[wins.length - 1];
    if (win && win.at === w0 + winFL / 2 && !win.cands.some((x) => Math.abs(Math.log(x.lag / fallback)) < 0.03)) {
      const adj = trackScore(env.subarray(w0, w0 + winFL), fallback);
      win.cands.push({ lag: fallback, adj });
      win.cands.sort((a, b) => b.adj - a.adj);
      win.cands.length = Math.min(win.cands.length, 6);
    }
  }
  if (!wins.length) return () => fallback;
  const dp = [];
  const bp = [];
  for (let w = 0; w < wins.length; w++) {
    dp.push([]);
    bp.push([]);
    for (let c2 = 0; c2 < wins[w].cands.length; c2++) {
      const cur = wins[w].cands[c2];
      const lg2 = Math.log(cur.lag / fallback);
      const em = cur.adj * cur.adj + PRIOR_K * Math.exp(-(lg2 * lg2) / (2 * PRIOR_SIG * PRIOR_SIG));
      if (w === 0) {
        const lg = Math.log(cur.lag / fallback);
        dp[w].push(em - 2 * lg * lg);
        bp[w].push(-1);
        continue;
      }
      const gapFree = wins[w].at - wins[w - 1].at > hopF * 4;
      let best = -Infinity, bj = 0;
      for (let p = 0; p < wins[w - 1].cands.length; p++) {
        const prev = wins[w - 1].cands[p];
        const lg = Math.log(cur.lag / prev.lag);
        const s = dp[w - 1][p] + em - (gapFree ? 0 : LAMBDA * lg * lg);
        if (s > best) {
          best = s;
          bj = p;
        }
      }
      dp[w].push(best);
      bp[w].push(bj);
    }
  }
  let bi = 0;
  for (let c2 = 1; c2 < dp[wins.length - 1].length; c2++) if (dp[wins.length - 1][c2] > dp[wins.length - 1][bi]) bi = c2;
  const pts = [];
  for (let w = wins.length - 1; w >= 0; w--) {
    pts.unshift({ at: wins[w].at, period: wins[w].cands[bi].lag });
    bi = bp[w][bi];
    if (bi < 0 && w > 0) bi = 0;
  }
  const sm = pts.map((p, i) => {
    const nb = [pts[i - 1]?.period, p.period, pts[i + 1]?.period].filter((x) => x !== void 0);
    nb.sort((a, b) => a - b);
    return { at: p.at, period: nb[nb.length >> 1] };
  });
  return (i) => {
    if (i <= sm[0].at) return sm[0].period;
    const last = sm[sm.length - 1];
    if (i >= last.at) return last.period;
    for (let k = 1; k < sm.length; k++) {
      if (i < sm[k].at) {
        const f = (i - sm[k - 1].at) / (sm[k].at - sm[k - 1].at);
        return sm[k - 1].period + (sm[k].period - sm[k - 1].period) * f;
      }
    }
    return last.period;
  };
}
function trackBeats(env, periodAt, tightness = 50) {
  const n = env.length;
  if (n < 4) return [];
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const P = periodAt(i);
    if (P < 2) {
      cum[i] = env[i];
      continue;
    }
    const lo = Math.max(1, Math.round(P * 0.8));
    const hi = Math.max(lo + 1, Math.round(P * 1.25));
    let best = -Infinity, bj = -1;
    const j0 = Math.max(0, i - hi), j1 = i - lo;
    for (let j = j0; j <= j1; j++) {
      const ratio = (i - j) / P;
      const lg = Math.log(ratio);
      const s = cum[j] - tightness * lg * lg;
      if (s > best) {
        best = s;
        bj = j;
      }
    }
    cum[i] = env[i] + (bj >= 0 ? best : 0);
    back[i] = bj;
  }
  const Pn = periodAt(n - 1);
  let e = Math.max(0, n - 1 - Math.round(Pn * 1.5));
  for (let i = e + 1; i < n; i++) if (cum[i] > cum[e]) e = i;
  const beats = [];
  for (let i = e; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();
  while (beats.length && back[beats[0]] === -1 && env[beats[0]] < 0.05) beats.shift();
  return beats;
}
function refineBeats(env, beats, hopMs) {
  const winThreeQuarterMs = 0.75 * WIN / ANALYSIS_SR * 1e3;
  return beats.map((b) => {
    let p = b;
    for (let i = Math.max(0, b - 2); i <= Math.min(env.length - 1, b + 2); i++) if (env[i] > env[p]) p = i;
    let frac = 0;
    if (p > 0 && p < env.length - 1) {
      const y0 = env[p - 1], y1 = env[p], y2 = env[p + 1];
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-9) frac = 0.5 * (y0 - y2) / denom;
    }
    return (p + Math.max(-0.5, Math.min(0.5, frac))) * hopMs + winThreeQuarterMs;
  });
}
function segmentBeats(beatsMs, opts = {}) {
  const meter = opts.meter ?? 4;
  const quantize = opts.quantize ?? 0.1;
  if (beatsMs.length < 2) return [];
  const tol = opts.segmentTol ?? 0.02;
  const runs = [];
  const ivs = [];
  for (let i = 1; i < beatsMs.length; i++) ivs.push(beatsMs[i] - beatsMs[i - 1]);
  const ivSm = ivs.map((_, i) => median(ivs.slice(Math.max(0, i - 1), i + 2)));
  let s = 0;
  let outlier = 0;
  for (let i = 1; i < beatsMs.length; i++) {
    const iv = ivSm[i - 1];
    const runIvs = [];
    for (let k = s + 1; k < i; k++) runIvs.push(beatsMs[k] - beatsMs[k - 1]);
    const med = runIvs.length ? median(runIvs) : iv;
    if (runIvs.length && Math.abs(iv - med) / med > tol) {
      if (++outlier >= 2) {
        runs.push([s, i - outlier]);
        s = i - outlier + 1;
        outlier = 0;
      }
    } else outlier = 0;
  }
  runs.push([s, beatsMs.length - 1]);
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const p1 = fitLine(beatsMs.slice(prev[0], prev[1] + 1)).period;
      const p2 = fitLine(beatsMs.slice(r[0], r[1] + 1)).period;
      if (Math.abs(p1 - p2) / Math.min(p1, p2) < 0.015) {
        prev[1] = r[1];
        continue;
      }
    }
    merged.push([r[0], r[1]]);
  }
  const segs = [];
  for (const [a0, a1] of merged) {
    const nBeats = a1 - a0 + 1;
    if (nBeats < 2) continue;
    const ts = beatsMs.slice(a0, a1 + 1);
    let { period, phase } = fitLine(ts);
    let bpm = 6e4 / period;
    if (quantize > 0) {
      bpm = Math.round(bpm / quantize) * quantize;
      period = 6e4 / bpm;
      let sum = 0;
      for (let k = 0; k < ts.length; k++) sum += ts[k] - k * period;
      phase = sum / ts.length;
    }
    const ivs2 = [];
    for (let k = 1; k < ts.length; k++) ivs2.push(ts[k] - ts[k - 1]);
    const mean = ivs2.reduce((x, y) => x + y, 0) / ivs2.length;
    const sd = Math.sqrt(ivs2.reduce((x, y) => x + (y - mean) * (y - mean), 0) / ivs2.length);
    const cv = sd / mean;
    segs.push({
      time: Math.round(phase),
      bpm: Math.round(bpm * 1e3) / 1e3,
      meter,
      beats: nBeats,
      confidence: Math.max(0, Math.min(1, 1 - cv / 0.05))
    });
  }
  return segs;
}
function fitLine(ts) {
  const n = ts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) {
    sx += k;
    sy += ts[k];
    sxx += k * k;
    sxy += k * ts[k];
  }
  const det = n * sxx - sx * sx;
  const period = det !== 0 ? (n * sxy - sx * sy) / det : (ts[n - 1] - ts[0]) / (n - 1);
  const phase = (sy - period * sx) / n;
  return { period, phase };
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function detectBpm(buf2, opts = {}) {
  const numCh = Math.max(1, buf2.numberOfChannels);
  if (numCh === 1) return detectBpmMono(buf2, opts);
  let best = null;
  for (let ch = 0; ch < numCh; ch++) {
    const sub = {
      sampleRate: buf2.sampleRate,
      numberOfChannels: 1,
      length: buf2.length,
      getChannelData: () => buf2.getChannelData(ch)
    };
    const subOpts = { ...opts, onProgress: (p, stage) => opts.onProgress?.((ch + p) / numCh, stage) };
    const result = detectBpmMono(sub, subOpts);
    const c2 = extractConstantTempo(result);
    const score = c2 ? c2.coverage * result.beats.length : 0;
    if (!best || score > best.score) best = { result, score };
  }
  return best.result;
}
function detectBpmMono(buf2, opts = {}) {
  const prog = opts.onProgress ?? (() => {
  });
  prog(0.02, "mixdown");
  const mono = mixDownResample(buf2);
  prog(0.1, "onset");
  const { env, hopMs } = onsetEnvelope(mono, ANALYSIS_SR);
  prog(0.55, "tempo prior");
  let periodAt = tempoCurve(env, hopMs, opts.minBpm ?? 60, opts.maxBpm ?? 440);
  if (opts.minBpm === void 0) {
    const floorMs = 6e4 / 60;
    let pinned = 0, total = 0;
    for (let f = 0; f < env.length; f += Math.round(500 / hopMs)) {
      total++;
      if (Math.abs(periodAt(f) * hopMs - floorMs) / floorMs < 0.05) pinned++;
    }
    if (pinned / total > 0.03) periodAt = tempoCurve(env, hopMs, 45, opts.maxBpm ?? 440);
  }
  prog(0.65, "beat tracking");
  const rawBeats = trackBeats(env, periodAt, opts.tightness ?? 50);
  prog(0.85, "refine");
  const beats = refineBeats(env, rawBeats, hopMs);
  prog(0.92, "segment");
  const segments = segmentBeats(beats, opts);
  prog(1, "done");
  return { beats, segments, analysis: { env, hopMs } };
}
function extractConstantTempo(result, quantize = 0.1, tolMs = 15) {
  const segs = result.segments;
  if (!segs.length || !result.beats.length) return null;
  const dom = [...segs].sort((a, b) => b.beats - a.beats)[0];
  let P = 6e4 / dom.bpm;
  let phi = dom.time;
  const beats = result.beats;
  const domIdx = segs.indexOf(dom);
  const segBeats = segs.map((s, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].time : Infinity;
    return beats.filter((b) => b >= s.time - 1 && b < end - 1);
  });
  let bestP = P, bestCost = Infinity;
  for (let d = -4e-3; d <= 40001e-7; d += 1e-4) {
    const cand = P * (1 + d);
    let cost = 0;
    for (const bs of segBeats) {
      if (bs.length < 2) continue;
      const res = bs.map((b) => b - Math.round((b - bs[0]) / cand) * cand);
      const ph = median(res);
      for (const r of res) cost += Math.abs(r - ph);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestP = cand;
    }
  }
  P = bestP;
  {
    const bs = segBeats[domIdx];
    if (bs.length) phi = median(bs.map((b) => b - Math.round((b - bs[0]) / P) * P));
  }
  const bpmOut = quantize > 0 ? Math.round(6e4 / P / quantize) * quantize : 6e4 / P;
  P = 6e4 / bpmOut;
  {
    const bs = segBeats[domIdx];
    if (bs.length) phi = median(bs.map((b) => b - Math.round((b - bs[0]) / P) * P));
  }
  const tol = tolMs * Math.min(1, P / 360);
  const gridDist = (b, sub) => {
    const g = P / sub;
    const d = ((b - phi) % g + g) % g;
    return Math.min(d, g - d);
  };
  const explained = beats.map((b) => gridDist(b, 8) <= tol || gridDist(b, 6) <= tol);
  const variableSections = [];
  const bestFitRatio = (bs) => {
    let best = 0;
    for (const sub of [8, 6]) {
      const g = P / sub;
      for (let step = 0; step < 24; step++) {
        const d0 = g * step / 24;
        let ok = 0;
        for (const b of bs) {
          const d = ((b - phi - d0) % g + g) % g;
          if (Math.min(d, g - d) <= tol) ok++;
        }
        if (ok / bs.length > best) best = ok / bs.length;
      }
    }
    return best;
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.beats < Math.max(8, result.beats.length * 0.03)) continue;
    if (Math.abs(6e4 / s.bpm - P) / P <= 0.02) continue;
    const end = i + 1 < segs.length ? segs[i + 1].time : Infinity;
    const bs = beats.filter((b) => b >= s.time - 1 && b < end - 1);
    if (bs.length < 8) continue;
    const ivs = [];
    for (let k = 1; k < bs.length; k++) ivs.push(bs[k] - bs[k - 1]);
    const mean = ivs.reduce((a2, b) => a2 + b, 0) / ivs.length;
    const cv = Math.sqrt(ivs.reduce((a2, b) => a2 + (b - mean) * (b - mean), 0) / ivs.length) / mean;
    if (cv >= 0.1) continue;
    if (bestFitRatio(bs) >= 0.9) continue;
    const a = result.analysis;
    if (a) {
      const f0 = Math.max(0, Math.round(s.time / a.hopMs));
      const f1 = Math.min(a.env.length, Math.round((end === Infinity ? bs[bs.length - 1] : end) / a.hopMs));
      const win = a.env.subarray(f0, f1);
      const sDom = trackScore(win, P / a.hopMs);
      const sVar = trackScore(win, 6e4 / s.bpm / a.hopMs);
      if (sDom >= sVar * 0.7) continue;
      if (sVar < 0.06) continue;
    }
    variableSections.push({ time: s.time, bpm: s.bpm, beats: s.beats });
  }
  const a0 = result.analysis;
  if (a0) {
    const winMs = 8e3, stepMs = 4e3;
    const songEnd = beats[beats.length - 1];
    let marked = [];
    for (let t0 = Math.max(0, dom.time - winMs); t0 < songEnd; t0 += stepMs) {
      const idxs = [];
      for (let i = 0; i < beats.length; i++) if (beats[i] >= t0 && beats[i] < t0 + winMs) idxs.push(i);
      if (idxs.length < 6) continue;
      const un = idxs.filter((i) => !explained[i]);
      if (un.length / idxs.length < 0.5) continue;
      const bs = idxs.map((i) => beats[i]);
      const ivs = [];
      for (let k = 1; k < bs.length; k++) ivs.push(bs[k] - bs[k - 1]);
      const med = median(ivs);
      if (Math.abs(med - P) / P <= 0.02) continue;
      const f0 = Math.round(t0 / a0.hopMs), f1 = Math.min(a0.env.length, Math.round((t0 + winMs) / a0.hopMs));
      const win = a0.env.subarray(f0, f1);
      if (trackScore(win, P / a0.hopMs) >= trackScore(win, med / a0.hopMs) * 0.7) continue;
      marked.push({ t0, t1: t0 + winMs, med, n: idxs.length });
    }
    for (const m of marked) {
      if (variableSections.some((v) => Math.abs(v.time - m.t0) < winMs)) continue;
      variableSections.push({ time: Math.round(m.t0), bpm: Math.round(6e4 / m.med * 1e3) / 1e3, beats: m.n });
    }
    variableSections.sort((a, b) => a.time - b.time);
  }
  const explainedBeats = beats.filter((_, i) => explained[i]);
  const first = explainedBeats.length ? Math.min(...explainedBeats) : phi;
  const vsMerged = [];
  for (const v of variableSections) {
    const prev = vsMerged[vsMerged.length - 1];
    if (prev && Math.abs(6e4 / prev.bpm - 6e4 / v.bpm) / (6e4 / v.bpm) < 0.03) {
      prev.bpm = Math.round((prev.bpm * prev.beats + v.bpm * v.beats) / (prev.beats + v.beats) * 1e3) / 1e3;
      prev.beats += v.beats;
    } else vsMerged.push({ ...v });
  }
  const offset = Math.round(phi + Math.round((first - phi) / P) * P);
  return {
    bpm: Math.round(bpmOut * 1e3) / 1e3,
    offsetMs: offset,
    coverage: explainedBeats.length / beats.length,
    segmentCount: segs.length,
    rawBpm: dom.bpm,
    variableSections: vsMerged,
    lines: [
      { time: offset, bpm: Math.round(bpmOut * 1e3) / 1e3, meter: dom.meter },
      ...vsMerged.map((v) => ({ time: v.time, bpm: v.bpm, meter: dom.meter }))
    ].sort((a, b) => a.time - b.time)
  };
}

// verifier/v503/real.ts
var failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  } else console.log("  ok:", msg);
}
var dir = "F:/Backup/D/osu!/Songs/t+pazolite - Kick-ass Kung-fu Carnival";
execSync(`ffmpeg -y -v error -i "${dir}/14 - Kick-ass Kung-fu Carnival.mp3" -ac 1 -ar 11025 -f f32le verifier/v503/.c.pcm`);
var raw = readFileSync("verifier/v503/.c.pcm");
var all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
var pcm = all.subarray(Math.round(25 * 11.025));
var buf = { sampleRate: 11025, numberOfChannels: 1, length: pcm.length, getChannelData: () => pcm };
var c = extractConstantTempo(detectBpm(buf));
assert(Math.abs(c.bpm - 220) <= 1.1, `Carnival \u4E3B\u533A 220 (\u5B9E\u9645 ${c.bpm})`);
assert(
  c.variableSections.every((v) => v.time >= 3e4),
  // v503b: 安静前奏低支撑误报被 sVar<0.06 过滤
  `Carnival \u5F00\u5934 30s \u5185\u65E0\u8BEF\u62A5\u53D8\u901F\u7EBF (\u5B9E\u9645 ${c.variableSections.map((v) => `${v.time}@${v.bpm.toFixed(0)}`).join(" ") || "(\u65E0)"})`
);
console.log("  info: lines =", c.lines.map((l) => `${l.time}@${l.bpm.toFixed(1)}`).join(" "));
console.log(failures ? `
V503_REAL_FAILED: ${failures}` : "\nV503_REAL_PASSED");
process.exit(failures ? 1 : 0);
