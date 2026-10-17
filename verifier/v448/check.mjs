// 验证器 v448: exe 模式测试游玩时禁止拖动窗口
// 场景: hideTitleBar (v263) 下页签栏是 -webkit-app-region: drag 拖拽区;
//   游玩中按住甩动鼠标若触及拖拽区会拖动窗口 -> 游玩时拖拽区整体降级 no-drag, 覆盖层自身也 no-drag。
// 运行: node verifier/v448/check.mjs (纯源码断言, 无需 build)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('App.tsx: 页签栏拖拽区游玩时禁拖');
{
  const app = read('src/App.tsx');
  assert(/v448: 测试游玩中禁拖/.test(app), 'v448 注释');
  assert(/WebkitAppRegion: testPlay \? 'no-drag' : 'drag'/.test(app), 'testPlay 时拖拽区降级 no-drag');
}

section('TestPlayOverlay.tsx: 覆盖层自身 no-drag');
{
  const tp = read('src/components/TestPlayOverlay.tsx');
  assert(/WebkitAppRegion: 'no-drag'/.test(tp), '覆盖层根 no-drag');
  assert(/data-dialog="testplay"/.test(tp), 'v436 只读标记保留');
}

section('编译');
{
  execSync('node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc 通过');
}

console.log(failures ? `\nVERIFIER_V448_FAILED: ${failures} 处失败` : '\nVERIFIER_V448_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
