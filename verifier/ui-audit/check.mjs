// 验证器 v430: 界面不可用控件/按钮换行检测 (常驻 UI 审计)
// 两种窗口尺寸 (2560×1440 = zoom 1 档 / 1280×720 = zoom 0.6 下限档) × 两种语言 (en/zh-CN, v432) 下遍历 DOM:
//   - 按钮换行: button/[role=button] 文本渲染多行 (Range.getClientRects 行顶去重) → 违规;
//     nowrap 按钮横向溢出 (scrollWidth > clientWidth+1) → 违规;
//   - 不可用控件: button/input/select 可见但视觉尺寸过小 (高 <14 或宽 <20; checkbox/radio 原生小控件豁免),
//     或被 overflow:hidden 祖先裁剪 (getBoundingClientRect 超出裁剪框) → 违规; disabled 不算违规。
//   - v432: 数字框内容被裁 (num-clip: type=number 且 scrollWidth > clientWidth+1 — 值不可读;
//     文本框横向滚动是设计行为不查); 左/右栏容器横向滚动 (col-hscroll: 栏 scrollWidth > clientWidth+1,
//     栏内横向溢出原被 clippedBy 的「滚动可达」豁免漏掉 — v432 左栏 Rotation 输入溢出即此洞)。
// 每种尺寸跑两遍选区态: 全选 (多选 Inspector 分支) + 单选首条滑条 (单选分支), 覆盖右栏全部按钮。
// 白名单: 范围外 (菜单条/页签/弹窗内等) 或原生控件设计尺寸的遗留项, 逐条注明原因 — 打印但不失败。
// 运行: npm run build 后 node verifier/ui-audit/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9499;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 白名单 (范围外遗留: 记录但可不改; 每条注明原因) — match: path/text 子串, kind 可选
const WHITELIST = [
  // v430 首跑发现, 均在 1280×720 (0.6 档) 且非左/右栏范围, 遗留待单独版本:
  { path: 'data-wave=', kind: 'tiny', reason: '上时间轴波形切換/关闭按钮 0.6 档视觉 9.6px (紧凑设计)' },
  { path: 'data-tp-add', kind: 'tiny', reason: '上时间轴 timing +Red/+Green 按钮 0.6 档视觉 9.6px (同上)' },
  { text: '+', kind: 'tiny', reason: '上时间轴缩放 +/- 按钮 0.6 档视觉 9.6px (同上)' },
  { text: '−', kind: 'tiny', reason: '上时间轴缩放 +/- 按钮 0.6 档视觉 9.6px (同上)' },
  { path: 'data-speed-input', kind: 'clipped', reason: '底栏速度按钮 1280×720 下控制行横向超宽被裁 (底栏非左/右栏)' },
  { path: 'data-testplay-btn', kind: 'clipped', reason: '底栏 Test Play 按钮同上 (底栏非左/右栏)' },
];

const AUDIT_JS = `(() => {
  const violations = [];
  const textOf = (el) => ((el.innerText || el.value || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      let p = cur.tagName.toLowerCase();
      const da = [...(cur.attributes || [])].find(a => a.name.startsWith('data-'));
      if (cur.id) p += '#' + cur.id;
      else if (da) p += '[' + da.name + (da.value ? '=' + da.value : '') + ']';
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const isHidden = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };
  const lineCount = (el) => {
    const range = document.createRange();
    const tops = [];
    // 容差 = max(8, 0.7×字号): 同行为 baseline 对齐的混合字号文本 (text-lg+text-xs 页签/工具钮)
    // 顶边只差几个 px 不算换行; 真换行行距 ≥1 倍字号必然超容差
    const tol = Math.max(8, parseFloat(getComputedStyle(el).fontSize) * 0.7);
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (!n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.height < 1) continue;
        if (!tops.some(t => Math.abs(t - r.top) < tol)) tops.push(r.top);
      }
    }
    return tops.length;
  };
  const clippedBy = (el, r) => {
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      // 最近滚动容器 (auto/scroll): 内容滚动可达, 不算裁切, 停止上溯
      // (右栏 overflow-auto 长内容滚出可视区的按钮是可达的, 不为违规)
      if (['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)) return null;
      if (['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflowY)) {
        const cr = cur.getBoundingClientRect();
        if (r.left < cr.left - 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.bottom > cr.bottom + 1)
          return pathOf(cur) + ' [容器 ' + cr.left.toFixed(0) + ',' + cr.top.toFixed(0) + ' ' + cr.width.toFixed(0) + 'x' + cr.height.toFixed(0) + ' | 元素 ' + r.left.toFixed(0) + ',' + r.top.toFixed(0) + ' ' + r.width.toFixed(0) + 'x' + r.height.toFixed(0) + ']';
      }
      cur = cur.parentElement;
    }
    return null;
  };
  // 按钮换行 / 横向溢出
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (el.disabled || isHidden(el)) continue;
    const r = el.getBoundingClientRect();
    const lines = lineCount(el);
    if (lines > 1) violations.push({ kind: 'wrap', path: pathOf(el), text: textOf(el), size: r.width.toFixed(0) + 'x' + r.height.toFixed(0), lines });
    else if (el.scrollWidth > el.clientWidth + 1) violations.push({ kind: 'h-overflow', path: pathOf(el), text: textOf(el), size: r.width.toFixed(0) + 'x' + r.height.toFixed(0), scroll: el.scrollWidth + '>' + el.clientWidth });
  }
  // 控件尺寸 / 裁剪
  for (const el of document.querySelectorAll('button, input, select')) {
    if (el.disabled || isHidden(el)) continue;
    if (el.type === 'checkbox' || el.type === 'radio') continue; // 原生小控件, 设计如此
    const r = el.getBoundingClientRect();
    if (r.height < 14 || r.width < 20) violations.push({ kind: 'tiny', path: pathOf(el), text: textOf(el), size: r.width.toFixed(1) + 'x' + r.height.toFixed(1) });
    const clip = clippedBy(el, r);
    if (clip) violations.push({ kind: 'clipped', path: pathOf(el), text: textOf(el), size: r.width.toFixed(0) + 'x' + r.height.toFixed(0), by: clip });
    // v432: 数字框内容被裁 (值不可读 = 真 bug; 文本框横向滚动是设计行为, 不查) — v432 用户反馈
    //   'Zoom 1.00I' 即此类: input 太窄裁掉尾位。阈值 +3: Chromium number input 的 scrollWidth
    //   固有比 clientWidth 大 ~2 (spin button 内部占位), 167px 宽框显示 '90' 也报 +2 — 滤掉固有差
    if (el.type === 'number' && el.scrollWidth > el.clientWidth + 3)
      violations.push({ kind: 'num-clip', path: pathOf(el), text: textOf(el), size: r.width.toFixed(0) + 'x' + r.height.toFixed(0), scroll: el.scrollWidth + '>' + el.clientWidth });
  }
  // v432: 左/右栏容器横向滚动 = bug (任何一行超出栏宽; 栏内 clippedBy 对滚动容器豁免,
  //   横向溢出会被「滚动可达」逻辑漏掉 — v432 左栏 Rotation 输入溢出到栏外正是此洞)
  for (const col of document.querySelectorAll('[data-ui-interactive]')) {
    const cr = col.getBoundingClientRect();
    const isSide = cr.height > window.innerHeight * 0.5 && cr.width > 100 && cr.width < 500
      && (cr.left <= 2 || cr.right >= window.innerWidth - 2);
    if (!isSide || col.scrollWidth <= col.clientWidth + 1) continue;
    // 找直接子行里最超出者作诊断 (行本身或其内容超出栏右缘)
    let worst = '';
    for (const row of col.querySelectorAll(':scope > *')) {
      const rr = row.getBoundingClientRect();
      const over = Math.max(rr.right - cr.right, row.scrollWidth - row.clientWidth);
      if (over > 1) { worst = ' [最超出行 ' + (row.className + '').slice(0, 40) + ' 超 ' + over.toFixed(0) + 'px]'; break; }
    }
    violations.push({ kind: 'col-hscroll', path: pathOf(col), text: '', size: cr.width.toFixed(0) + 'x' + cr.height.toFixed(0), scroll: col.scrollWidth + '>' + col.clientWidth + worst });
  }
  return violations;
})()`;

