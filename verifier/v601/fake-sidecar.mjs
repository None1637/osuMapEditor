// 可控假侧车: 延迟 play-ack, 供 v601 验证超时终止与 requestId
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const logFile = path.join(root, 'verifier/v601/events.jsonl');
const delay = Number(process.env.FAKE_BASS_DELAY ?? 200);
const log = value => fs.appendFileSync(logFile, JSON.stringify(value) + '\n');
log({ type: 'start' });
console.log(JSON.stringify({ type: 'ready' }));
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const cmd = JSON.parse(line);
    if (cmd.type === 'play') {
      setTimeout(() => {
        log({ type: 'ack', requestId: cmd.requestId });
        console.log(JSON.stringify({ type: 'play-ack', requestId: cmd.requestId, ok: true }));
      }, delay);
    } else if (cmd.type === 'shutdown') process.exit(0);
  }
});
