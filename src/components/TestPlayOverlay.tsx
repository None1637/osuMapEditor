// v287: 测试游玩覆盖层 — 参考 lazer EditorPlayer (osu.Game/Screens/Edit/GameplayTest/EditorPlayer.cs)
//  - 进入: 暂停编辑器 → 从 editorTime-3s (TESTPLAY_LEAD_BACK) 起播 (editorTime 前物件满分预填, 见 TestPlaySession);
//  - 游玩: 鼠标瞄准 + Z/X/鼠标左键击打; 300/100/50/Miss 判定 + combo/分数/acc/血条 (不失败);
//  - 退出: Esc 或谱面结束+1.5s → 暂停并 seek 回 editorTime (lazer quickExit(false) 语义);
//  - 渲染复用 renderPlayfield (rc.gameplay 分支), hitsound/节拍器由 store.play() 现成调度。
// v294: Mod 支持 (左上角 mod 栏, 切换即重开会话, localStorage 持久化):
//   EZ/HR 调 difficulty (lazer 比率, HR 垂直翻转), HT/DT 调 store.playbackRate (退出恢复),
//   RX 免按键自动击打, AP 光标自动, AT=RX+AP; 互斥规则见 gameplay/mods.ts。
// v416: 皮肤光标 (cursor.png, 缺失回退白圈) + 光标拖尾 (cursortrail.png, ~120ms 渐缩渐隐,
//   按住更密/更不透明) + 覆盖层隐藏系统光标 (DOM 按钮显式 cursor-pointer)。
// v417: 谱面背景图 cover 铺满游玩区 + 0.7 压暗 (转盘期间 renderer 额外压暗照旧叠加)。
// v418: 底部歌曲进度条 (首物件→末物件结束, 钳 [0,1], 避开左下 combo)。
// v419: 首物件前 >3s 显示「跳过」按钮 (点击 seek 到首物件前 2s, 不触发击打判定)。
// v420: 命中泛光 hitlighting.png (renderer gameplay 分支, lighter 加色, 240ms 放大淡出)。
// v421: 左下 combo 增加时弹跳 (瞬时 1.6x, 180ms 缓动回 1.0; 断连击不弹)。
// v422: 被动 HP drain (hp×0.018/s, 首物件前/break 段不掉; 掉空不判负)。
// v423: break 休息段提示 (中央偏上: pass/fail 三角 + Break 字样 + 剩余秒数)。
// v446: 背景图 cover 铺满整个覆盖层画布 (原只铺游玩区; 0.7 压暗照旧, 固定不随适配变换);
//   编辑器侧同步全屏 (EditorCanvas 全屏背景层), 游玩区内额外 0.45 压暗保留保证物件可读性。
import { useEffect, useRef, useState } from 'react';
import { store } from '@/osu/store';
import { getSkin, getSkinContentSeq, skinScaleAdjust, type SkinImage } from '@/osu/skin';
import { computeCombos, renderPlayfield } from '@/osu/renderer';
import { computeStackOffsets } from '@/osu/stacking';
import { TestPlaySession } from '@/osu/gameplay/testPlaySession';
import type { MainResult } from '@/osu/gameplay/judgement';
import {
  updateTrail, trailAlpha, trailScale, coverRect, playProgress, canSkip, skipTarget,
  comboPopScale, breakAt,
  type TrailPoint,
} from '@/osu/gameplay/hud'; // v416–v423: HUD 纯函数助手
import {
  TEST_MODS, adjustDifficulty, applyHardRockFlip, clockRate, isAutopilot, isRelax,
  loadTestMods, saveTestMods, toggleMod, type TestModId,
} from '@/osu/gameplay/mods'; // v294
import { matchesHotkey, matchesHotkeyMouse, effectiveBindings, formatCombo } from '@/osu/hotkeys'; // v288/v289: 击打键走快捷键注册表 (键盘+鼠标可改键)
import { zoomRect, zoomClientX, zoomClientY, fitCanvas } from '@/osu/uiZoom';
import { useT } from '@/i18n';
import { viewTransform } from './EditorCanvas'; // v300: 游玩区大小与编辑器一致 (同一适配变换)

