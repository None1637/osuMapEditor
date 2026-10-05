// v346: backend 分片 — store / saveMap / library / serverFs / libraryIndex 的状态与错误文案
// (menu.* 菜单标签在 electron/main.cjs 内嵌三语表, 主进程 CJS 不能 import 本词典)
export const zhCN: Record<string, string> = {
  // ---- store.* (保存状态栏反馈) ----
  'store.save_exported': '已导出: {file}',
  'store.save_saved': '已保存: {file}',
  'store.save_failed': '保存失败: {error}',
  // ---- fs.* (文件读写 / IndexedDB 持久化诊断) ----
  'fs.write_permission_denied': '未获得歌曲目录写入授权',
  'fs.read_failed': '读取失败 ({status}): {path}',
  'fs.dir_read_failed': '目录读取失败 ({status}): {path}',
  'fs.save_request_failed': '保存失败 ({status}): {file}',
  'fs.idb_verify_failed': '写入后读回校验失败 (句柄未真正落库)',
  'fs.idb_selftest_mismatch': 'fail: 读回值不符',
  'fs.idb_selftest_timeout': 'fail: 超时(当前环境 IndexedDB 挂起)',
  'fs.idb_selftest_error': 'fail: {error}',
  'fs.idb_write_timeout': 'IndexedDB 写入超时',
  'fs.persist_session_note': '{reason} (本次会话内仍会记住, 但下次启动需重选)',
  'fs.idb_read_timeout': 'IndexedDB 读取超时 (当前环境可能不支持跨会话记忆)',
  'fs.restore_write_failed': '写入时失败: {error}',
  'fs.idb_no_record': 'IndexedDB 中无记录',
  'fs.idb_read_failed': 'IndexedDB 读取失败: {error}',
  'fs.index_worker_error': '索引 worker 错误',
  'fs.index_worker_failed': '索引 worker 失败',
};
