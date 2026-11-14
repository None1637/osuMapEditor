// v539: 永久控件 ID → 可折叠树; 搜索保留命中项的祖先链
import type { UiControlDefinition } from './uiLayout';

export interface UiControlTreeNode {
  /** 当前分组/控件的完整 ID 路径 */
  id: string;
  /** 树中显示的最后一段 */
  label: string;
  control?: UiControlDefinition;
  children: UiControlTreeNode[];
}

export function buildUiControlTree(controls: readonly UiControlDefinition[], search = ''): UiControlTreeNode[] {
  const query = search.trim().toLowerCase();
  const roots: UiControlTreeNode[] = [];
  const byId = new Map<string, UiControlTreeNode>();
  const visible = controls.filter(c => !query || c.id.toLowerCase().includes(query));
  for (const control of [...visible].sort((a, b) => a.id.localeCompare(b.id))) {
    const parts = control.id.split('.');
    let siblings = roots;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path = path ? `${path}.${parts[i]}` : parts[i];
      let node = byId.get(path);
      if (!node) {
        node = { id: path, label: parts[i], children: [] };
        byId.set(path, node);
        siblings.push(node);
      }
      if (i === parts.length - 1) node.control = control;
      siblings = node.children;
    }
  }
  return roots;
}
