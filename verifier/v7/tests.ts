// 验证器 v7: lifecycle(滑条结束后 240ms 淡出修复) + library.parseQuickMetadata
import fs from 'fs';
import path from 'path';
import { parseOsu, arToPreempt, arToFadeIn, sliderVelocityAt } from '../../src/osu/parser';
import { HIT_FADE, alphaAt, hitObjectDuration, hitObjectEndTime, isVisibleAt } from '../../src/osu/lifecycle';
import { parseQuickMetadata } from '../../src/osu/library';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function approx(a: number, b: number, eps: number, msg: string) {
  assert(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b}, eps=${eps})`);
}
function section(name: string) { console.log('== ' + name); }

// 谱面: AR9 -> preempt 600 / fadeIn 400; 红线 beatLength=500, SliderMultiplier 1.4
// -> 滑条速度 0.28 px/ms; slider len=140 slides=2 -> 时长 1000ms
const OSU = `osu file format v14

[Difficulty]
ApproachRate:9
SliderMultiplier:1.4

[TimingPoints]
1000,500,4,1,0,80,1,0

[HitObjects]
256,192,10000,2,0,B|356:192|356:192,2,140
256,192,20000,5,0
256,192,30000,8,0,32000
`;

const bm = parseOsu(OSU);
const [slider, circle, spinner] = bm.hitObjects;

section('lifecycle: 基础参数假设');
{
  assert(bm.hitObjects.length === 3, '应解析出 3 个物件');
  assert(slider?.type === 'slider' && circle?.type === 'circle' && spinner?.type === 'spinner', '物件类型正确');
  approx(arToPreempt(9), 600, 1e-9, 'AR9 preempt');
  approx(arToFadeIn(9), 400, 1e-9, 'AR9 fadeIn');
  approx(sliderVelocityAt(bm.timingPoints, 10000, 1.4), 0.28, 1e-9, '滑条速度 0.28px/ms');
}

section('lifecycle: 时长与结束时间');
{
  approx(hitObjectDuration(bm, slider), 1000, 1e-9, 'slider 时长 = 140/0.28*2');
  approx(hitObjectEndTime(bm, slider), 11000, 1e-9, 'slider 结束时间');
  approx(hitObjectDuration(bm, circle), 0, 1e-9, 'circle 时长 0');
  approx(hitObjectEndTime(bm, circle), 20000, 1e-9, 'circle 结束时间');
  approx(hitObjectDuration(bm, spinner), 2000, 1e-9, 'spinner 时长 = endTime - time');
  approx(hitObjectEndTime(bm, spinner), 32000, 1e-9, 'spinner 结束时间');
}

section('lifecycle: slider 淡入/滞留/淡出曲线 (核心修复)');
{
  approx(alphaAt(bm, slider, 9399), 0, 1e-9, 'preempt 前不可见');
  approx(alphaAt(bm, slider, 9400), 0, 1e-9, '淡入起点 alpha=0');
  approx(alphaAt(bm, slider, 9600), 0.5, 1e-9, '淡入中点 alpha=0.5');
  approx(alphaAt(bm, slider, 9800), 1, 1e-9, '淡入结束 alpha=1');
  approx(alphaAt(bm, slider, 10000), 1, 1e-9, '开始时刻 alpha=1');
  approx(alphaAt(bm, slider, 10999), 1, 1e-9, '结束前 alpha=1');
  approx(alphaAt(bm, slider, 11000), 1, 1e-9, '结束时刻 alpha=1');
  approx(alphaAt(bm, slider, 11120), 0.5, 1e-9, '结束后 120ms alpha=0.5');
  approx(alphaAt(bm, slider, 11240), 0, 1e-9, '结束后 240ms alpha=0 (修复前会停留数秒)');
  approx(alphaAt(bm, slider, 11500), 0, 1e-9, '结束 500ms 后仍 alpha=0');
  assert(!isVisibleAt(bm, slider, 9399), 'preempt 前不渲染');
  assert(isVisibleAt(bm, slider, 9400), '淡入起点开始渲染');
  assert(isVisibleAt(bm, slider, 11240), '淡出终点仍渲染');
  assert(!isVisibleAt(bm, slider, 11241), '淡出结束后不再渲染 (旧逻辑为 end+800ms)');
}

section('lifecycle: circle / spinner 同样适用');
{
  approx(alphaAt(bm, circle, 20000), 1, 1e-9, 'circle 命中时刻 alpha=1');
  approx(alphaAt(bm, circle, 20120), 0.5, 1e-9, 'circle 命中后 120ms alpha=0.5');
  approx(alphaAt(bm, circle, 20240), 0, 1e-9, 'circle 命中后 240ms alpha=0');
  assert(!isVisibleAt(bm, circle, 20241), 'circle 淡出结束后不渲染');
  approx(alphaAt(bm, spinner, 32000), 1, 1e-9, 'spinner 结束时刻 alpha=1');
  approx(alphaAt(bm, spinner, 32120), 0.5, 1e-9, 'spinner 结束后 120ms alpha=0.5');
  approx(alphaAt(bm, spinner, 32240), 0, 1e-9, 'spinner 结束后 240ms alpha=0');
  assert(!isVisibleAt(bm, spinner, 32241), 'spinner 淡出结束后不渲染');
}

section('lifecycle: 常量与边界');
{
  assert(HIT_FADE === 240, 'HIT_FADE = 240ms');
  // 绿线变速: 在物件时刻加一条 2x SV 绿线, 时长应减半
  const bm2 = parseOsu(OSU.replace('1000,500,4,1,0,80,1,0', '1000,500,4,1,0,80,1,0\n9000,-50,4,2,0,80,0,0'));
  approx(hitObjectDuration(bm2, bm2.hitObjects[0]), 500, 1e-9, 'SV 2x 下滑条时长减半');
}

section('library: parseQuickMetadata');
{
  const meta = parseQuickMetadata(`osu file format v14

