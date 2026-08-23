// v185: 自动备份谱面 — backupCore 单元测试 (真临时目录) + main/preload/bridge/store/App 接线断言
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { performBackup, backupFolderName, backupFileName, listBackups, sanitizeFsName } =
  await import(pathToFileURL(path.join(root, 'server/backupCore.mjs')).href);

let failures = 0;
const ok = (cond, label) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------- backupCore 纯函数 ----------
ok(sanitizeFsName('a/b:c*d?e"f<g>h|i') === 'abcdefghi', 'sanitizeFsName 剔除 Windows 非法字符');
ok(backupFolderName('Camellia', 'Hello (BPM) 2021') === 'Camellia_Hello (BPM) 2021', '文件夹名 = 艺术家_歌曲名');
ok(backupFolderName('', '') === 'Unknown Artist_Unknown Title', '空艺术家/标题兜底');
ok(backupFileName('a (b) [X].osu', new Date(2026, 7, 18, 13, 34, 52)) === 'a (b) [X]_20260818_133452.osu', '备份文件名 = 原名(去.osu)+_时间戳.osu');
ok(backupFileName('a.osu', new Date(2026, 0, 2, 3, 4, 5)) === 'a_20260102_030405.osu', '时间戳补零');

// ---------- performBackup 行为 (临时目录真写) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v185-backup-'));
try {
  const args = { rootDir: tmp, artist: 'A', title: 'B', origFile: 'A - B (C) [D].osu', content: 'v1-content' };
  const folder = path.join(tmp, 'A_B');

  // ① 首次备份 → 新建
  let r = performBackup({ ...args, now: new Date(2026, 7, 18, 10, 0, 0) });
  ok(r.action === 'created' && fs.existsSync(path.join(folder, r.file)), '首次备份 → created');

  // ② 内容相同 → 不新建, 上次备份改名为最新时间
  r = performBackup({ ...args, now: new Date(2026, 7, 18, 10, 10, 0) });
  ok(r.action === 'renamed', '内容相同 → renamed');
  let files = listBackups(folder);
  ok(files.length === 1 && files[0].includes('20260818_101000'), '改名后仍只有一个文件, 名为最新时间');
  ok(fs.readFileSync(path.join(folder, files[0]), 'utf8') === 'v1-content', '改名后内容不变');

  // ③ 同一秒重复备份 (新旧名相同) → renamed 但不报错
  r = performBackup({ ...args, now: new Date(2026, 7, 18, 10, 10, 0) });
  ok(r.action === 'renamed' && listBackups(folder).length === 1, '同秒重复备份不报错不重复');

  // ④ 内容变化 → 新建
  r = performBackup({ ...args, content: 'v2-content', now: new Date(2026, 7, 18, 10, 20, 0) });
  ok(r.action === 'created' && listBackups(folder).length === 2, '内容变化 → created, 共 2 个备份');

  // ⑤ 不同谱面不同文件夹
  r = performBackup({ ...args, artist: 'X', title: 'Y', now: new Date(2026, 7, 18, 10, 30, 0) });
  ok(fs.existsSync(path.join(tmp, 'X_Y')) && r.folder.endsWith('X_Y'), '不同谱面独立文件夹');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- main.cjs 接线 ----------
const main = read('electron/main.cjs');
ok(main.includes('"backup_beatmaps"') && /app\.isPackaged \? path\.dirname\(app\.getPath\("exe"\)\)/.test(main), '备份根目录 = exe 同目录/backup_beatmaps (dev 回退 app/)');
ok(/ipcMain\.handle\("backup-beatmap"/.test(main), 'IPC: backup-beatmap');
ok(/ipcMain\.handle\("open-backup-folder"/.test(main) && /shell\.openPath\(folder\)/.test(main), 'IPC: open-backup-folder → shell.openPath');
ok(/label: "查看备份"[\s\S]*?type: "open-backups"/.test(main), '文件菜单含「查看备份」→ open-backups');
ok(/backupCore = await import\("\.\.\/server\/backupCore\.mjs"\)/.test(main), 'main() 动态 import backupCore');

// ---------- preload / bridge ----------
const preload = read('electron/preload.cjs');
ok(/backupBeatmap:.*invoke\("backup-beatmap"/.test(preload) && /openBackupFolder:.*invoke\("open-backup-folder"/.test(preload), 'preload 暴露 backupBeatmap/openBackupFolder');
const bridge = read('src/osu/electronBridge.ts');
ok(/backupBeatmap\(payload/.test(bridge) && /openBackupFolder\(info/.test(bridge), 'electronBridge 接口含备份 API');
ok(/\| \{ type: 'open-backups' \}/.test(bridge), 'ElectronMenuCommand 含 open-backups');

// ---------- store / App ----------
const store = read('src/osu/store.ts');
ok(/async backupNow\(/.test(store) && /api\.backupBeatmap\(/.test(store), 'store.backupNow 调 backupBeatmap IPC');
ok(/void this\.backupNow\('save', r\.text\)/.test(store), 'Ctrl+S 保存成功后备份一次 (复用序列化文本)');
ok(/async openBackupFolder\(/.test(store), 'store.openBackupFolder');
const app = read('src/App.tsx');
ok(/setInterval\(\(\) => \{ void store\.backupNow\('auto'\); \}, 10 \* 60 \* 1000\)/.test(app), 'App: 每 10 分钟自动备份定时器');
ok(/cmd\.type === 'open-backups'\) \{ void store\.openBackupFolder\(\)/.test(app), 'App: open-backups 菜单命令 → 打开备份文件夹');

// ---------- gitignore ----------
ok(/backup_beatmaps\//.test(read('.gitignore')), '.gitignore 含 backup_beatmaps/');

console.log(failures ? `FAILURES: ${failures}` : 'ALL_OK');
if (failures) process.exit(1);
