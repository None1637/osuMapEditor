// v544: 实验被否决后冻结回退版；不得覆盖前两轮实验哈希。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'algorithm-fallback.json');
if (fs.existsSync(output)) throw new Error('algorithm-fallback.json 已存在，不覆盖。');
const files = ['src/osu/bpmResearch.ts', 'src/osu/bpmDetect.ts', 'src/osu/bpmVariableVerifier.ts', 'src/osu/fft.ts'];
const algorithm = Object.fromEntries(files.map(relative => {
  const absolute = path.resolve(root, '../..', relative);
  return [relative, { sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), bytes: fs.statSync(absolute).size }];
}));
fs.writeFileSync(output, JSON.stringify({ version: 'v544-fallback-to-v543-rules', algorithm }, null, 2));
console.log(JSON.stringify({ output, algorithm }, null, 2));
