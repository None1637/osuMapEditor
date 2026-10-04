// 验证器 v329: 同时间点放置新物件自动删除旧物件 (stable 语义)
//   需求: 在已有物件的时间点放置新物件时自动删除旧物件, 与 stable 表现对齐。
//   addObject 的全部 4 个调用点都是放置路径 (EditorCanvas: 单点/滑条完成×2/转盘提交),
//   故在 store.addObject 统一实现, 粘贴/批量等不经此路。
// 运行: node verifier/v329/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const store = readSrc('src/osu/store.ts');
const ec = readSrc('src/components/EditorCanvas.tsx');

section('addObject: 同刻旧物件顶替');
{
  const blk = store.match(/addObject\(o: HitObject\) \{[\s\S]{0,500}?\n  \}/);
  assert(!!blk, 'addObject 存在');
  assert(!!blk && /pushUndo\(\);[\s\S]{0,200}?filter\(x => x\.time !== o\.time\)[\s\S]{0,200}?push\(o\)/.test(blk[0]),
    'pushUndo 后先删同刻旧物件再 push (一次 undo)');
  assert(!!blk && /sort\(\(a, b\) => a\.time - b\.time\)/.test(blk[0]), '时间排序保留');
}

section('调用面: addObject 仅放置路径使用 (顶替不影响批量/粘贴)');
{
  const callers = ec.match(/store\.addObject\(/g) ?? [];
  assert(callers.length === 4, `EditorCanvas 放置调用点 4 处 (实际 ${callers.length})`);
  const other = (store.match(/this\.addObject\(/g) ?? []).length
    + readSrc('src/osu/parser.ts').split('addObject').length - 1;
  assert(other === 0, 'store/parser 内部无其他 addObject 调用');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv329 全部通过');
process.exit(failures ? 1 : 0);
