// v388: 全局数值框滚轮调值 — 指针悬停在任意 input[type=number] 上时滚轮直接改数值,
// 并阻止背景/侧栏滚动 (soulten 反馈: 右侧栏数值框上滚轮滚的是面板, 无法连续调值)。
// 统一实现: window 一个监听覆盖全部数值框 (Inspector/设置页/Timing 窗口/各转换弹窗等), 不逐个组件加 onWheel。
// 与 selectWheel.ts (v381 枚举框) 同款模式; 挂在冒泡阶段 (非捕获), DraftNum (v304) 自带的元素级滚轮
// 处理先执行并 preventDefault, 这里检查 e.defaultPrevented 跳过, 不会重复加减。
import { hotkeyCaptureActive } from './hotkeys';

/** 解析 step 属性: 缺省/非法/'any' → 1 */
function stepOf(el: HTMLInputElement): number {
  const s = parseFloat(el.step);
  return isNaN(s) || s <= 0 ? 1 : s;
}

/** 按 step 的小数位取整, 避免 0.1 步进累出 0.30000000004 (与 DraftNum 同款) */
function roundByStep(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

/** 安装全局监听 (App 挂载一次); 返回清理函数 */
export function installNumberWheel(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented) return; // DraftNum 等已有更具体的处理
    if (hotkeyCaptureActive()) return; // 改键捕获中: 滚轮用于录入绑定, 不调值
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'number') return;
    if (t.disabled || t.readOnly) return;
    e.preventDefault(); // 阻止页面/侧栏滚动 (悬停调值语义)
    const step = stepOf(t);
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; // 与 DraftNum 拖动/滚轮调值同款倍率
    const cur = parseFloat(t.value);
    let v = (isNaN(cur) ? 0 : cur) + (e.deltaY < 0 ? 1 : -1) * step * mult;
    v = roundByStep(v, step);
    const min = parseFloat(t.min), max = parseFloat(t.max);
    if (!isNaN(min)) v = Math.max(min, v);
    if (!isNaN(max)) v = Math.min(max, v);
    // React 受控组件: 必须用原生 setter 绕过 React 的 value tracker, 再派生 input, onChange 才会触发
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(t, String(v)); else t.value = String(v);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => window.removeEventListener('wheel', onWheel);
}
