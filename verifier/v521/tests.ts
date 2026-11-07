// v521 纯函数: lazer 风格空谱面与独立保存来源
import { createEmptyBeatmap, createNewBeatmapSource } from '../../src/osu/newBeatmap';
import { pickSaveRoute } from '../../src/osu/saveMap';
import { serializeOsu } from '../../src/osu/parser';

let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }

const bm = createEmptyBeatmap();
ok(bm.hitObjects.length === 0, '新谱面无物件');
ok(bm.metadata.title === '' && bm.metadata.artist === '' && bm.metadata.version === '', 'metadata/难度名为空');
ok(bm.general.previewTime === -1, 'PreviewTime=-1 (lazer 自动预览点)');
ok(bm.difficulty.cs === 5 && bm.difficulty.ar === 5 && bm.difficulty.od === 5 && bm.difficulty.hp === 5, 'CS/AR/OD/HP 全 5');
ok(bm.difficulty.sliderMultiplier === 1.4 && bm.difficulty.sliderTickRate === 1, '滑条倍率/tick 默认');
ok(bm.timingPoints.length === 1 && bm.timingPoints[0].beatLength === 1000 && bm.timingPoints[0].meter === 4, '60 BPM 4/4 默认红线');
const text = serializeOsu(bm);
ok(/HPDrainRate:\s*5/.test(text) && /CircleSize:\s*5/.test(text) && /OverallDifficulty:\s*5/.test(text) && /ApproachRate:\s*5/.test(text), '序列化保留 lazer 难度');
ok(/0,1000,4,2,0,100,1,0/.test(text), '序列化含默认红线');

const a = createNewBeatmapSource(1000), b = createNewBeatmapSource(1001);
ok(a.dir.serverRel === 'New Beatmap-1000' && b.dir.serverRel === 'New Beatmap-1001', '每次新建独立目录');
ok(a.fileName === 'New Beatmap.osu', '新建文件名固定且不覆盖他图');
ok(pickSaveRoute(a) === 'server', 'Electron 新谱面走服务器保存通道');

console.log(`V521_TESTS_PASSED (${n})`);
