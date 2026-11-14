// v524: DOM 控件布局适配器 — clone 原元素, 不改变父级 flex/grid 结构
import { Children, cloneElement, createContext, useContext, useEffect, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { UI_ICON_COMPONENTS } from '@/osu/uiIcons';
import { invalidateUiZoomRectCache } from '@/osu/uiZoom';
import { getUiLayout, getUiOverride, registerUiControls, useUiLayout, type UiControlDefinition, type UiIconState } from '@/osu/uiLayout';
import { getLang, useT } from '@/i18n';

interface ChildProps {
  style?: CSSProperties;
  className?: string;
  disabled?: boolean;
  fill?: string;
  [key: string]: unknown;
}

export function UiControl({ id, children }: { id: string; children: ReactElement<ChildProps> }) {
  useUiLayout();
  const child = Children.only(children);
  const o = getUiOverride(id), l = o.layout;
  useEffect(() => { invalidateUiZoomRectCache(); }, [l]);
  const style: CSSProperties = { ...child.props.style };
  if (l?.mode === 'absolute') {
    style.position = 'absolute';
    if (l.x !== undefined) style.left = l.x;
    if (l.y !== undefined) style.top = l.y;
  } else if (l && (l.offsetX !== undefined || l.offsetY !== undefined)) {
    style.transform = `${style.transform ? style.transform + ' ' : ''}translate(${l.offsetX ?? 0}px, ${l.offsetY ?? 0}px)`;
  }
  if (l?.width !== undefined) style.width = l.width;
  if (l?.height !== undefined) style.height = l.height;
  const disabled = o.enabled === false || child.props.disabled;
  const nativeDisabled = typeof child.type === 'string' && ['button', 'input', 'select', 'textarea'].includes(child.type);
  // v530: Btn 等自定义按钮也必须收到 disabled; 非原生容器再以 pointerEvents 兜底
  if (disabled && !nativeDisabled) style.pointerEvents = 'none';
  return cloneElement(child, {
    style,
    hidden: o.visible === false,
    'data-ui-id': id,
    ...(disabled ? { disabled: true, 'aria-disabled': true } : {}),
  });
}

export function UiIcon({ id, state = 'default', children }: {
  id: string;
  state?: UiIconState;
  children: ReactElement<ChildProps>;
}) {
  useUiLayout();
  const child = Children.only(children);
  const o = getUiOverride(id);
  const name = o.icons?.[state] ?? o.icons?.default;
  if (!name) return child;
  if (name.startsWith('lucide:')) {
    const Comp = UI_ICON_COMPONENTS[name.slice(7)];
    if (Comp) return <Comp {...child.props} />;
  }
  if (name.startsWith('asset:')) {
    const src = getUiLayout().assets?.[name.slice(6)];
    if (src) return <img {...child.props} src={src} alt="" />;
  }
  return child;
}

/** v524: 文本也需要自己订阅布局; 否则 UiControl 重渲只会复用父组件已生成的旧文本节点 */
export function UiText({ id, textKey = '', children, vars }: {
  id: string;
  textKey?: string;
  children: ReactNode;
  vars?: Record<string, string | number>;
}) {
  useUiLayout();
  const t = useT();
  const lang = getLang();
  const custom = lang === 'debug' ? undefined : getUiOverride(id).text?.[lang];
  if (custom) return vars ? custom.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : custom;
  // v530: 允许 JSX 文本与 {'{n}'} 片段混写, 统一还原为 i18n 英文模板
  const fallback = Children.toArray(children).join('');
  return t(textKey, fallback, vars);
}

// v532: 动态窗口作用域 — 同一 DraftNum testid 在不同窗口中仍是不同永久控件
const UiScopeContext = createContext('ui');
export function UiScope({ id, children }: { id: string; children: ReactNode }) {
  return <UiScopeContext.Provider value={id}>{children}</UiScopeContext.Provider>;
}
export function UiAutoControl({ localId, kind = 'input', defaultTextKey, defaultIcon, children }: {
  localId: string; kind?: UiControlDefinition['kind']; defaultTextKey?: string; defaultIcon?: string;
  children: ReactElement<ChildProps>;
}) {
  const id = `${useContext(UiScopeContext)}.${localId}`;
  useEffect(() => { registerUiControls([{ id, kind, defaultTextKey, defaultIcon }]); }, [id, kind, defaultTextKey, defaultIcon]);
  return <UiControl id={id}>{children}</UiControl>;
}
export function UiAutoText({ localId, textKey = '', children, vars }: {
  localId: string; textKey?: string; children: ReactNode; vars?: Record<string, string | number>;
}) {
  const id = `${useContext(UiScopeContext)}.${localId}`;
  return <UiText id={id} textKey={textKey} vars={vars}>{children}</UiText>;
}
export function UiAutoIcon({ localId, state, children }: {
  localId: string; state?: UiIconState; children: ReactElement<ChildProps>;
}) {
  const id = `${useContext(UiScopeContext)}.${localId}`;
  return <UiIcon id={id} state={state}>{children}</UiIcon>;
}
