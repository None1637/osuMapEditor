// v425: 右栏 (Inspector) 统一轻量按钮组件 — 替代 v146 模块级 Btn / 转换区 cls / 删除按钮三处手写样式
// 不用闲置的 shadcn ui/button (亮色 HSL token 与深色 UI 不搭); variant:
//   normal  — 常规操作 (原 bg-white/10 系)
//   primary — 主确认 (仿转换弹窗主按钮: bg-pink-500 hover:bg-pink-400 font-bold, 弹窗同款为白字)
//   danger  — 仅破坏性操作 (删除)
// 统一 h-7 与 NumIn 输入框等高; inline-flex + gap-1 使图标+文本居中对齐; whitespace-nowrap 抗挤压换行
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type BtnVariant = 'normal' | 'primary' | 'danger';

const VARIANT_CLS: Record<BtnVariant, string> = {
  normal: 'bg-white/10 hover:bg-white/20 border border-white/15',
  primary: 'bg-pink-500 hover:bg-pink-400 border border-pink-400/60 text-white font-bold',
  danger: 'bg-red-500/30 hover:bg-red-500/50 border border-red-400/40 text-red-200',
};

export const Btn = ({ variant = 'normal', className = '', children, ...rest }: {
  variant?: BtnVariant;
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...rest}
    className={`h-7 px-2 rounded text-[11px] inline-flex items-center justify-center gap-1 whitespace-nowrap select-none disabled:opacity-40 ${VARIANT_CLS[variant]} ${className}`}>
    {children}
  </button>
);
