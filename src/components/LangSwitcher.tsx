// v346: 语言切换器 — 页签栏右侧下拉 (简体中文/繁體中文/English; 持久化 localStorage)
import { Globe } from 'lucide-react';
import type { CSSProperties } from 'react';
import { LANGS, getLang, setLang, useT, type Lang } from '@/i18n';

export function LangSwitcher() {
  const t = useT();
  return (
    <label
      data-lang-switcher
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      className="self-center flex items-center gap-1 px-2 py-1 rounded text-sm bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
      title={t('app.langSwitcherTitle', 'Interface language')}>
      <Globe className="inline-block w-4 h-4" />
      <select
        className="bg-transparent outline-none cursor-pointer [&>option]:bg-[#16161d]"
        value={getLang()}
        onChange={e => setLang(e.target.value as Lang)}>
        {LANGS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}
