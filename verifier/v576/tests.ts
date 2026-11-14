import { scanServerFileManifest } from '../../src/osu/serverLibraryIndex';

let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async url => {
  calls++;
  const offset = Number(new URL(String(url), 'http://localhost').searchParams.get('offset'));
  const files = offset === 0 ? [{ rel: 'a/a.osu', size: 1, lastModified: 1 }] : [{ rel: 'b/b.osu', size: 2, lastModified: 2 }];
  return new Response(JSON.stringify({ files, total: 2, nextOffset: offset === 0 ? 1 : null }));
};
try {
  const pages = [];
  const it = scanServerFileManifest(() => false);
  const first = await it.next();
  ok(first.done === false && first.value.length === 1 && first.value[0].rel === 'a/a.osu', '首批清单独立到达, 可立即生成骨架');
  ok(calls === 1, '显示首批时尚未请求后续页');
  for await (const page of { [Symbol.asyncIterator]: () => it }) pages.push(page);
  ok(calls === 2 && pages.length === 1 && pages[0][0].rel === 'b/b.osu', '按 nextOffset 续取至末页');
} finally { globalThis.fetch = originalFetch; }
console.log(`V576_TESTS_PASSED (${n})`);