/** v288: 事件是否命中游玩击打键 (test-hit-1/test-hit-2 任一; v289: 默认含鼠标左键, 可改) */
function isHitKey(e: KeyboardEvent): boolean {
  return matchesHotkey(e, 'test-hit-1') || matchesHotkey(e, 'test-hit-2');
}
/** v289: 鼠标按键是否命中游玩击打键 */
function isHitButton(e: MouseEvent): boolean {
  return matchesHotkeyMouse(e, 'test-hit-1') || matchesHotkeyMouse(e, 'test-hit-2');
}

const PW = 512, PH = 384;

// v445: 背景离屏预渲染层 — cover + 0.7 压暗预合成到设备像素位图; 命中时每帧 1 次 1:1 blit
//   (v417 原实现每帧从 2000px 级原图 cover 重采样上屏, 大图重采样带宽在低端机上是帧数杀手)。
//   v446: 层改为铺满整个覆盖层画布 (原只铺游玩区映射区), 固定不随适配变换 — 键只含
//   背景图引用 + 画布 backing 尺寸 (scale/ox/oy 出键), 窗口尺寸/谱面背景变化才重建。
let bgLayer: { key: string; c: HTMLCanvasElement; x: number; y: number; empty: boolean } | null = null;
const bgLayerImgIds = new WeakMap<HTMLImageElement, number>();
let bgLayerImgSeq = 0;

// v445: HUD 皮肤数字串离屏缓存 — score/acc/combo 整串预合成; 按槽位复用同一张位图
//   (串内容/高度/设备缩放/皮肤内容变化才 clearRect+重排进位图, 不换键不新建画布, 避免贴图分配抖动),
//   命中时每帧 1 次 blit (原逐字形 drawImage, score 8 位 + acc 6 位 + combo 每帧 ~19 次小图上屏);
//   位图按设备像素构建, 回贴随当前变换 1:1 上屏不糊; 皮肤内容序号入键, 换肤自动重绘
const hudNumSlots = new Map<string, { key: string; c: HTMLCanvasElement; w: number }>();
const RESULT_COLORS: Record<MainResult, string> = { great: '#ffffff', ok: '#7fff7f', meh: '#5f9fff', miss: '#ff5f5f' };
const RESULT_TEXT: Record<MainResult, string> = { great: '300', ok: '100', meh: '50', miss: 'MISS' };
const POPUP_LIFE = 600;
// v346: mod 按钮 title 文案 (key/英文原文/zh 词典均走 testplay.mod_*)
const MOD_TITLE_KEYS: Record<TestModId, [string, string]> = {
  EZ: ['testplay.mod_ez', 'Easy: all difficulty settings halved'],
  HR: ['testplay.mod_hr', 'HardRock: ×1.4 (CS×1.3) + vertical flip'],
  HT: ['testplay.mod_ht', 'HalfTime: 0.75x'],
  DT: ['testplay.mod_dt', 'DoubleTime: 1.5x'],
  RX: ['testplay.mod_rx', 'Relax: no key pressing required'],
  AP: ['testplay.mod_ap', 'Autopilot: no aiming required'],
  AT: ['testplay.mod_at', 'Autoplay: fully automatic'],
};

