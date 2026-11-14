// v571: 一键导出full峰、重算主诊断/空对照并独立复验。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
function run(command, args, marker) {
  const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
execFileSync(esbuild, ['verifier/v571/export-peaks.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v571/.export-peaks.cjs', '--log-level=error'], { cwd: root, stdio: 'pipe' });
run(process.execPath, ['verifier/v571/.export-peaks.cjs'], 'V571_FULL_PEAKS_EXPORTED');
run('python', ['verifier/v571/diagnose.py'], 'V571_DIAGNOSTIC_WRITTEN');
run('python', ['verifier/v571/null-control.py'], 'V571_NULL_CONTROL_WRITTEN');
run('python', ['verifier/v571/check-results.py'], 'V571_RESULT_VALIDATION_PASSED');
run('python', ['verifier/v571/check-report.py'], 'V571_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V571_ALL_TESTS_PASSED');
