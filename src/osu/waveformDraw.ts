// v127: 波形/频谱绘制层 (从 WaveformPanel 抽出 — 面板已废弃, 波形改画在上方时间轴背景/上层)
// 数据源 = waveformData (getPeaks/getSpectroColumn); 视口公式与 TopTimeline 相同 (win = 6000/timelineZoom) → 逐像素对齐
// v112: 波形/频谱显示偏移常量 WAVEFORM_VISUAL_OFFSET_MS=20 在 waveformData.ts (纯数据层, 可单测);
//       对齐 lazer Editor.WAVEFORM_VISUAL_OFFSET (ppy/osu PR#26136) — 谱面计时应含 ~20ms 历史系统延迟,
//       采样取 t+20 → 内容左移 20ms 对齐社区预期 (纯视觉, 不影响播放/hitsound)。
import { getPeaks, getSpectroColumn, spectroColor, spectroScrollStep, WAVEFORM_VISUAL_OFFSET_MS } from './waveformData';

// Audition 风波形配色 (v105: 背景半透明, 透出下层内容)
export const WAVE_BG = 'rgba(20,20,20,0.55)';
// v284: 时间轴半透明为唯一行为 (开关移除) — 固定淡底; 原 0.55 波形底 + 0.5 暗化层 (v137) 叠加后透过率仅 22%,
//       叠在 #111116 画布底色上观感纯黑 (用户反馈「时间轴半透明无效, 底色是纯黑的」); 频谱底同理固定 40
const waveBg = () => 'rgba(20,20,20,0.12)'; // v272: 0.25→0.12 (仍遮挡物件)
const WAVE_EDGE = '#1e6e2e';  // 端部暗绿
const WAVE_CORE = '#7fe07f';  // 核心亮绿
/** 频谱底 alpha (无数据/静音处半透明); 数据像素随强度 140→255 */
const spectroBgAlpha = () => 40; // v271; v272: 70→40; v284: 固定 (开关移除, 原 SPECTRO_BG_ALPHA=140 分支删除)

/** 频谱滚动缓存: 离屏位图 + 该位图精确表示的视口参数 (imgT0 为浮点毫秒, 亚像素残差留在其中, 不单独累积) */
export interface SpectroScroll { cv: HTMLCanvasElement; imgT0: number; win: number; w: number; h: number; bgA: number } // v271: bgA 入缓存键 (半透明开关切换即重建)

// ---------- 波形 (Audition 风: 垂直中心对称, 核心亮绿→端部暗绿) ----------
export function drawWave(g: CanvasRenderingContext2D, buf: AudioBuffer, t0: number, win: number, W: number, H: number, dpr: number) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H); // v105: 半透明底 — 每帧先清, 防 source-over 累积
  g.fillStyle = waveBg(); g.fillRect(0, 0, W, H); // v271: 半透明模式底更淡
  const peaks = getPeaks(buf);
  const cols = Math.ceil(W);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, WAVE_EDGE); grad.addColorStop(0.5, WAVE_CORE); grad.addColorStop(1, WAVE_EDGE);
  g.fillStyle = grad;
  const center = H / 2, half = H / 2 - 2 * dpr;
  // v246: 全部列汇成一条路径一次 fill — 原逐列 fillRect (3757 列/帧 × 240fps ≈ 90 万次/秒调用,
  //   CDP 探针实测为全部画布操作的第一热点, 逐 call 的状态/光栅开销远超像素本身); 间隙列 continue 跳过即可
  g.beginPath();
  for (let cx = 0; cx < cols; cx++) {
    // v112: +WAVEFORM_VISUAL_OFFSET_MS 采样 → 内容左移 20ms (lazer 显示约定, 见常量注释)
    const msA = t0 + (cx / W) * win + WAVEFORM_VISUAL_OFFSET_MS;
    const msB = t0 + ((cx + 1) / W) * win + WAVEFORM_VISUAL_OFFSET_MS;
    let b0 = Math.floor(msA / peaks.msPerBucket);
    let b1 = Math.max(b0, Math.ceil(msB / peaks.msPerBucket) - 1);
    if (b1 < 0 || b0 >= peaks.buckets) continue;
    b0 = Math.max(0, b0); b1 = Math.min(peaks.buckets - 1, b1);
    let mn = Infinity, mx = -Infinity;
    for (let b = b0; b <= b1; b++) {
      if (peaks.min[b] < mn) mn = peaks.min[b];
      if (peaks.max[b] > mx) mx = peaks.max[b];
    }
    if (mn === Infinity) continue;
    const yTop = center - mx * half;
    const yBot = center - mn * half;
    g.rect(cx, yTop, 1, Math.max(1, yBot - yTop));
  }
  g.fill();
  // 中心线
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, center, W, 1);
}

