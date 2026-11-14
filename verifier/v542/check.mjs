// v542: 验证误报复核的样本数、独立指标、算法冻结与人工确认音频。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verifier = path.join(root, 'verifier/v542');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};
try {
  execFileSync(process.execPath, [path.join(verifier, 'audit-annotations.mjs')], { cwd: root, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(verifier, 'summarize-evidence.mjs')], { cwd: root, stdio: 'pipe' });
  const annotation = JSON.parse(fs.readFileSync(path.join(verifier, 'annotation-audit-summary.json'), 'utf8'));
  assert(annotation.cohort === 47, '误报 cohort 为 47 首');
  assert(annotation.withEvidenceMatchedMap === 0, '其他难度无直接局部变速佐证');
  assert(annotation.withOtherVariableMap === 1, 'sample-041 跨难度异常被保留');
  const summary = JSON.parse(fs.readFileSync(path.join(verifier, 'evidence-summary.json'), 'utf8'));
  assert(summary.samples === 47 && summary.evidence === 93, '47 首、93 个证据区完整');
  assert(summary.deterministic, '重跑 BPM 和 evidence 与 v541 一致');
  assert(summary.timeDomain.nullCombined === 0, '最终时域指标没有空值');
  assert(summary.timeDomain.mainAtLeastLocal + summary.timeDomain.localAboveMain === 93, '时域比较数量守恒');
  assert(summary.objectGrid.strongLocalEvidence === 2, '仅两个强局部对象网格证据');
  assert(summary.tripletCandidates.length === 3, '三个 1.5 倍三连音候选被列出');
  const clips = JSON.parse(fs.readFileSync(path.join(verifier, 'review-clips/manifest.json'), 'utf8'));
  assert(clips.length === 3, '三个人工确认片段已登记');
  for (const clip of clips) {
    const file = path.join(verifier, 'review-clips', clip.file);
    assert(fs.existsSync(file) && fs.statSync(file).size === 44 + clip.frames * 2, `${clip.id} WAV 长度正确`);
    assert(clip.frames > 0 && clip.peak > 0, `${clip.id} WAV 非空且非静音`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'verifier/v541/manifest.json'), 'utf8'));
  for (const [relative, expected] of Object.entries(manifest.algorithm)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    assert(hash === expected.sha256, `算法未修改：${relative}`);
  }
  const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
  execFileSync(esbuild, ['verifier/v542/analyze-evidence.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v542/.analyze-evidence.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
  assert(true, '独立复核器可由项目 esbuild 编译');
  assert(fs.existsSync(path.join(verifier, 'RESEARCH.md')), '猜想、工具错误与修复方案已记录');
} catch (error) {
  failures++;
  console.error(`FAIL: v542 验证异常\n${error.stdout ?? ''}${error.message}`);
}
console.log(failures ? `VERIFIER_V542_FAILED: ${failures}` : 'VERIFIER_V542_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
