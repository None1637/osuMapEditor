// 验证器 v22: 曲库恢复"待授权"时授权按钮不显示
// 用户报告: 刷新后日志"已恢复目录「Songs」, 权限=待授权", 但面板里没有授权按钮。
// 根因: SongLibrary JSX 为 {!root ? 选择页 : permNeeded ? 授权页 : 列表页},
// 而恢复流程在 granted=false 分支只 setPermNeeded(true) 没有 setRoot — root=null 永远走选择页。
// 修复: 恢复成功即 setRoot (授权按钮分支依赖 root 非空), granted 才 startScan。
// 运行: cd app && node verifier/v22/check.mjs; node verifier/v22/cdp-perm.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('SongLibrary.tsx: 待授权分支也 setRoot (授权按钮可见)');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  const blk = src.match(/已恢复目录「\$\{r\.handle\.name\}」[\s\S]*?else setPermNeeded\(true\);/)?.[0] ?? '';
  assert(blk.length > 0, '恢复分支存在');
  assert(/setRootNative\(r\.handle\);\s*\n\s*setRoot\(asDirLike\(r\.handle\)\);/.test(blk), 'granted 判断前先 setRoot');
  assert(/if \(r\.granted\) \{[\s\S]*?startScan\(/.test(blk), 'granted 才 startScan (startScan 在 granted 块内)');
  assert(/!root \? \([\s\S]*?permNeeded \? \([\s\S]*?授权访问/.test(src), 'JSX: 授权页在 permNeeded 分支 (root 非空前提)');
}

section('SkinPicker.tsx: 授权按钮不依赖额外状态 (对照, 本来就没问题)');
{
  const src = readSrc('src/components/SkinPicker.tsx');
  assert(src.includes('setNativeHandle(r.handle);'), '恢复先 setNativeHandle');
  assert(/\{permNeeded \? \([\s\S]*?授权访问/.test(src), '授权按钮只看 permNeeded');
}

if (failures) { console.error(`\nVERIFIER_V22_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V22_ALL_TESTS_PASSED');