// ---------- 频谱 (对数频率, 低频在下; 逐列自适应 + 离屏缓存 + 滚动填充) ----------
// v106: 整曲固定 hop 帧阵列 → 逐列自适应 (getSpectroColumn, LRU):
//   · 分辨率恒 = msPerPixel, 任何缩放级别都无方格 (原 21.3ms 帧在放大时每帧占数像素 → 方格)
//   · FFT 窗口以列中心为中心 (原整曲路径窗口前缘对齐 → 能量右偏半个窗 ≈ +23ms 的根因)
export function drawSpectro(
  g: CanvasRenderingContext2D, buf: AudioBuffer, t0: number, win: number, W: number, H: number,
  scrollRef: { current: SpectroScroll | null },
) {
  let sc = scrollRef.current;
  const bgA = spectroBgAlpha(); // v271
  if (!sc || sc.w !== W || sc.h !== H || sc.win !== win || sc.bgA !== bgA) {
    // 全量重绘 (尺寸/缩放/透明度开关变化)
    const cv = sc?.cv ?? document.createElement('canvas');
    cv.width = W; cv.height = H;
    renderSpectroStrip(cv, buf, t0, win, 0, W);
    sc = { cv, imgT0: t0, win, w: W, h: H, bgA };
    scrollRef.current = sc;
  } else {
    // 滚动填充: 整像素平移旧图, 只补新露出的列
    // v111: 平移簿记走纯函数 spectroScrollStep — imgT0 始终是离屏图精确表示的视口起点 (浮点),
    //       亚像素残差自然留在 imgT0 里, 误差恒 ≤0.5px 不累积。
    const { dx, newImgT0 } = spectroScrollStep(sc.imgT0, t0, win, W);
    if (dx !== 0) {
      if (Math.abs(dx) >= W) {
        renderSpectroStrip(sc.cv, buf, t0, win, 0, W);
        sc.imgT0 = t0;
      } else {
        const ctx = sc.cv.getContext('2d')!;
        // v105: 半透明像素 — 同画布平移必须 'copy' (source-over 会把半透明源二次叠加变深)
        ctx.globalCompositeOperation = 'copy';
        if (dx > 0) { // 内容左移, 右侧露出
          ctx.drawImage(sc.cv, dx, 0, W - dx, H, 0, 0, W - dx, H);
        } else {      // 内容右移, 左侧露出
          ctx.drawImage(sc.cv, 0, 0, W + dx, H, -dx, 0, W + dx, H);
        }
        ctx.globalCompositeOperation = 'source-over';
        // 新露出列按位图自身时间基准 newImgT0 采样 (与已平移部分同一基准, 接缝无时间差)
        if (dx > 0) renderSpectroStrip(sc.cv, buf, newImgT0, win, W - dx, W);
        else renderSpectroStrip(sc.cv, buf, newImgT0, win, 0, -dx);
        sc.imgT0 = newImgT0;
      }
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H); // v105: 半透明 — 必须先清帧, 否则 source-over 逐帧累积变不透明
  g.drawImage(sc.cv, 0, 0);
}

/** 渲染频谱 [x0, x1) 列到离屏 canvas; 每列按需算一帧 (LRU 复用), 越界列留半透明黑底 */
function renderSpectroStrip(cv: HTMLCanvasElement, buf: AudioBuffer, t0: number, win: number, x0: number, x1: number) {
  const ctx = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  const stripW = x1 - x0;
  if (stripW <= 0) return;
  const img = ctx.createImageData(stripW, H);
  const px = img.data;
  const bgA = spectroBgAlpha(); // v271: 半透明模式底更淡 (70)
  for (let i = 3; i < px.length; i += 4) px[i] = bgA; // v105: 半透明黑底
  const bins = 256; // = getSpectroColumn 输出长度
  const lenMs = (buf.length / buf.sampleRate) * 1000;
  for (let cx = 0; cx < stripW; cx++) {
    // v112: +WAVEFORM_VISUAL_OFFSET_MS (同 drawWave) — 列采样点在像素中心, 再按 lazer 约定左移 20ms
    const ms = t0 + ((x0 + cx + 0.5) / W) * win + WAVEFORM_VISUAL_OFFSET_MS;
    if (ms < 0 || ms >= lenMs) continue; // 歌曲范围外 → 半透明黑
    const col = getSpectroColumn(buf, ms);
    for (let y = 0; y < H; y++) {
      const b = Math.min(bins - 1, ((1 - y / H) * bins) | 0); // 低频在下
      const t = col[b];
      const [r, gg, bb] = spectroColor(t);
      const o = (y * stripW + cx) * 4;
      px[o] = r; px[o + 1] = gg; px[o + 2] = bb;
      px[o + 3] = Math.round(bgA + t * (255 - bgA)); // 静音处半透明, 强信号不透明 (v271: 底 alpha 随开关)
    }
  }
  ctx.putImageData(img, x0, 0);
}