[Metadata]
Title:Some Title
TitleUnicode:某标题
Artist:Some Artist
ArtistUnicode:某艺术家
Creator:Mapper
Version:Insane

[Difficulty]
HPDrainRate:5
Mode:3
`);
  assert(meta.title === '某标题', 'TitleUnicode 优先于 Title');
  assert(meta.artist === '某艺术家', 'ArtistUnicode 优先于 Artist');
  assert(meta.creator === 'Mapper', 'Creator 解析');
  assert(meta.version === 'Insane', 'Version 解析');
  assert(meta.mode === 3, 'Mode 解析为 3');

  const meta2 = parseQuickMetadata('[Metadata]\nTitle:Plain\nArtist:PlainArtist\nCreator:C\nVersion:Easy\n');
  assert(meta2.title === 'Plain' && meta2.artist === 'PlainArtist', '无 Unicode 字段时回退普通字段');
  assert(meta2.mode === 0, '缺省 Mode=0 (std)');
}

section('library: 真实谱面元数据抽查 ($OSU_SONGS_DIR)');
{
  const SONGS = process.env.OSU_SONGS_DIR ?? '';
  if (fs.existsSync(SONGS)) {
    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 2 || files.length >= 20) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (files.length >= 20) break;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.osu')) files.push(p);
      }
    };
    walk(SONGS, 0);
    assert(files.length >= 5, '真实谱面样本 >= 5');
    let withTitle = 0;
    for (const f of files) {
      const meta = parseQuickMetadata(fs.readFileSync(f, 'utf8'));
      if (meta.title) withTitle++;
      // Version 在真实谱面中可能为空 (如 "+ - O.T.N"), 不作非空断言
    }
    assert(withTitle >= files.length * 0.8, `至少 80% 谱面解析出标题 (${withTitle}/${files.length})`);
    console.log(`  抽查 ${files.length} 个真实谱面, ${withTitle} 个有标题`);
  } else {
    console.log('  跳过: Songs 目录不存在');
  }
}

section('回归: renderer 已接入 lifecycle');
{
  const rendererPath = new URL('../../src/osu/renderer.ts', import.meta.url);
  const src = fs.readFileSync(rendererPath, 'utf8');
  assert(src.includes("from './lifecycle'"), 'renderer 引用 lifecycle');
  assert(src.includes('isVisibleAt') && src.includes('alphaAt'), 'renderer 使用 isVisibleAt/alphaAt');
  assert(!src.includes('endTime + 800') && !src.includes('end + 800'), '旧的 end+800ms 窗口已移除');
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 条断言失败`);
if (failures > 0) process.exit(1);
