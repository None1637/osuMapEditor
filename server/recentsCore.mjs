// v77: "打开最近的难度" 列表维护 (纯函数, Electron 主进程与验证器共用)
// 条目: { folderRel, folderAbs, root, file, label } — Songs 内用相对路径; v611: 外部谱面保存 root/folderAbs

/** 新条目置顶, 同来源目录与文件去重, 上限 cap 条 */
export function pushRecent(recents, entry, cap = 10) {
  const key = (e) => `${e.root ?? 'songs'}|${e.folderAbs ?? e.folderRel}|${e.file}`;
  return [entry, ...(recents ?? []).filter((r) => key(r) !== key(entry))].slice(0, cap);
}