export function TestPlayOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef({ x: PW / 2, y: PH / 2 });
  const heldRef = useRef({ mouse: 0, keys: 0 }); // v288/v289: 击打键计数 (多键同时按住不互相清)
  const exitRef = useRef<() => void>(() => {});
  const [mods, setMods] = useState<TestModId[]>(loadTestMods); // v294
  const editorTimeRef = useRef<number | null>(null); // v294: 初次进入时的编辑器时间 (换 mod 重开不变)
  const [showSkip, setShowSkip] = useState(false); // v419: 跳过按钮可见性 (rAF 内按时间更新)
  const skipRef = useRef(false); // v419: 上一份可见性 (避免每帧 setState)
  const firstTimeRef = useRef(0); // v419: 会话首物件时间 (跳过按钮 onClick 用)

  useEffect(() => {
    const bm0 = store.beatmap;
    const c = canvasRef.current;
    if (!bm0 || !c) { onClose(); return; }
    store.testPlayOpen = true; // v445: 暂停编辑器画布/时间轴底层渲染 (退出时清理恢复)
    const g = c.getContext('2d')!;
    if (editorTimeRef.current === null) editorTimeRef.current = store.currentTime;
    const editorTime = editorTimeRef.current;

    // v294: 应用 mod — 调 difficulty (EZ/HR) + HR 垂直翻转, 克隆不污染编辑器谱面
    let bm = bm0;
    const diff = adjustDifficulty(bm.difficulty, mods);
    if (diff !== bm.difficulty) bm = { ...bm, difficulty: diff };
    if (mods.includes('HR')) bm = applyHardRockFlip(bm);

    const stackOffsets = computeStackOffsets(bm);
    const session = new TestPlaySession(bm, editorTime, stackOffsets);
    firstTimeRef.current = session.firstTime; // v419
    const trail: TrailPoint[] = []; // v416: 光标拖尾轨迹 (最近 ~120ms)
    let prevCombo = 0, comboPopAt = -1; // v421: combo 弹跳 (追踪上一份 combo 与上次增长时刻)
    const comboInfo = computeCombos(bm);
    const skin = getSkin();
    const relax = isRelax(mods);
    const autopilot = isAutopilot(mods);
    let closed = false;
    const exit = () => {
      if (closed) return;
      closed = true;
      store.pause();
      store.seek(editorTime);
      onClose();
    };
    exitRef.current = exit;

    // v294: DT/HT 时钟倍率 (退出/换 mod 恢复)
    const prevRate = store.playbackRate;
    const prevPitch = store.rateAdjustPitch; // v295
    store.rateAdjustPitch = mods.includes('DT') || mods.includes('HT'); // v295: DT/HT 走 Frequency 变调 (lazer ModRateAdjust 语义, 无拉伸失真)
    store.setRate(clockRate(mods));

    store.pause();
    store.seek(session.startTime);
    store.play();

    const toOsu = (e: { clientX: number; clientY: number }) => {
      const r = zoomRect(c);
      const { scale, ox, oy } = viewTransform(r); // v300: 与编辑器同一适配变换
      return { x: (zoomClientX(e.clientX) - r.left - ox) / scale, y: (zoomClientY(e.clientY) - r.top - oy) / scale };
    };

    const onMouseMove = (e: MouseEvent) => { if (!autopilot) cursorRef.current = toOsu(e); }; // v294: AP 时光标自动
    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-mods-bar],[data-skip-btn]')) return; // v294/v419: 点 mod 栏/跳过按钮不触发击打
      if (!isHitButton(e)) return; // v289: 鼠标击打键走注册表 (默认左键)
      heldRef.current.mouse++;
      if (!autopilot) cursorRef.current = toOsu(e);
      session.hit(store.positionMs(), cursorRef.current);
    };
    const onMouseUp = (e: MouseEvent) => { if (isHitButton(e)) heldRef.current.mouse = Math.max(0, heldRef.current.mouse - 1); };
    const onKey = (e: KeyboardEvent) => {
      if (matchesHotkey(e, 'test-exit')) { e.preventDefault(); e.stopPropagation(); exit(); return; } // v289: 退出键注册表 (默认 Esc)
      if (isHitKey(e)) { // v288: 注册表击打键 (默认 Z/X, 快捷键设置可改)
        e.preventDefault(); e.stopPropagation();
        if (e.repeat) return;
        heldRef.current.keys++;
        session.hit(store.positionMs(), cursorRef.current);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isHitKey(e)) heldRef.current.keys = Math.max(0, heldRef.current.keys - 1);
    };
    const onBlur = () => { heldRef.current.keys = 0; heldRef.current.mouse = 0; }; // v288: 失焦清零防卡住
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    // v445: profile 钩子 — window.__tpPerf (分段耗时采样: clear/bg/scene/popup/trail/hud/frame)
    //   / window.__tpSkip (分阶段跳过, 定位瓶颈用); 缺省不采样, 每帧仅几次布尔判断
    const __tpw = window as unknown as { __tpPerf?: Record<string, number[]>; __tpSkip?: Record<string, boolean> };
    const __mark = (k: string, s: number) => {
      const p = __tpw.__tpPerf;
      if (!p) return;
      const a = (p[k] ??= []); a.push(performance.now() - s);
      if (a.length > 1800) a.splice(0, a.length - 1800);
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (closed) return;
      const __perfOn = !!__tpw.__tpPerf;
      const __skip = __tpw.__tpSkip;
      const __t0 = __perfOn ? performance.now() : 0;
      let __ts = __t0;
      const time = store.positionMs();
      // v294: Autopilot — 滑条跟球 / 跳向下一物件 (在 update 前取)
      if (autopilot) cursorRef.current = session.autoCursorPos(time) ?? cursorRef.current;
      const held = heldRef.current.mouse > 0 || heldRef.current.keys > 0;
      session.update(time, cursorRef.current, held, relax);
      if (time > session.lastEnd + 1500) { exit(); return; } // lazer: 完成后延迟退出, 直接返回编辑器
      // v419: 首物件前 >3s 显示跳过按钮 (可见性变化才 setState)
      const sk = canSkip(time, session.firstTime);
      if (sk !== skipRef.current) { skipRef.current = sk; setShowSkip(sk); }

      const r = zoomRect(c);
      const { sx, sy } = fitCanvas(c, r);
      g.setTransform(sx, 0, 0, sy, 0, 0);
      if (!__skip?.clear) { // v445: profile 分阶段跳过
        g.fillStyle = '#000';
        g.fillRect(0, 0, r.width, r.height);
      }
      __mark('clear', __ts); __ts = __perfOn ? performance.now() : 0; // v445
      const { scale, ox, oy } = viewTransform(r); // v300: 与编辑器同一适配变换 (游玩区大小一致)
      g.save();
      g.translate(ox, oy);
      g.scale(scale, scale);
      // v417: 谱面背景图 + 0.7 压暗 (未加载/不存在维持纯黑; 转盘期间 renderer drawSpinner 的
      //       额外压暗照旧叠加在其上); v446: cover 目标从 512×384 游玩区改为整个覆盖层画布
      const bg = store.backgroundImg;
      if (bg && !__skip?.bg) { // v445: profile 分阶段跳过
        // v446: cover + 0.7 压暗铺满整个覆盖层画布 (原只铺游玩区) — 离屏层整画布尺寸,
        //   固定不随适配变换 (与编辑器全屏背景一致; lazer 游玩背景即全屏)
        let bid = bgLayerImgIds.get(bg);
        if (bid === undefined) bgLayerImgIds.set(bg, (bid = ++bgLayerImgSeq));
        const key = [bid, c.width, c.height].join('|');
        if (!bgLayer || bgLayer.key !== key) {
          if (!bgLayer) bgLayer = { key, c: document.createElement('canvas'), x: 0, y: 0, empty: true };
          bgLayer.key = key;
          bgLayer.x = 0; bgLayer.y = 0;
          bgLayer.empty = false;
          const lc = bgLayer.c;
          if (lc.width !== c.width || lc.height !== c.height) { lc.width = Math.max(1, c.width); lc.height = Math.max(1, c.height); }
          const lg = lc.getContext('2d')!;
          lg.setTransform(1, 0, 0, 1, 0, 0);
          lg.clearRect(0, 0, lc.width, lc.height);
          const br = coverRect(bg.width, bg.height, lc.width, lc.height); // v446: cover 整画布 (原 PW×PH 游玩区)
          lg.drawImage(bg, br.x, br.y, br.w, br.h);
          lg.fillStyle = 'rgba(0,0,0,0.7)'; // 压暗照旧 (0.7), 现覆盖全屏
          lg.fillRect(0, 0, lc.width, lc.height);
        }
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(bgLayer.c, bgLayer.x, bgLayer.y);
        g.restore();
      }
      __mark('bg', __ts); __ts = __perfOn ? performance.now() : 0; // v445
      if (!__skip?.scene) // v445: profile 分阶段跳过
        renderPlayfield({
          g, bm, skin, time, selected: new Set(), cacheKey: String(store.getVersion()),
          comboInfo, stackOffsets, gameplay: session.renderInfo(),
        });
      __mark('scene', __ts); __ts = __perfOn ? performance.now() : 0; // v445

      // 判定弹出 (v298: 皮肤 hit300/hit100/hit50/hit0 贴图优先, 缺失回退文字; 上浮渐隐)
      const rad = session.radius;
      if (!__skip?.popup) { // v445: profile 分阶段跳过
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const p of session.popups) {
          const age = time - p.at;
          if (age < 0 || age > POPUP_LIFE) continue;
          const k = age / POPUP_LIFE;
          const py = p.y - rad * 0.6 - k * rad * 0.7;
          g.save();
          g.globalAlpha = 1 - k * k;
          const img = { great: skin.hit300, ok: skin.hit100, meh: skin.hit50, miss: skin.hit0 }[p.result];
          if (img) {
            // 按贴图固有尺寸 (1x osu 像素, @2x 减半 — stable 判定图小于圈), 上限圈径×1.2 防巨型皮肤图
            const h = Math.min(img.height / (skinScaleAdjust.get(img) ?? 1), rad * 2.4);
            const w = h * (img.width / img.height);
            g.drawImage(img, p.x - w / 2, py - h / 2, w, h);
          } else {
            g.fillStyle = RESULT_COLORS[p.result];
            g.font = `bold ${(rad * 0.85).toFixed(1)}px sans-serif`;
            g.fillText(RESULT_TEXT[p.result], p.x, py);
          }
          g.restore();
        }
      }
      __mark('popup', __ts); __ts = __perfOn ? performance.now() : 0; // v445

      if (!__skip?.trail) { // v445: profile 分阶段跳过 (拖尾 + 光标本体)
      // v416: 光标拖尾 (皮肤 cursortrail.png, 最近 ~120ms 轨迹渐缩渐隐, 按住更密/更不透明;
      //       皮肤缺失不画拖尾) — 先画拖尾再画光标本体
      const cur = cursorRef.current;
      updateTrail(trail, cur.x, cur.y, time, held);
      const trailImg = skin.cursortrail;
      if (trailImg) {
        // 拖尾基准尺寸: 固有尺寸 (@2x 减半), 上限圈径 — 与判定弹出同一取舍 (防巨型皮肤图)
        const tb = Math.min(trailImg.width / (skinScaleAdjust.get(trailImg) ?? 1), rad * 2);
        for (const p of trail) {
          const a = trailAlpha(p.t, time, held);
          if (a <= 0) continue;
          const d = tb * trailScale(p.t, time);
          g.save();
          g.globalAlpha = a;
          g.drawImage(trailImg, p.x - d / 2, p.y - d / 2, d, d);
          g.restore();
        }
      }
      // v416: 皮肤光标 (cursor.png, 居中; 尺寸取固有尺寸 (@2x 减半), 上限圈径 —
      //       与判定弹出同一量级取舍, 保持简单; 缺失回退白圈, 按住略缩)
      const cursorImg = skin.cursor;
      if (cursorImg) {
        const cd = Math.min(cursorImg.width / (skinScaleAdjust.get(cursorImg) ?? 1), rad * 2) * (held ? 1.15 : 1);
        g.drawImage(cursorImg, cur.x - cd / 2, cur.y - cd / 2, cd, cd);
      } else {
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(cur.x, cur.y, held ? 7 : 10, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      } // v445: trail 跳过块收尾
      __mark('trail', __ts); __ts = __perfOn ? performance.now() : 0; // v445
      g.restore();

      // HUD (布局 px 坐标): 左上血条, 右上分数/acc, 左下 combo
      if (!__skip?.hud) { // v445: profile 分阶段跳过
      g.setTransform(sx, 0, 0, sy, 0, 0);
      const sc = session.score;
      g.save();
      // v298: 血条 — 皮肤 scorebar-bg + scorebar-colour (按贴图固有宽高比, hp 裁剪填充), 缺失回退色条
      if (skin.scorebarBg && skin.scorebarColour) {
        const bh = 14 * scale;
        const bw = bh * (skin.scorebarBg.width / skin.scorebarBg.height);
        const by = oy - 20 * scale;
        g.drawImage(skin.scorebarBg, ox, by, bw, bh);
        g.save();
        g.beginPath(); g.rect(ox, by, bw * sc.hp, bh); g.clip();
        g.drawImage(skin.scorebarColour, ox, by, bw, bh);
        g.restore();
      } else {
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(ox, oy - 14, PW * scale, 8);
        g.fillStyle = sc.hp > 0.25 ? '#7fff7f' : '#ff5f5f';
        g.fillRect(ox, oy - 14, PW * scale * sc.hp, 8);
      }
      // v298: 皮肤数字 (score-0..9 / score-x / v300 score-percent/score-dot), 任一字形缺失整串回退文字
      // v445: slot = 缓存槽位 ('score'/'acc'/'combo') — 槽位复用位图, 内容变化才重绘
      const drawSkinNumber = (slot: string, text: string, x0: number, y0: number, h: number, alignRight: boolean): boolean => {
        const imgs: (SkinImage | null)[] = [];
        for (const ch of text) {
          if (ch >= '0' && ch <= '9') imgs.push(skin.scoreDigits[+ch]);
          else if (ch === 'x') imgs.push(skin.scoreX ?? null);
          else if (ch === '%') imgs.push(skin.scorePercent ?? null); // v300
          else if (ch === '.') imgs.push(skin.scoreDot ?? null); // v300
          else return false;
        }
        if (imgs.some(i => !i)) return false;
        // v445: 整串离屏缓存 — 命中时 1 次 blit (原逐字形上屏 ~19 次/帧)
        const key = [text, h.toFixed(2), sx.toFixed(4), sy.toFixed(4), getSkinContentSeq()].join('|');
        let e = hudNumSlots.get(slot);
        if (!e || e.key !== key) {
          const ws = imgs.map(i => h * (i!.width / i!.height));
          const w = ws.reduce((a, b) => a + b, 0);
          const bw = Math.max(1, Math.ceil(w * sx)), bh = Math.max(1, Math.ceil(h * sy));
          const dc = e?.c ?? document.createElement('canvas');
          if (dc.width !== bw || dc.height !== bh) { dc.width = bw; dc.height = bh; } // 重设尺寸即清空
          const dg = dc.getContext('2d')!;
          dg.setTransform(1, 0, 0, 1, 0, 0);
          dg.clearRect(0, 0, dc.width, dc.height);
          dg.setTransform(sx, 0, 0, sy, 0, 0); // 设备像素构建, 回贴 1:1 不糊
          let dx = 0;
          for (let i = 0; i < imgs.length; i++) { dg.drawImage(imgs[i]!, dx, 0, ws[i]!, h); dx += ws[i]!; }
          e = { key, c: dc, w };
          hudNumSlots.set(slot, e);
        }
        g.drawImage(e.c, alignRight ? x0 - e.w : x0, y0, e.w, h);
        return true;
      };
      if (!drawSkinNumber('score', String(sc.score).padStart(8, '0'), ox + PW * scale - 8, oy + 8 * scale, 22 * scale, true)) {
        g.textAlign = 'right'; g.textBaseline = 'alphabetic';
        g.fillStyle = '#fff';
        g.font = `bold ${Math.round(22 * scale)}px monospace`;
        g.fillText(String(sc.score).padStart(8, '0'), ox + PW * scale - 8, oy + 30 * scale);
      }
      // v300: acc 同样走皮肤数字 (score-percent/score-dot), 缺失回退文字
      if (!drawSkinNumber('acc', `${(sc.accuracy * 100).toFixed(2)}%`, ox + PW * scale - 8, oy + 36 * scale, 14 * scale, true)) {
        g.textAlign = 'right'; g.textBaseline = 'alphabetic';
        g.fillStyle = '#fff';
        g.font = `${Math.round(14 * scale)}px monospace`;
        g.fillText(`${(sc.accuracy * 100).toFixed(2)}%`, ox + PW * scale - 8, oy + 50 * scale);
      }
      // v421: combo 弹跳 (lazer ComboCounter pop) — combo 增加时瞬时 ~1.6x, 180ms 缓动回 1.0;
      //       归零/断连击不弹 (combo 减小不触发)
      if (sc.combo > prevCombo) comboPopAt = time;
      prevCombo = sc.combo;
      const popS = comboPopScale(time - comboPopAt);
      g.save();
      if (popS !== 1) { // 以 combo 左下锚点为中心缩放
        g.translate(ox + 8, oy + PH * scale - 10 * scale);
        g.scale(popS, popS);
        g.translate(-(ox + 8), -(oy + PH * scale - 10 * scale));
      }
      if (!drawSkinNumber('combo', `${sc.combo}x`, ox + 8, oy + PH * scale - 30 * scale, 20 * scale, false)) {
        g.textAlign = 'left';
        g.font = `bold ${Math.round(20 * scale)}px monospace`;
        g.fillText(`${sc.combo}x`, ox + 8, oy + PH * scale - 10);
      }
      g.restore();
      // v418: 底部歌曲进度条 (居中横向, 避开左下 combo; 细轨道 + 已播放高亮, 白色半透明)
      {
        const p = playProgress(time, session.firstTime, session.lastEnd);
        const bw = PW * scale * 0.6, bh = 3 * scale;
        const bx = ox + (PW * scale - bw) / 2, by = oy + PH * scale - 8 * scale;
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(bx, by, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(bx, by, bw * p, bh);
      }
      // v423: break 休息段提示 — 中央偏上: 血量 pass/fail 三角 (>50% 绿向上, 否则红向下;
      //       lazer break 末 pass/fail 箭头简化) + 「Break」字样 + 剩余秒数; 无 break 段不画
      const brk = breakAt(session.breaks, time);
      if (brk) {
        const bcx = ox + PW * scale / 2, bcy = oy + PH * scale * 0.26;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const up = sc.hp > 0.5;
        const asz = 10 * scale, ay = bcy - 34 * scale;
        g.fillStyle = up ? '#7fff7f' : '#ff5f5f';
        g.beginPath();
        if (up) { g.moveTo(bcx, ay - asz); g.lineTo(bcx - asz, ay + asz); g.lineTo(bcx + asz, ay + asz); }
        else { g.moveTo(bcx, ay + asz); g.lineTo(bcx - asz, ay - asz); g.lineTo(bcx + asz, ay - asz); }
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.font = `bold ${Math.round(22 * scale)}px sans-serif`;
        g.fillText(t('testplay.break', 'Break'), bcx, bcy);
        g.font = `${Math.round(16 * scale)}px monospace`;
        g.fillText(String(Math.ceil((brk.end - time) / 1000)), bcx, bcy + 26 * scale);
      }
      g.restore();
      } // v445: hud 跳过块收尾
      __mark('hud', __ts); __mark('frame', __t0); // v445
    };
    raf = requestAnimationFrame(loop);

    return () => {
      store.testPlayOpen = false; // v445: 恢复编辑器/时间轴渲染循环
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      store.rateAdjustPitch = prevPitch; // v295: 恢复进入前的变调模式
      store.setRate(prevRate); // v294: 恢复编辑器倍率
      if (!closed) { closed = true; store.pause(); store.seek(editorTime); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods]); // v294: 换 mod 重开会话

  return (
    <div className="fixed inset-0 z-[80] bg-black cursor-none" data-testid="testplay-overlay" // v416: 游玩时隐藏系统光标
      data-dialog="testplay" // v436: 游玩测试只读 — EditorCanvas window 捕获穿透链 (v431) 遇 data-dialog 直接放行,
      //   游玩中左/右键不再能选中/拖动物件与滑条锚点 (此前实测可拖节点); 击打输入由本覆盖层自处理不受影响
      onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="w-full h-full block cursor-none" /> {/* v416 */}
      {/* v294: mod 栏 (左上角; 切换即重开会话) */}
      <div className="absolute top-2 left-3 flex gap-1" data-mods-bar>
        {TEST_MODS.map(m => (
          <button
            key={m}
            className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer ${mods.includes(m)
              ? 'bg-[#e6437d] text-white'
              : 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white/80'}`}
            title={t(MOD_TITLE_KEYS[m][0], MOD_TITLE_KEYS[m][1])}
            data-testid={`testplay-mod-${m}`}
            onClick={() => setMods(prev => { const next = toggleMod(prev, m); saveTestMods(next); return next; })}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="absolute top-2 left-1/2 -translate-x-1/2 text-white/50 text-xs pointer-events-none select-none">
        {t('testplay.hint', 'Test Play · {hit1}/{hit2} to hit (mouse bindings included) · {exit} to return to editor', {
          hit1: formatCombo(effectiveBindings('test-hit-1')[0]),
          hit2: formatCombo(effectiveBindings('test-hit-2')[0]),
          exit: formatCombo(effectiveBindings('test-exit')[0]),
        })} {/* v289 */}
      </div>
      <button
        className="absolute top-2 right-3 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 text-xs cursor-pointer"
        data-testid="testplay-exit"
        onClick={() => exitRef.current()}
      >
        {t('testplay.exit', 'Exit (Esc)')}
      </button>
      {/* v419: 跳过按钮 (首物件前 >3s; 样式参照 mod 栏; data-skip-btn 防触发击打判定; v416 恢复 cursor) */}
      {showSkip && (
        <button
          className="absolute bottom-16 left-1/2 -translate-x-1/2 px-5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white/80 text-sm font-mono cursor-pointer"
          data-testid="testplay-skip"
          data-skip-btn
          onClick={() => store.seek(skipTarget(firstTimeRef.current))}
        >
          {t('testplay.skip', 'Skip')}
        </button>
      )}
    </div>
  );
}
