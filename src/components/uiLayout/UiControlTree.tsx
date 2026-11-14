// v539: 控件树 — 层级/折叠/多选/屏蔽; 按钮显示当前文本并省略溢出
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { buildUiControlTree, type UiControlTreeNode } from '@/osu/uiControlTree';
import { getUiOverride, setUiOverride, useUiLayout, type UiControlDefinition } from '@/osu/uiLayout';
import { UiAutoControl, UiAutoIcon, UiAutoText } from './UiControl';
import { useT } from '@/i18n';

function currentButtonText(control: UiControlDefinition): string {
  if (control.kind !== 'button' || typeof document === 'undefined') return '';
  const elements = document.querySelectorAll<HTMLElement>(`[data-ui-id="${CSS.escape(control.id)}"]`);
  const el = [...elements].find(x => !x.hidden) ?? elements[0];
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function UiControlTree({ controls, selectedIds, onSelect }: {
  controls: readonly UiControlDefinition[];
  selectedIds: readonly string[];
  onSelect: (id: string, toggle: boolean) => void;
}) {
  useUiLayout();
  const t = useT();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const tree = buildUiControlTree(controls.filter(c => !c.id.startsWith('dialog.ui-layout-editor.item.')));
  const toggleGroup = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderNode = (node: UiControlTreeNode, depth: number): ReactNode => {
    const control = node.control;
    const text = control ? currentButtonText(control) : '';
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    return (
      <div key={node.id} data-ui-tree-node={node.id}>
        <div className={`flex items-center gap-1 py-0.5 ${control && selectedIds.includes(control.id) ? 'bg-cyan-500/20' : ''}`}
          style={{ paddingLeft: depth * 12 + 2 }}>
          {hasChildren ? (
            <UiAutoControl localId={`group.${node.id}.toggle`} kind="button"><button data-ui-tree-toggle={node.id}
              onClick={() => toggleGroup(node.id)} className="shrink-0 text-white/45 hover:text-white flex items-center"
              title={isCollapsed ? t('uiLayout.expand', 'Expand') : t('uiLayout.collapse', 'Collapse')}>
              <UiAutoIcon localId={`group.${node.id}.toggle`} state={isCollapsed ? 'active' : 'default'}>{isCollapsed
                ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</UiAutoIcon>
            </button></UiAutoControl>
          ) : <span className="w-3 shrink-0" />}
          {control ? (
            <UiAutoControl localId={`item.${control.id}.select`} kind="button"><button data-ui-tree-select={control.id}
              className="flex-1 min-w-0 text-left text-white/75 hover:text-white" title={`${control.id}${text ? ` — ${text}` : ''}`}
              onClick={e => onSelect(control.id, e.ctrlKey || e.metaKey)}>
              <span className="block truncate"><UiAutoText localId={`item.${control.id}.select`}>{node.label}</UiAutoText>{text && <span className="text-white/40"> — {text}</span>}</span>
            </button></UiAutoControl>
          ) : <span className="flex-1 min-w-0 truncate text-white/45" title={node.id}>{node.label}</span>}
          {control && (
            <UiAutoControl localId={`item.${control.id}.visibility`} kind="button"><button title={getUiOverride(control.id).visible === false ? t('uiLayout.show', 'Show') : t('uiLayout.hide', 'Hide')}
              onClick={() => setUiOverride(control.id, { visible: getUiOverride(control.id).visible === false })}
              className="text-white/50 hover:text-white shrink-0">
              <UiAutoIcon localId={`item.${control.id}.visibility`} state={getUiOverride(control.id).visible === false ? 'active' : 'default'}>{getUiOverride(control.id).visible === false
                ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</UiAutoIcon>
            </button></UiAutoControl>
          )}
        </div>
        {hasChildren && !isCollapsed && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };
  return <>{tree.map(node => renderNode(node, 0))}</>;
}
