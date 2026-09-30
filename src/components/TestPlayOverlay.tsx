// v287: 测试游玩覆盖层 — 参考 lazer EditorPlayer (osu.Game/Screens/Edit/GameplayTest/EditorPlayer.cs)
//  - 进入: 暂停编辑器 → 从 editorTime-3s (TESTPLAY_LEAD_BACK) 起播 (editorTime 前物件满分预填, 见 TestPlaySession);
//  - 游玩: 鼠标瞄准 + Z/X/鼠标左键击打; 300/100/50/Miss 判定 + combo/分数/acc/血条 (不失败);
//  - 退出: Esc 或谱面结束+1.5s → 暂停并 seek 回 editorTime (lazer quickExit(false) 语义);
//  - 渲染复用 renderPlayfield (rc.gameplay 分支), hitsound/节拍器由 store.play() 现成调度。
// v294: Mod 支持 (左上角 mod 栏, 切换即重开会话, localStorage 持久化):
//   EZ/HR 调 difficulty (lazer 比率, HR 垂直翻转), HT/DT 调 store.playbackRate (退出恢复),
//   RX 免按键自动击打, AP 光标自动, AT=RX+AP; 互斥规则见 gameplay/mods.ts。
import { useEffect, useRef, useState } from 'react';
import { store } from '@/osu/store';
import { getSkin, skinScaleAdjust, type SkinImage } from '@/osu/skin';
import { computeCombos, renderPlayfield } from '@/osu/renderer';
import { computeStackOffsets } from '@/osu/stacking';
import { TestPlaySession } from '@/osu/gameplay/testPlaySession';
import type { MainResult } from '@/osu/gameplay/judgement';
import {
  TEST_MODS, adjustDifficulty, applyHardRockFlip, clockRate, isAutopilot, isRelax,
  loadTestMods, saveTestMods, toggleMod, type TestModId,
} from '@/osu/gameplay/mods'; // v294
import { matchesHotkey, matchesHotkeyMouse, effectiveBindings, formatCombo } from '@/osu/hotkeys'; // v288/v289: 击打键走快捷键注册表 (键盘+鼠标可改键)
import { zoomRect, zoomClientX, zoomClientY, fitCanvas } from '@/osu/uiZoom';
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
const RESULT_COLORS: Record<MainResult, string> = { great: '#ffffff', ok: '#7fff7f', meh: '#5f9fff', miss: '#ff5f5f' };
const RESULT_TEXT: Record<MainResult, string> = { great: '300', ok: '100', meh: '50', miss: 'MISS' };
const POPUP_LIFE = 600;

