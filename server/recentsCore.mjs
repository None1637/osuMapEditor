// v77: "打开最近的难度" 列表维护 (纯函数, Electron 主进程与验证器共用)
// 条目: { folderRel, file, label } — folderRel = Songs 内相对路径, file = .osu 文件名, label = 菜单显示文本

/** 新条目置顶, 同 (folderRel, file) 去重, 上限 cap 条 */
export function pushRecent(recents, entry, cap = 10) {
  const key = (e) => `${e.folderRel}|${e.file}`;
  return [entry, ...(recents ?? []).filter((r) => key(r) !== key(entry))].slice(0, cap);
}