const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
let failures = 0;
const seen = new Set();
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('找不到 Electron 页面目标');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  await normalizeEnv(evalJs);

  // 视口尺寸: Emulation.setDeviceMetricsOverride — Browser.setWindowBounds 对启动最大化的窗口
  // 不生效 (实测内尺寸不变); override 直接改 innerWidth/innerHeight, 触发 resize → useUiZoom 重算
  const setSize = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(900); // resize → useUiZoom 重渲染
  };

  // v432: 双语遍历 — normalizeEnv 归一为 en, 但溢出类 bug 与文案宽度强相关
  //   ('Spacing'/'Rotation' 英文比中文宽很多; v432 左栏溢出只在英文下出现), zh/en 都要跑
  for (const lang of ['en', 'zh-CN']) {
    await evalJs(`window.__osuSetLang && window.__osuSetLang('${lang}')`);
    await sleep(700); // 语言切换全树重渲染
    console.log(`== 语言 ${lang}`);
    for (const [w, h] of [[2560, 1440], [1280, 720]]) {
      await setSize(w, h);
      const dims = await evalJs('({ iw: window.innerWidth, ih: window.innerHeight })');
      console.log(`== ${w}×${h} (内尺寸 ${dims.iw}×${dims.ih})`);
      // 两种选区态: 全选 (多选分支) / 单选首条滑条 (单选分支)
      for (const selMode of ['all', 'slider']) {
        await evalJs(`(() => {
        const store = window.__osuStore;
        const objs = store.beatmap.hitObjects;
        if ('${selMode}' === 'all') store.select(objs.map(o => o.id));
        else { const s = objs.find(o => o.type === 'slider') ?? objs[0]; store.select(s ? [s.id] : []); }
      })()`);
        await sleep(400);
        const violations = await evalJs(AUDIT_JS);
        const fresh = violations.filter(v => {
          const key = `${lang}|${w}x${h}|${v.kind}|${v.path}|${v.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        for (const v of fresh) {
          const wl = WHITELIST.find(x => (v.path.includes(x.path ?? '￿') || v.text.includes(x.text ?? '￿')) && (!x.kind || x.kind === v.kind));
          const line = `  [${v.kind}] ${v.path} | "${v.text}" | ${v.size}${v.lines ? ` | ${v.lines} 行` : ''}${v.scroll ? ' | scroll ' + v.scroll : ''}${v.by ? ' | 裁剪自 ' + v.by : ''} (${selMode} 选区)`;
          if (wl) console.log(line + `  — 白名单: ${wl.reason}`);
          else { failures++; console.error(line); }
        }
      }
    }
  }
  ws.close();
} catch (e) {
  failures++;
  console.error('  FAIL: 审计异常 —', String(e).slice(0, 400));
} finally {
  await killIsolated(electron, profile);
}
console.log(failures ? `\nUI_AUDIT_FAILED: ${failures} 处违规` : '\nUI_AUDIT_CLEAN');
process.exit(failures ? 1 : 0);
