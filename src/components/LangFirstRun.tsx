// v349: 首次启动语言选择 — 无任何语言偏好 (无 ?lang= 且无 localStorage 'i18n.lang') 时
//   悬浮于所有控件之上 (z 最高, 盖 FirstRunWizard/曲库等), 选后持久化, 之后启动不再出现;
//   标题三语并列 (translate 强制各语言渲染同一 key, 不依赖当前语言); 默认语言为英文 (见 i18n detect)
import { useEffect, useState } from 'react';
import { LANGS, isLangUnset, onLangChange, setLang, translate, type Lang } from '@/i18n';

const TITLE_KEY = 'app.lang_first_title';
const TITLE_EN = 'Choose your language';

export function LangFirstRun() {
  const [show, setShow] = useState(isLangUnset);
  // 外部途径改语言 (LangSwitcher/verifier __osuSetLang) 也关闭浮层
  useEffect(() => onLangChange(() => setShow(false)), []);
  if (!show) return null;
  const pick = (id: Lang) => { setLang(id); setShow(false); };
  return (
    <div data-lang-first-run className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
      <div className="bg-[#1b1b24] border border-white/15 rounded-lg px-8 py-6 flex flex-col items-center gap-5 shadow-xl">
        <div className="text-sm text-slate-200 text-center leading-relaxed">
          <div>{translate('zh-CN', TITLE_KEY, TITLE_EN)}</div>
          <div>{translate('zh-TW', TITLE_KEY, TITLE_EN)}</div>
          <div>{translate('en', TITLE_KEY, TITLE_EN)}</div>
        </div>
        <div className="flex gap-3">
          {LANGS.map(l => (
            <button key={l.id} data-lang-pick={l.id} onClick={() => pick(l.id)}
              className="px-4 py-2 rounded bg-white/10 hover:bg-white/25 border border-white/15 text-sm transition-colors cursor-pointer">
              {l.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
