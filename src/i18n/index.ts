// v346: 多语言模块 (对齐 lazer osu.Framework.Localisation 架构)
//  - 调用点: t('namespace.snake_key', 'English default', vars?) — 符号键 + 内联英文原文 (回退兜底);
//  - 简体中文: src/i18n/zh-CN/ 分片词典 (zh-CN/index.ts 聚合), 缺失回退英文原文 (同 lazer);
//  - 繁體中文: src/i18n/zh-TW.ts 键级覆盖 → 否则对 zh-CN 译文做术语替换+逐字 s2t 转换;
//  - debug 语言 (?lang=debug 或 localStorage): 渲染 [[key]] 暴露未接入文案 (lazer debug locale);
//  - React: useT() (useSyncExternalStore 订阅); 非 React: tNow(); 切换语言全树自动刷新;
//  - 持久化 localStorage 'i18n.lang'; 默认 ?lang= > 存储 > navigator.language 探测 > 'en'
//   (v349: 默认链末位改英文; v349b: 应要求放回系统语言探测, 仅作回退, 不影响首启判定);
//  - v349: 首次启动 (无 ?lang= 且无存储) 由 LangFirstRun 浮层强制先选语言。
import { useSyncExternalStore } from 'react';
import { s2t, applyTwPhrases } from './s2t';
import { ZH_CN } from './zhCN';
import { ZH_TW } from './zhTW';

export type Lang = 'zh-CN' | 'zh-TW' | 'en' | 'debug';

export const LANGS: { id: Exclude<Lang, 'debug'>; name: string }[] = [
  { id: 'zh-CN', name: '简体中文' },
  { id: 'zh-TW', name: '繁體中文' },
  { id: 'en', name: 'English' },
];

const LS_KEY = 'i18n.lang';

function urlLang(): Lang | null {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('lang');
      if (q === 'debug' || LANGS.some(l => l.id === q)) return q as Lang;
    }
  } catch { /* 忽略 */ }
  return null;
}

function savedLang(): Lang | null {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (saved && (saved === 'debug' || LANGS.some(l => l.id === saved))) return saved as Lang;
  } catch { /* 隐私模式等忽略 */ }
  return null;
}

/** v349: 首次启动判定 — 无 ?lang= 且无持久化选择 (LangFirstRun 浮层用) */
export function isLangUnset(): boolean {
  return !urlLang() && !savedLang();
}

function detect(): Lang {
  const direct = urlLang() ?? savedLang();
  if (direct) return direct;
  // v349b: 系统语言探测放回存储之后、默认英文之前 (zh-Hant/TW/HK/MO → 繁體, zh → 简体, 其他 → en)
  const nav = typeof navigator !== 'undefined' ? (navigator.language || '').toLowerCase() : '';
  if (/^zh-(tw|hk|mo)|hant/.test(nav)) return 'zh-TW';
  if (nav.startsWith('zh')) return 'zh-CN';
  return 'en';
}

let lang: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang { return lang; }

export function setLang(l: Lang) {
  try { localStorage.setItem(LS_KEY, l); } catch { /* 忽略 */ }
  if (l === lang) return; // v349: 未变化也持久化 (首启默认 en 时选 English 需落盘, 否则下次还弹选择浮层)
  lang = l;
  listeners.forEach(f => f());
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

type Vars = Record<string, string | number>;

function interp(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

export function translate(l: Lang, key: string, enDefault: string, vars?: Vars): string {
  if (l === 'debug') return `[[${key}]]`;
  let s: string;
  if (l === 'en') s = enDefault;
  else if (l === 'zh-CN') s = ZH_CN[key] ?? enDefault;
  else {
    const cn = ZH_CN[key];
    s = ZH_TW[key] ?? (cn ? s2t(applyTwPhrases(cn)) : enDefault);
  }
  return interp(s, vars);
}

/** 非 React 环境 (store/electronMenu/工具模块); 语言在调用当下解析, 不订阅变更 */
export function tNow(key: string, enDefault: string, vars?: Vars): string {
  return translate(lang, key, enDefault, vars);
}

/** React 组件: const t = useT(); 之后 t('ns.key', 'Default') / t('ns.key', '{n} items', { n }) */
export function useT() {
  const l = useSyncExternalStore(onLangChange, getLang);
  return (key: string, enDefault: string, vars?: Vars) => translate(l, key, enDefault, vars);
}

// 测试挂钩 (verifier CDP 用)
if (typeof window !== 'undefined')
  (window as unknown as { __osuSetLang?: (l: Lang) => void }).__osuSetLang = setLang;
