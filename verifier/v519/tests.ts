// v519 纯函数: 默认模板/快照语义/局部几何编辑
import {
  captureTemplate, computeAnchorStamp, newRule, normalizeAnchorStampParams, resolveTemplate,
  type AnchorStampParams,
} from '../../src/osu/convert/anchorStamp';
import {
  contextStampPoint, deleteStampSelection, flipStamp, insertStampPoint, nudgeStamp, rotateStamp,
  stampEditState, toggleStampPoint,
} from '../../src/osu/convert/anchorStampTemplateEdit';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let n = 0;
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
  n++; console.log('  ok:', msg);
}

const a = newRule(1), b = newRule(2);
ok(a.template?.curveType === 'L' && a.template.points.length === 2, '新规则默认 L 两点');
ok(a.template!.points[0].x === 0 && a.template!.points[1].x === 64, '默认短直线 64px');
ok(a.uid !== b.uid, '规则 uid 稳定且唯一');
a.template!.points[0].x = 99;
ok(b.template!.points[0].x === 0, '默认模板点列不共享');
a.template!.points[0].x = 0;

const migrated = normalizeAnchorStampParams({
  rules: [{ ...newRule(1), uid: '', template: null }],
  keepDuration: true,
} as AnchorStampParams);
ok(migrated.rules[0].uid === 'legacy-0', '旧规则补 uid');
ok(migrated.rules[0].template?.points.length === 2, '旧空模板补两点直线');

let s = stampEditState(a.template!);
s = insertStampPoint(s, { x: 32, y: 20 });
ok(s.template.points.length === 3 && s.template.curveType === 'P', 'Ctrl 加点后三点自动圆弧');
const red = toggleStampPoint(s, 1);
ok(red?.template.points.length === 4, '白锚点转红生成重复点');
ok(red && red.template.points[1].x === red.template.points[2].x, '红锚点坐标成对');
const white = red && contextStampPoint(red, 1);
ok(white?.template.points.length === 3, '红锚点右键合并转白');
const deleted = white && deleteStampSelection({ ...white, selected: new Set([1]) });
ok(deleted?.template.points.length === 2, 'Delete 删除所选锚点');

const rot = rotateStamp(stampEditState(a.template!), 90);
ok(Math.abs(rot.template.points[0].x - 32) < 1e-9 && Math.abs(rot.template.points[1].x - 32) < 1e-9, '旋转 90° 后直线变竖线');
const flip = flipStamp(stampEditState(a.template!), 'h');
ok(flip.template.points[0].x === 64 && flip.template.points[1].x === 0, '水平镜像围绕模板中心');
const paired = stampEditState({ curveType: 'B', points: [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 0 }] });
paired.selected = new Set([1]);
const nudged = nudgeStamp(paired, 5, 7);
ok(nudged.template.points[1].x === 69 && nudged.template.points[2].x === 69
  && nudged.template.points[1].y === 7 && nudged.template.points[2].y === 7, '红锚点重复对跟随同一几何命令');

const red0: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 };
const main: HitObject = { id: 519001, type: 'slider', x: 100, y: 192, time: 1000, newCombo: true, comboSkip: 0, hitSound: 0,
  curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
const source: HitObject = { id: 519002, type: 'slider', x: 100, y: 400, time: 2000, newCombo: false, comboSkip: 0, hitSound: 0,
  curveType: 'P', curvePoints: [{ x: 140, y: 360 }, { x: 180, y: 400 }], slides: 1, length: 90 };
const bm = { timingPoints: [red0], hitObjects: [main, source], difficulty: { sliderMultiplier: 1.4 } } as Beatmap;
const rule = newRule(1);
rule.template = captureTemplate(source);
(rule as unknown as { srcId: number }).srcId = source.id; // 旧存档遗留字段必须无效
const params: AnchorStampParams = { rules: [rule], keepDuration: true };
const before = computeAnchorStamp(bm, main, params);
source.curvePoints = [{ x: 220, y: 250 }, { x: 300, y: 400 }];
const after = computeAnchorStamp(bm, main, params);
ok(resolveTemplate(rule) === rule.template, 'resolve 只读窗口快照');
ok(before.object?.length === after.object?.length, '源滑条后续编辑不影响盖章结果');
ok(before.object?.curvePoints?.length === after.object?.curvePoints?.length, '快照盖章锚点数稳定');

console.log(`V519_TESTS_PASSED (${n})`);
