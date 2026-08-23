// 验证器 v9: hitsound 采样解析 (hitSample 段 / set 名 / stem 候选 / 文件名正则)
// + fs 适配器对真实谱面目录跑 collectSampleFiles + 合成音彻底移除的源码回归
import fs from 'fs';
import path from 'path';
import {
  parseHitSample, setName, setNumFromGeneral, stemCandidates,
  soundsForHitSound, SAMPLE_FILE_RE,
} from '../../src/osu/clock/hitSounds';
import { collectSampleFiles, type FsDirLike } from '../../src/osu/library';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function eq<T>(a: T, b: T, msg: string) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`); }
function section(name: string) { console.log('== ' + name); }

section('hitSounds: parseHitSample');
{
  eq(parseHitSample(undefined), { normalSet: 0, additionSet: 0, customIndex: 0, volume: 0 }, 'undefined -> 全 0');
  eq(parseHitSample('0:0:0:0:'), { normalSet: 0, additionSet: 0, customIndex: 0, volume: 0 }, '默认段全 0');
  eq(parseHitSample('2:1:3:70:'), { normalSet: 2, additionSet: 1, customIndex: 3, volume: 70 }, '完整段解析');
  eq(parseHitSample('1:2'), { normalSet: 1, additionSet: 2, customIndex: 0, volume: 0 }, '缺字段补 0');
}

section('hitSounds: set 名与 stem 候选');
{
  eq(setName(1), 'normal', 'set 1 = normal');
  eq(setName(2), 'soft', 'set 2 = soft');
  eq(setName(3), 'drum', 'set 3 = drum');
  eq(setNumFromGeneral('Normal'), 1, 'Normal -> 1');
  eq(setNumFromGeneral('Soft'), 2, 'Soft -> 2');
  eq(setNumFromGeneral('Drum'), 3, 'Drum -> 3');
  eq(stemCandidates('hitnormal', 2, 0), ['soft-hitnormal'], '无序号单候选');
  eq(stemCandidates('hitnormal', 2, 1), ['soft-hitnormal'], '序号 1 无后缀');
  eq(stemCandidates('hitfinish', 3, 2), ['drum-hitfinish2', 'drum-hitfinish'], '序号 2 带后缀 + 回退');
}

section('hitSounds: soundsForHitSound 位标志');
{
  eq(soundsForHitSound(0), ['hitnormal'], 'bit0 默认 normal');
  eq(soundsForHitSound(2), ['hitnormal', 'hitwhistle'], 'whistle');
  eq(soundsForHitSound(6), ['hitnormal', 'hitwhistle', 'hitfinish'], 'whistle+finish');
  eq(soundsForHitSound(14), ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap'], '全部');
}

section('hitSounds: SAMPLE_FILE_RE');
{
  const yes = ['soft-hitnormal.wav', 'drum-hitfinish2.WAV', 'normal-sliderslide.mp3', 'Soft-HitClap.ogg', 'drum-hitwhistle10.wav'];
  const no = ['audio.mp3', 'normal-hitnormal.bak', 'hitsound.wav', 'soft-hitnormal2.wav.txt', 'x-soft-hitnormal.wav'];
  for (const f of yes) assert(SAMPLE_FILE_RE.test(f), `应匹配 ${f}`);
  for (const f of no) assert(!SAMPLE_FILE_RE.test(f), `不应匹配 ${f}`);
  const m = 'Soft-HitClap.ogg'.match(SAMPLE_FILE_RE)!;
  eq([m[1], m[2], m[3]], ['Soft', 'HitClap', ''], '捕获组正确');
}

section('library: collectSampleFiles 真实谱面目录 ($OSU_SONGS_DIR)');
{
  // fs 版 FsDirLike 适配器 (与浏览器 FileSystemDirectoryEntry 结构一致)
  const fsDir = (dirPath: string): FsDirLike => ({
    kind: 'directory', name: path.basename(dirPath),
    async *entries() {
      for (const e of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const p = path.join(dirPath, e.name);
        if (e.isDirectory()) yield [e.name, fsDir(p)];
        else yield [e.name, {
          kind: 'file', name: e.name,
          getFile: async () => new File([fs.readFileSync(p)], e.name),
        }];
      }
    },
    async getFileHandle(name: string) {
      const p = path.join(dirPath, name);
      if (!fs.existsSync(p)) throw new Error('not found: ' + name);
      return { kind: 'file', name, getFile: async () => new File([fs.readFileSync(p)], name) };
    },
  });

  const SONGS = process.env.OSU_SONGS_DIR ?? '';
  if (fs.existsSync(SONGS)) {
    let found = 0, checkedDirs = 0, totalSamples = 0;
    let example: string[] = [];
    for (const e of fs.readdirSync(SONGS, { withFileTypes: true })) {
      if (!e.isDirectory() || checkedDirs >= 300) continue;
      checkedDirs++;
      const samples = await collectSampleFiles(fsDir(path.join(SONGS, e.name)));
      if (samples.size > 0) {
        found++;
        totalSamples += samples.size;
        if (!example.length) example = [...samples.keys()].slice(0, 6);
        // stem 必须是小写 "set-sound" 形式
        for (const k of samples.keys())
          assert(/^(normal|soft|drum)-(hitnormal|hitwhistle|hitfinish|hitclap|slidertick|sliderslide)\d*$/.test(k), `stem 格式: ${k}`);
      }
      if (found >= 5) break;
    }
    console.log(`  扫描 ${checkedDirs} 个歌曲目录, ${found} 个含自定义采样, 共 ${totalSamples} 个采样文件; 示例: ${example.join(', ')}`);
    assert(found >= 1, '真实曲库中应至少找到一个含 hitsound 采样的谱面目录');
  } else {
    console.log('  跳过: Songs 目录不存在');
  }
}

section('回归: 合成占位音已彻底移除 + 默认 hitsound 就位');
{
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const store = read('../../src/osu/store.ts');
  const hs = read('../../src/osu/clock/hitSounds.ts');
  assert(!store.includes('createHitSoundBuffers'), 'store 不再引用合成音');
  assert(!hs.includes('createHitSoundBuffers') && !hs.includes('Math.sin'), 'hitSounds.ts 不再含合成逻辑');
  assert(store.includes('hitBuffers.get(soundId)'), 'store 使用采样 Map 播放');
  assert(store.includes('defaultBuffers') && store.includes('ensureDefaultSamples'), 'store 有默认采样回退');
  assert(hs.includes('DEFAULT_SAMPLE_STEMS'), 'hitSounds 导出默认采样清单');
  // 默认采样文件: 12 个 RIFF WAV, 取自 ppy.osu.Game.Resources (osu! 经典默认皮肤)
  for (const set of ['normal', 'soft', 'drum']) {
    for (const snd of ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap']) {
      const p = new URL(`../../public/samples/${set}-${snd}.wav`, import.meta.url);
      assert(fs.existsSync(p), `默认采样存在: ${set}-${snd}.wav`);
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        assert(buf.length > 1000 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE',
          `${set}-${snd}.wav 是有效 RIFF WAV (${buf.length} bytes)`);
      }
    }
  }
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 条断言失败`);
if (failures > 0) process.exit(1);
