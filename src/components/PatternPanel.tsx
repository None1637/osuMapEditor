// v86: Pattern 库面板 — 分类侧栏 + 缩略图网格; 缩略图可拖到游玩区落盘, 拖到分类标签移动分类
import { useEffect, useRef, useState } from 'react';
import { Star, X } from 'lucide-react'; // v181: ★/✕ → lucide
import { store, useEditor } from '@/osu/store';
import { DraggableDialog } from './DraggableDialog';
import { DEFAULT_GROUP, type StoredPattern } from '@/osu/patternLibrary';
import { renderPatternThumbnail } from './patternThumb';
import { getSkin } from '@/osu/skin';
import { useT } from '@/i18n';

function Thumb({ pattern }: { pattern: StoredPattern }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEditor(); // 皮肤加载/谱面切换后重绘
  useEffect(() => {
    const c = ref.current;
    if (c && store.beatmap) renderPatternThumbnail(c, pattern, store.beatmap, getSkin());
  });
  return <canvas ref={ref} width={90} height={90} className="rounded bg-black block" />;
}

export function PatternPanel() {
  useEditor();
  const t = useT();
  const [group, setGroup] = useState(DEFAULT_GROUP);
  const [collectName, setCollectName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const groups = store.allPatternGroups();
  const patterns = store.patterns.filter(p => p.group === group);
  const align = store.patternAlign;

  // 分类名是持久化数据, 仅默认分类在显示时翻译
  const groupLabel = (gn: string) => (gn === DEFAULT_GROUP ? t('pattern.ungrouped', 'Ungrouped') : gn);

  const alignBox = (v: 'greenline' | 'scale', label: string, title: string) => (
    <label className="flex items-center gap-1 cursor-pointer select-none" title={title}>
      <input type="checkbox" checked={align === v} data-pattern-align={v}
        onChange={() => store.setPatternAlign(align === v ? 'none' : v)} />
      {label}
    </label>
  );

  return (
    <DraggableDialog title={t('pattern.library', 'Pattern Library')} testid="pattern-panel" width={580} onClose={() => store.setPatternPanelOpen(false)}>
      <div className="space-y-2.5">
        {/* 收藏 + 对齐选项 */}
        <div className="flex items-center gap-2">
          <input value={collectName} onChange={e => setCollectName(e.target.value)} placeholder={t('pattern.name_placeholder', 'Pattern name')}
            data-pattern-input="collect-name"
            className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded px-1.5 py-0.5 text-white" />
          <button disabled={!store.selected.size}
            onClick={() => { store.addPatternFromSelection(collectName.trim(), group); setCollectName(''); }}
            data-pattern-input="collect"
            className="px-2 py-0.5 rounded bg-sky-600/70 hover:bg-sky-500/70 disabled:opacity-30 shrink-0">
            <Star className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5 fill-current" />{t('pattern.bookmark_selected', 'Bookmark Selected ({n})', { n: store.selected.size })}
          </button>
        </div>
        <div className="flex items-center gap-3 text-white/70">
          {alignBox('greenline', t('pattern.align_greenline', 'Inherited Point Align'), t('pattern.align_greenline_hint', 'Insert an inherited timing point at the start of the pattern to change SV to match the speed when bookmarked, and one at the end to restore SV'))}
          {alignBox('scale', t('pattern.align_scale', 'Scale Slider Align'), t('pattern.align_scale_hint', 'Geometrically scale sliders so a slider that occupied one beat when bookmarked still occupies one beat after being dragged out'))}
        </div>
        <div className="flex gap-2.5">
          {/* 分类侧栏 */}
          <div className="w-24 shrink-0 space-y-1">
            {groups.map(gn => (
              <div key={gn} onClick={() => { setGroup(gn); setRenaming(false); }}
                data-pattern-group={gn}
                className={`px-1.5 py-1 rounded cursor-pointer truncate ${group === gn ? 'bg-sky-600/50 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                title={groupLabel(gn)}>
                {groupLabel(gn)} <span className="text-white/35">{store.patterns.filter(p => p.group === gn).length}</span>
              </div>
            ))}
            <div className="flex gap-1 pt-1">
              <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder={t('pattern.new_group_placeholder', 'New group')}
                data-pattern-input="new-group"
                className="w-full min-w-0 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white text-[11px]" />
              <button onClick={() => { store.addPatternGroup(newGroup); setNewGroup(''); }}
                data-pattern-input="add-group"
                className="px-1.5 rounded bg-white/10 hover:bg-white/20 shrink-0">+</button>
            </div>
            {group !== DEFAULT_GROUP && (
              <div className="flex gap-1">
                <button onClick={() => { setRenaming(!renaming); setRenameText(group); }}
                  data-pattern-input="rename-group"
                  className="flex-1 px-1 rounded bg-white/10 hover:bg-white/20">{t('pattern.rename', 'Rename')}</button>
                <button onClick={() => { store.deletePatternGroup(group); setGroup(DEFAULT_GROUP); }}
                  data-pattern-input="delete-group"
                  className="flex-1 px-1 rounded bg-red-500/30 hover:bg-red-500/50">{t('pattern.delete', 'Delete')}</button>
              </div>
            )}
            {renaming && (
              <input value={renameText} onChange={e => setRenameText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { store.renamePatternGroup(group, renameText); setGroup(renameText.trim() || group); setRenaming(false); } }}
                data-pattern-input="rename-group-name" autoFocus
                className="w-full bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white text-[11px]" />
            )}
          </div>
          {/* 缩略图网格 */}
          <div className="flex-1 min-h-[120px] max-h-[300px] overflow-y-auto">
            {patterns.length === 0 && (
              <div className="text-white/30 text-[11px] pt-2 text-center">{t('pattern.empty_hint_pre', 'No patterns in this group — select objects, then click "')}<Star className="inline-block w-3 h-3 -mt-0.5 fill-current" /> {t('pattern.bookmark_selected_label', 'Bookmark Selected')}{t('pattern.empty_hint_post', '"')}</div>
            )}
            <div className="grid grid-cols-4 gap-2">
              {patterns.map(p => (
                <div key={p.id} data-pattern-card={p.id}
                  className="rounded border border-white/10 bg-white/5 p-1 cursor-grab active:cursor-grabbing relative group/card select-none"
                  title={t('pattern.card_hint', 'Drag to the playfield to place; drag onto a group tab on the left to change group')}
                  onPointerDown={e => { if ((e.target as HTMLElement).closest('button,input')) return; store.startPatternDrag(p.id); }}>
                  <Thumb pattern={p} />
                  {editId === p.id ? (
                    <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                      onBlur={() => { store.renamePattern(p.id, editName); setEditId(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') { store.renamePattern(p.id, editName); setEditId(null); } }}
                      data-pattern-input="rename"
                      className="w-full mt-1 bg-black/40 border border-white/15 rounded px-1 text-white text-[10px]" />
                  ) : (
                    <div className="mt-1 text-[10px] text-white/70 truncate text-center"
                      onDoubleClick={() => { setEditId(p.id); setEditName(p.name); }}
                      title={t('pattern.rename_hint', 'Double-click to rename')}>{p.name}</div>
                  )}
                  <button onClick={() => store.deletePattern(p.id)}
                    data-pattern-delete={p.id}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded bg-black/60 text-white/50 hover:text-red-400 text-[10px] leading-4 opacity-0 group-hover/card:opacity-100"
                    title={t('pattern.delete_pattern', 'Delete pattern')}><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-white/35 pt-1 border-t border-white/10">
          {t('pattern.timing_hint', 'Timing is recorded in beats: a pattern with one-beat spacing still has one-beat spacing when dragged onto songs with other BPMs. On placement the first object follows the cursor (object/grid snap applies), and the start time = current editor time (snapped to beat).')}
        </div>
      </div>
    </DraggableDialog>
  );
}
