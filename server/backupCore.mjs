// v185: 谱面自动备份核心 (Electron 主进程动态 import; verifier 直接单测)
// 备份根目录 = exe 同目录/backup_beatmaps (开发时 = app/backup_beatmaps, 由 main.cjs 解析传入);
// 每谱面一个文件夹 "艺术家_歌曲名"; 备份文件 = 原谱面文件名(去 .osu) + _YYYYMMDD_HHmmss.osu;
// 内容与上次备份完全相同 → 不新建, 把上次备份文件重命名为最新时间
import fs from 'node:fs';
import path from 'node:path';

/** 剔除 Windows 非法字符 (文件夹/文件名通用; 与 saveMap.mapFileName 同款) */
export function sanitizeFsName(s) {
  return String(s ?? '').replace(/[\\/:*?"<>|]/g, '').trim();
}

/** 备份文件夹名: "艺术家_歌曲名" */
export function backupFolderName(artist, title) {
  const a = sanitizeFsName(artist) || 'Unknown Artist';
  const t = sanitizeFsName(title) || 'Unknown Title';
  return `${a}_${t}`;
}

/** 本地时间戳: YYYYMMDD_HHmmss (Windows 文件名禁 ':') */
export function backupTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 备份文件名: 原谱面文件名(去 .osu) + _时间戳.osu */
export function backupFileName(origFile, d = new Date()) {
  const base = sanitizeFsName(String(origFile ?? 'beatmap').replace(/\.osu$/i, '')) || 'beatmap';
  return `${base}_${backupTimestamp(d)}.osu`;
}

/** 列出文件夹内备份文件, 新→旧 (原名固定时文件名字典序 = 时间序) */
export function listBackups(folder) {
  try {
    return fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.osu')).sort().reverse();
  } catch { return []; }
}

/**
 * 执行一次备份。
 * @returns {{action:'created'|'renamed', folder:string, file:string}}
 */
export function performBackup({ rootDir, artist, title, origFile, content, now = new Date() }) {
  const folder = path.join(rootDir, backupFolderName(artist, title));
  fs.mkdirSync(folder, { recursive: true });
  const name = backupFileName(origFile, now);
  const last = listBackups(folder)[0];
  if (last) {
    const lastPath = path.join(folder, last);
    let same = false;
    try { same = fs.readFileSync(lastPath, 'utf8') === content; } catch { /* 读不出就当不同 */ }
    if (same) {
      if (last !== name) fs.renameSync(lastPath, path.join(folder, name)); // 同一秒重复备份时新旧名相同, 跳过重命名
      return { action: 'renamed', folder, file: name };
    }
  }
  fs.writeFileSync(path.join(folder, name), content, 'utf8');
  return { action: 'created', folder, file: name };
}
