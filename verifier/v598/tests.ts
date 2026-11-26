// v598: 用可控 Image 完成顺序复现默认皮肤晚到、并发换肤旧任务晚到
import { applySkinFromDir, getSkin, skinSourceName } from '../../src/osu/skin';
import type { FsDirLike } from '../../src/osu/library';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function fakeCanvas() {
  const canvas: Record<string, unknown> = { width: 1, height: 1 };
  const gradient = { addColorStop() { } };
  const ctx = new Proxy({ canvas }, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => { };
    },
    set(target, prop, value) { (target as Record<string | symbol, unknown>)[prop] = value; return true; },
  });
  canvas.getContext = () => ctx;
  return canvas;
}

const pending = new Set<MockImage>();
class MockImage {
  readonly width = 128;
  readonly height = 128;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(v: string) { this._src = v; pending.add(this); }
}

(globalThis as unknown as { document: unknown }).document = { createElement: () => fakeCanvas() };
(globalThis as unknown as { Image: unknown }).Image = MockImage;
let blobSeq = 0;
(URL as unknown as { createObjectURL: (f: { dir: string; name: string }) => string }).createObjectURL = f => `blob:${f.dir}:${f.name}:${++blobSeq}`;
(URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => { };

function mockDir(id: string): FsDirLike {
  const ini = `[Fonts]\nHitCircleOverlap: ${id === 'A' ? 11 : 22}\n`;
  const files = new Set(['sliderb0.png', 'default-0.png', 'skin.ini']);
  return {
    name: id,
    async getFileHandle(name: string) {
      if (!files.has(name)) throw new Error('missing');
      return {
        async getFile() {
          return { dir: id, name, text: async () => name === 'skin.ini' ? ini : '' } as unknown as File;
        },
      };
    },
  } as unknown as FsDirLike;
}

async function flush(predicate: (src: string) => boolean) {
  // 每轮先让文件读取 Promise 推进, 再完成当前已创建的图片; 无匹配图片时多等两轮收尾
  let quiet = 0;
  for (let round = 0; round < 30; round++) {
    await tick();
    const batch = [...pending].filter(img => predicate(img.src));
    if (!batch.length) { if (++quiet >= 3) return; continue; }
    quiet = 0;
    for (const img of batch) { pending.delete(img); img.onload?.(); }
  }
  throw new Error('图片任务未在限定轮次内完成');
}

const publicImage = (src: string) => src.startsWith('/skin/');
const blobFrom = (id: string) => (src: string) => src.startsWith(`blob:${id}:`);
const srcOf = (img: unknown) => (img as MockImage).src;

// 启动时默认皮肤请求先挂起; 自定义 first 全部完成后, 默认皮肤才晚到
const skin = getSkin();
const firstPromise = applySkinFromDir(mockDir('first'), 'first');
await flush(blobFrom('first'));
await firstPromise;
ok(srcOf(skin.default0[0]).startsWith('blob:first:default-0.png'), '自定义数字先加载完成');
ok(srcOf(skin.sliderb).startsWith('blob:first:sliderb0.png'), '自定义 sliderball 先加载完成');
await flush(publicImage);
ok(srcOf(skin.default0[0]).startsWith('blob:first:default-0.png'), '默认数字晚到不覆盖自定义数字');
ok(srcOf(skin.sliderb).startsWith('blob:first:sliderb0.png'), '默认 sliderball 晚到不覆盖自定义 sliderball');

// A 先开始、B 后开始; B 先完成, A 后完成。旧 A 不得覆盖 B 的贴图/ini/来源
const aPromise = applySkinFromDir(mockDir('A'), 'A');
const bPromise = applySkinFromDir(mockDir('B'), 'B');
await flush(blobFrom('B'));
await bPromise;
await flush(blobFrom('A'));
await aPromise;
ok(srcOf(skin.default0[0]).startsWith('blob:B:default-0.png'), '旧换肤任务晚到不覆盖新数字');
ok(srcOf(skin.sliderb).startsWith('blob:B:sliderb0.png'), '旧换肤任务晚到不覆盖新 sliderball');
ok(skin.hitCircleOverlap === 22, `旧任务不覆盖新 skin.ini (实际 ${skin.hitCircleOverlap})`);
ok(skinSourceName === 'B', `皮肤来源保持最后任务 B (实际 ${skinSourceName})`);

console.log(failures ? `V598_TESTS_FAILED: ${failures}` : 'V598_TESTS_PASSED');
if (failures) process.exit(1);
