// v381: 全局枚举下拉框滚轮循环 — 悬停 <select> 上滚/下滚切换选项, 滚过末尾循环回开头 (反向亦然)
// 统一实现: window 捕获阶段一个监听覆盖全部枚举框 (节拍细分/网格类型/语言/音效集/皮肤样式/转换弹窗等),
// 不逐个组件加 onWheel。改键捕获态 (hotkey 面板按新键) 时让位给滚轮捕获。
import { hotkeyCaptureActive } from './hotkeys';

function cycleSelect(el: HTMLSelectElement, dir: 1 | -1) {
  const n = el.options.length;
  if (n < 2) return;
  // 跳过 disabled 选项; 全部 disabled 不动
  const enabled: number[] = [];
  for (let i = 0; i < n; i++) if (!el.options[i].disabled) enabled.push(i);
  if (enabled.length < 2) return;
  const cur = enabled.indexOf(el.selectedIndex);
  const next = enabled[(cur < 0 ? 0 : cur + dir + enabled.length) % enabled.length]; // 取模 = 首尾循环
  const opt = el.options[next];
  // React 受控组件: 必须用原生 setter 绕过 React 的 value tracker, 再派生 change, onChange 才会触发
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(el, opt.value); else el.value = opt.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 安装全局监听 (App 挂载一次); 返回清理函数 */
export function installSelectWheelCycle(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (hotkeyCaptureActive()) return; // 改键捕获中: 滚轮用于录入绑定, 不调枚举
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.disabled || t.multiple || t.size > 1) return; // 列表框/多选不循环
    e.preventDefault(); // 阻止面板滚动 (悬停调值语义, 与 DraftNum 滚轮同款)
    cycleSelect(t, e.deltaY > 0 ? 1 : -1);
  };
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => window.removeEventListener('wheel', onWheel, { capture: true });
}
