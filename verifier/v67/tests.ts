// 验证器 v67 纯函数测试: Ctrl+S 保存谱面 (stable 命名 / 通道路由 / 序列化往返 / server 通道写出)
import { parseOsu, serializeOsu } from '../../src/osu/parser';
import { mapFileName, pickSaveRoute, saveBeatmap, type MapSource } from '../../src/osu/saveMap';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const OSU_TEXT = `osu file format v14

[General]
AudioFilename: audio.mp3

[Editor]
DistanceSpacing: 1.2
BeatDivisor: 8
GridSize: 16
TimelineZoom: 2

[Metadata]
Title:Test/Title
Artist:Some*Artist
Creator:mapper
Version:Insane

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,0,80,1,0
1000,-100,4,1,0,60,0,0

[HitObjects]
256,192,1000,1,0,0:0:0:0:
100,100,1500,2,0,L|300:100,1,200
`;

section('mapFileName: stable 命名 + Windows 非法字符剔除');
{
  const bm = parseOsu(OSU_TEXT);
  const name = mapFileName(bm);
  assert(name === 'SomeArtist - TestTitle (mapper) [Insane].osu', `非法字符剔除 (实际 ${name})`);
  const unicode = parseOsu(OSU_TEXT.replace('Title:Test/Title', 'Title:\nTitleUnicode:测试谱面').replace('Artist:Some*Artist', 'Artist:\nArtistUnicode:アーティスト'));
  assert(mapFileName(unicode) === 'アーティスト - 测试谱面 (mapper) [Insane].osu', 'ASCII 为空回退 Unicode');
  const bare = parseOsu(OSU_TEXT.replace('Version:Insane', 'Version:'));
  assert(mapFileName(bare).endsWith('[Normal].osu'), '空难度名兜底 Normal');
}

section('pickSaveRoute: 按目录对象能力路由');
{
  assert(pickSaveRoute(null) === 'download', '无来源 => 下载');
  assert(pickSaveRoute(undefined) === 'download', 'undefined => 下载');
  const serverDir = { kind: 'directory', name: 's', entries: async function* () { }, getFileHandle: async () => { throw new Error('x'); }, writeFile: async () => { } };
  assert(pickSaveRoute({ dir: serverDir, fileName: 'a.osu' }) === 'server', '有 writeFile => 服务器写回');
  const nativeDir = { queryPermission: async () => 'granted' };
  assert(pickSaveRoute({ dir: nativeDir as unknown as MapSource['dir'], fileName: 'a.osu' }) === 'native', '原生句柄 => File System Access 写回');
  const dragDir = { kind: 'directory', name: 'd', entries: async function* () { }, getFileHandle: async () => { throw new Error('x'); } };
  assert(pickSaveRoute({ dir: dragDir, fileName: 'a.osu' }) === 'download', '拖拽目录 (无写能力) => 下载兜底');
}

section('serialize 往返: 修改后的物件/[Editor]/timing 全保留');
{
  const bm = parseOsu(OSU_TEXT);
  bm.hitObjects[0]!.time = 1234; // 模拟编辑
  bm.editor.distanceSpacing = 2.5;
  const text = serializeOsu(bm);
  const back = parseOsu(text);
  assert(back.hitObjects.length === 2 && back.hitObjects[0]!.time === 1234, '物件修改写入并可读回');
  assert(back.editor.distanceSpacing === 2.5 && back.editor.beatDivisor === 8 && back.editor.gridSize === 16 && back.editor.timelineZoom === 2, '[Editor] 四字段保留');
  assert(back.timingPoints.length === 2 && back.timingPoints[1]!.beatLength === -100 && back.timingPoints[1]!.volume === 60, '红绿线保留 (含绿线音量)');
  assert(text.includes('osu file format v14') && text.includes('[HitObjects]'), 'v14 头部 + section');
}

section('saveBeatmap: server 通道走 dir.writeFile, 用原文件名');
{
  const bm = parseOsu(OSU_TEXT);
  let captured: { n: string; c: string } | null = null;
  const dir = {
    kind: 'directory', name: 'song',
    entries: async function* () { },
    getFileHandle: async () => { throw new Error('x'); },
    writeFile: async (n: string, c: string) => { captured = { n, c }; },
  };
  const r = await saveBeatmap(bm, { dir, fileName: 'original name.osu' });
  assert(r.route === 'server' && r.fileName === 'original name.osu', '路由/文件名 = 来源原文件');
  assert(captured !== null && (captured as unknown as { n: string }).n === 'original name.osu'
    && (captured as unknown as { c: string }).c.includes('[HitObjects]'), 'writeFile 收到序列化全文');
  assert(r.text === (captured as unknown as { c: string }).c, 'outcome.text = 写出内容');
}

if (failures) { console.error(`\nTESTS_V67_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V67_ALL_PASSED');
