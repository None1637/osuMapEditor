// v184: 谱面信息移到页签栏 — song setup 左侧, flex-1 居中尽量靠窗口中间; 两个 Label: 名称(左) / 数据(右)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
let failures = 0;
const ok = (cond, label) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; };

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

// 1. 页签栏结构: compose / timing → song setup → 谱面信息容器 → 音量/显示设置 (v186: song setup 在谱面信息左边)
const iCompose = app.indexOf("'compose'");
const iSetup = app.indexOf("setTab('setup')");
const iInfo = app.indexOf('flex-1 flex items-center justify-center gap-2 min-w-0 pointer-events-none');
const iVolume = app.indexOf('data-volume-panel-btn');
ok(iCompose > 0 && iSetup > iCompose && iInfo > iSetup && iVolume > iInfo, '顺序: compose/timing → song setup → 谱面信息 → 音量/显示设置 (v186)');
ok(/v184: 谱面信息从游玩区左下角移到页签栏/.test(app), 'v184 注释');
ok(/v186: song setup 在谱面信息左边/.test(app), 'v186 注释 (song setup 左 / 信息右)');

// 2. 两个 Label: 名称左 (含指示器/保存反馈), 数据右 (CS/AR/物件数/★)
const nameIdx = app.indexOf('{bm.metadata.artist} - {bm.metadata.title}');
const statsIdx = app.indexOf('{bm.hitObjects.length} 物件');
ok(app.indexOf('data-dirty-indicator') < nameIdx && nameIdx < statsIdx, '名称 Label 在左 (指示器 → 名称), 数据 Label 在右');
ok(/max-w-\[28rem\]/.test(app) && /truncate/.test(app.slice(iInfo, iVolume)), '名称 Label 限宽截断');

// 3. 旧位置已移除
ok(!/absolute bottom-2 left-2 flex flex-col/.test(app), '游玩区左下角旧容器已移除');
ok(/v184: 谱面信息已移到页签栏/.test(app), '原位置留注释标记');

// 4. 无谱面时仍有 flex-1 占位 (音量/显示设置保持靠右)
ok(/\{!bm && <div className="flex-1" \/>\}/.test(app), '无谱面时 flex-1 占位保留右对齐');

console.log(failures ? `FAILURES: ${failures}` : 'ALL_OK');
if (failures) process.exit(1);