export function TestPlayOverlay({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef({ x: PW / 2, y: PH / 2 });
  const heldRef = useRef({ mouse: 0, keys: 0 }); // v288/v289: 击打键计数 (多键同时按住不互相清)
  const exitRef = useRef<() => void>(() => {});
  const [mods, setMods] = useState<TestModId[]>(loadTestMods); // v294
  const editorTimeRef = useRef<number | null>(null); // v294: 初次进入时的编辑器时间 (换 mod 重开不变)

  useEffect(() => {
    const bm0 = store.beatmap;
    const c = canvasRef.current;
    if (!bm0 || !c) { onClose(); return; }
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
      if ((e.target as HTMLElement).closest?.('[data-mods-bar]')) return; // v294: 点 mod 栏不触发击打
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
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (closed) return;
      const time = store.positionMs();
      // v294: Autopilot — 滑条跟球 / 跳向下一物件 (在 update 前取)
      if (autopilot) cursorRef.current = session.autoCursorPos(time) ?? cursorRef.current;
      const held = heldRef.current.mouse > 0 || heldRef.current.keys > 0;
      session.update(time, cursorRef.current, held, relax);
      if (time > session.lastEnd + 1500) { exit(); return; } // lazer: 完成后延迟退出, 直接返回编辑器

      const r = zoomRect(c);
      const { sx, sy } = fitCanvas(c, r);
      g.setTransform(sx, 0, 0, sy, 0, 0);
      g.fillStyle = '#000';
      g.fillRect(0, 0, r.width, r.height);
      const { scale, ox, oy } = viewTransform(r); // v300: 与编辑器同一适配变换 (游玩区大小一致)
      g.save();
      g.translate(ox, oy);
      g.scale(scale, scale);
      renderPlayfield({
        g, bm, skin, time, selected: new Set(), cacheKey: String(store.getVersion()),
        comboInfo, stackOffsets, gameplay: session.renderInfo(),
      });

      // 判定弹出 (v298: 皮肤 hit300/hit100/hit50/hit0 贴图优先, 缺失回退文字; 上浮渐隐)
      const rad = session.radius;
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

      // 光标 (白圈, 按住略缩)
      const cur = cursorRef.current;
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(cur.x, cur.y, held ? 7 : 10, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      g.restore();

      // HUD (布局 px 坐标): 左上血条, 右上分数/acc, 左下 combo
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
      const drawSkinNumber = (text: string, x0: number, y0: number, h: number, alignRight: boolean): boolean => {
        const imgs: (SkinImage | null)[] = [];
        for (const ch of text) {
          if (ch >= '0' && ch <= '9') imgs.push(skin.scoreDigits[+ch]);
          else if (ch === 'x') imgs.push(skin.scoreX ?? null);
          else if (ch === '%') imgs.push(skin.scorePercent ?? null); // v300
          else if (ch === '.') imgs.push(skin.scoreDot ?? null); // v300
          else return false;
        }
        if (imgs.some(i => !i)) return false;
        const ws = imgs.map(i => h * (i!.width / i!.height));
        let x = alignRight ? x0 - ws.reduce((a, b) => a + b, 0) : x0;
        for (let i = 0; i < imgs.length; i++) { g.drawImage(imgs[i]!, x, y0, ws[i]!, h); x += ws[i]!; }
        return true;
      };
      if (!drawSkinNumber(String(sc.score).padStart(8, '0'), ox + PW * scale - 8, oy + 8 * scale, 22 * scale, true)) {
        g.textAlign = 'right'; g.textBaseline = 'alphabetic';
        g.fillStyle = '#fff';
        g.font = `bold ${Math.round(22 * scale)}px monospace`;
        g.fillText(String(sc.score).padStart(8, '0'), ox + PW * scale - 8, oy + 30 * scale);
      }
      // v300: acc 同样走皮肤数字 (score-percent/score-dot), 缺失回退文字
      if (!drawSkinNumber(`${(sc.accuracy * 100).toFixed(2)}%`, ox + PW * scale - 8, oy + 36 * scale, 14 * scale, true)) {
        g.textAlign = 'right'; g.textBaseline = 'alphabetic';
        g.fillStyle = '#fff';
        g.font = `${Math.round(14 * scale)}px monospace`;
        g.fillText(`${(sc.accuracy * 100).toFixed(2)}%`, ox + PW * scale - 8, oy + 50 * scale);
      }
      if (!drawSkinNumber(`${sc.combo}x`, ox + 8, oy + PH * scale - 30 * scale, 20 * scale, false)) {
        g.textAlign = 'left';
        g.font = `bold ${Math.round(20 * scale)}px monospace`;
        g.fillText(`${sc.combo}x`, ox + 8, oy + PH * scale - 10);
      }
      g.restore();
    };
    raf = requestAnimationFrame(loop);

    return () => {
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
    <div className="fixed inset-0 z-[80] bg-black" data-testid="testplay-overlay"
      onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* v294: mod 栏 (左上角; 切换即重开会话) */}
      <div className="absolute top-2 left-3 flex gap-1" data-mods-bar>
        {TEST_MODS.map(m => (
          <button
            key={m}
            className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer ${mods.includes(m)
              ? 'bg-[#e6437d] text-white'
              : 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white/80'}`}
            title={{ EZ: 'Easy: 难度全项减半', HR: 'HardRock: ×1.4 (CS×1.3) + 垂直翻转', HT: 'HalfTime: 0.75x', DT: 'DoubleTime: 1.5x', RX: 'Relax: 免按键', AP: 'Autopilot: 免瞄准', AT: 'Autoplay: 全自动' }[m]}
            data-testid={`testplay-mod-${m}`}
            onClick={() => setMods(prev => { const next = toggleMod(prev, m); saveTestMods(next); return next; })}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="absolute top-2 left-1/2 -translate-x-1/2 text-white/50 text-xs pointer-events-none select-none">
        测试游玩 · {formatCombo(effectiveBindings('test-hit-1')[0])}/{formatCombo(effectiveBindings('test-hit-2')[0])} 击打 (含鼠标绑定) · {formatCombo(effectiveBindings('test-exit')[0])} 返回编辑器 {/* v289 */}
      </div>
      <button
        className="absolute top-2 right-3 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 text-xs cursor-pointer"
        data-testid="testplay-exit"
        onClick={() => exitRef.current()}
      >
        退出 (Esc)
      </button>
    </div>
  );
}
