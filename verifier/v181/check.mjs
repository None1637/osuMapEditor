// v181: 界面 emoji/Unicode 符号图标 → lucide-react; AGENTS.md 新增规范
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
let failures = 0;
const ok = (cond, label) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; };

// 1. src 下不允许残留 emoji/符号图标字符 (允许: → ← ↔ ▸ ↑ ↓ 等文本箭头, 以及注释)
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}\u{23E9}-\u{23FA}\u{229E}]/u;
const TEXT_ARROW_OK = /[→←↔▸↑↓]/u; // 白名单: 这些字符单独出现不算违规
function scanDir(dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDir(p, hits);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // 去块注释 (含 JSX {/* */})
      src.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, ''); // 去行注释
        for (const ch of code) {
          if (EMOJI_RE.test(ch) && !TEXT_ARROW_OK.test(ch)) { hits.push(`${p}:${i + 1}: ${ch}`); break; }
        }
      });
    }
  }
}
const hits = [];
scanDir(path.join(root, 'src'), hits);
ok(hits.length === 0, `src 无 emoji/符号图标残留${hits.length ? ' -> ' + hits.slice(0, 5).join(' | ') : ''}`);

// 2. App.tsx 已接入 lucide-react
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
ok(/from 'lucide-react'/.test(app), 'App.tsx 导入 lucide-react');
ok(/<Star className="inline w-3 h-3/.test(app), '星数 ★ → Star 组件');
ok(/data-dirty-indicator/.test(app) && app.includes('rounded-full bg-white/90'), '脏标记 ⚪ → CSS 圆点 span');
ok(/<Undo2 /.test(app) && /<Redo2 /.test(app), '撤销/重做 ↩↪ → Undo2/Redo2');

// 3. 各组件替换到位
const comp = (f) => fs.readFileSync(path.join(root, 'src/components', f), 'utf8');
ok(/<X className/.test(comp('DraggableDialog.tsx')), 'DraggableDialog ✕ → X');
ok(/<Play /.test(comp('Timelines.tsx')) && /<Pause /.test(comp('Timelines.tsx')) && /<Square /.test(comp('Timelines.tsx')), 'Timelines 播放控制 → lucide (v221 起 ⏮/⏭ 按钮已删, 剩 ▶/⏸/⏹)');
ok(/<Palette className/.test(comp('SkinPicker.tsx')), 'SkinPicker 🎨 → Palette');
ok(/<FolderOpen className/.test(comp('SongLibrary.tsx')), 'SongLibrary 📁 → FolderOpen');
ok(/<TriangleAlert className/.test(comp('UnsavedDialog.tsx')), 'UnsavedDialog ⚠ → TriangleAlert');
ok(/<Star className/.test(comp('PatternPanel.tsx')), 'PatternPanel ★ → Star');

// 4. AGENTS.md 规范存在
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
ok(agents.includes('lucide-react') && agents.includes('禁止'), 'AGENTS.md 含图标规范');

console.log(failures ? `FAILURES: ${failures}` : 'ALL_OK');
if (failures) process.exit(1);
