// v29 单元断言: 红锚点拖拽成对移动 (redPairPartner)
import { redPairPartner, isRedPairPoint } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

const pair = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
assert(redPairPartner(pair, 1) === 2, '对中第一个的配对是第二个');
assert(redPairPartner(pair, 2) === 1, '对中第二个的配对是第一个');
assert(redPairPartner(pair, 0) === null && redPairPartner(pair, 3) === null, '非对成员返回 null');

// 与头部成对 (0,1): 拖动第二个点头随之动
const headPair = [{ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }];
assert(redPairPartner(headPair, 1) === 0, '与头部成对: 配对下标为 0');
assert(redPairPartner(headPair, 0) === 1, '头部属于重复对时配对下标为 1');

// 白点 (无重复) 不属于任何对
const plain = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
assert(plain.every((_, i) => redPairPartner(plain, i) === null), '全白点列无配对');
assert(plain.every((_, i) => !isRedPairPoint(plain, i)), '全白点列无红对成员');

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
