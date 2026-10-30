// v519: 当前活动的批量插入模板编辑会话 — 键盘/原生菜单共用, 防止误改主谱面
export type AnchorStampGeometryCommand =
  | 'undo' | 'redo' | 'delete' | 'cancel' | 'reverse'
  | 'rot-ccw' | 'rot-cw' | 'flip-h' | 'flip-v'
  | 'ctrl-left' | 'ctrl-right' | 'ctrl-up' | 'ctrl-down';

type Handler = (cmd: AnchorStampGeometryCommand) => boolean;
let active: { uid: string; handler: Handler } | null = null;

export function activateAnchorStampEditor(uid: string, handler: Handler): void {
  active = { uid, handler };
}

export function releaseAnchorStampEditor(uid: string): void {
  if (active?.uid === uid) active = null;
}

export function dispatchAnchorStampGeometryCommand(cmd: string): boolean {
  return active?.handler(cmd as AnchorStampGeometryCommand) ?? false;
}

const MENU_COMMANDS: Record<string, AnchorStampGeometryCommand> = {
  'edit-undo': 'undo', 'edit-redo': 'redo', 'edit-delete': 'delete', 'edit-reverse': 'reverse',
  'edit-rot-ccw': 'rot-ccw', 'edit-rot-cw': 'rot-cw', 'edit-flip-h': 'flip-h', 'edit-flip-v': 'flip-v',
};

/** 返回 true = 已由活动模板处理, 不再进入主谱面菜单命令 */
export function dispatchAnchorStampMenuCommand(type: string): boolean {
  const cmd = MENU_COMMANDS[type];
  return cmd ? dispatchAnchorStampGeometryCommand(cmd) : false;
}
