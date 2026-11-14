// v544: 在第二组验收前冻结算法哈希；已存在时拒绝覆盖。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'algorithm.json');
if (fs.existsSync(output)) throw new Error('algorithm.json 已存在，不覆盖冻结哈希。');
const files = ['src/osu/bpmResearch.ts', 'src/osu/bpmDetect.ts', 'src/osu/bpmVariableVerifier.ts', 'src/osu/fft.ts'];
const algorithm = Object.fromEntries(files.map(relative => {
  const absolute = path.resolve(root, '../..', relative);
  return [relative, { sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), bytes: fs.statSync(absolute).size }];
}));
fs.writeFileSync(output, JSON.stringify({ version: 'v544', algorithm }, null, 2));
console.log(JSON.stringify({ output, algorithm }, null, 2));
