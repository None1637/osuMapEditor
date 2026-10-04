// 全量扫描真实曲库计时 (模拟 exe 索引: 枚举 → 读文件 → parseIndexEntry)
import fs from 'fs';
import path from 'path';

const SONGS = 'F:/Backup/D/osu!/Songs';
const m = await import('./.libindex.tmp.mjs');

const t0 = Date.now();
const dirs = fs.readdirSync(SONGS, { withFileTypes: true }).filter(d => d.isDirectory());
const tEnum = Date.now();

let files = 0, parsed = 0, failed = 0, totalBytes = 0;
const slowest = []; // {ms, file, size}
let maxReadMs = 0, maxReadFile = '';
let entries;

const tParse0 = Date.now();
let di = 0;
for (const d of dirs) {
  di++;
  if (di % 500 === 0) {
    const el = (Date.now() - tParse0) / 1000;
    const eta = el / di * (dirs.length - di);
    console.log(`进度 ${di}/${dirs.length} 目录 (${(di / dirs.length * 100).toFixed(0)}%), 已扫 ${files} 文件, 耗时 ${el.toFixed(0)}s, 预计剩余 ${eta.toFixed(0)}s`);
  }
  let list;
  try { list = fs.readdirSync(path.join(SONGS, d.name)); } catch { continue; }
  for (const name of list) {
    if (!name.toLowerCase().endsWith('.osu')) continue;
    files++;
    const fp = path.join(SONGS, d.name, name);
    let text;
    const r0 = Date.now();
    try { text = fs.readFileSync(fp, 'utf8'); } catch { failed++; continue; }
    const rMs = Date.now() - r0;
    if (rMs > maxReadMs) { maxReadMs = rMs; maxReadFile = `${d.name}/${name}`; }
    const p0 = Date.now();
    try { m.parseIndexEntry(text, d.name, name, text.length, 0); parsed++; } catch { failed++; continue; }
    const pMs = Date.now() - p0;
    totalBytes += text.length;
    if (pMs >= 50) slowest.push({ ms: pMs, file: `${d.name}/${name}`, size: text.length });
  }
}
const tParse = Date.now();

slowest.sort((a, b) => b.ms - a.ms);
entries = parsed;
console.log(`目录枚举: ${dirs.length} 目录, ${tEnum - t0}ms`);
console.log(`文件: ${files} 个 .osu, 解析成功 ${parsed}, 失败 ${failed}`);
console.log(`总大小: ${(totalBytes / 1048576).toFixed(1)} MB`);
console.log(`读取+解析总耗时: ${((tParse - tParse0) / 1000).toFixed(1)}s (全程 ${((tParse - t0) / 1000).toFixed(1)}s)`);
console.log(`平均每文件: ${((tParse - tParse0) / Math.max(1, files)).toFixed(2)}ms`);
console.log(`最慢读取: ${maxReadMs}ms (${maxReadFile})`);
console.log(`解析 ≥50ms 的文件: ${slowest.length} 个`);
for (const s of slowest.slice(0, 10)) console.log(`  ${s.ms}ms ${(s.size / 1048576).toFixed(1)}MB ${s.file.slice(0, 110)}`);
