// v601: 超时旧 BASS 不得与 Web Audio 回退并存 + requestId 匹配
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { createBassAudio } from '../../electron/bassAudio.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fake = path.join(root, 'verifier/v601/fake-sidecar.mjs');
const logFile = path.join(root, 'verifier/v601/events.jsonl');
fs.rmSync(logFile, { force: true });
process.env.BASS_SIDECAR_EXE = process.execPath;
process.env.BASS_SIDECAR_ARGS = JSON.stringify([fake]);
process.env.FAKE_BASS_DELAY = '200';
process.env.BASS_PLAY_TIMEOUT_MS = '60';
const audio = createBassAudio({ isPackaged: false, getPath: () => path.join(root, 'verifier/v601') }, () => ({ songsDir: root }));
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const payload = { folderRel: '', audioFilename: 'package.json', offset: 0, rate: 0.25, volume: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const first = await audio.play(payload);
ok(first.ok === false && first.error === 'BASS play timeout', `超时返回失败 (${first.error})`);
process.env.BASS_PLAY_TIMEOUT_MS = '500';
const second = await audio.play(payload);
ok(second.ok === true && second.requestId === 2, `重启后只接受当前 requestId=2 (${JSON.stringify(second)})`);
await sleep(250);
const events = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
ok(events.filter(e => e.type === 'start').length === 2, `超时侧车被终止并重启 (start=${events.filter(e => e.type === 'start').length})`);
ok(events.filter(e => e.type === 'ack').length === 1 && events[events.length - 1]?.requestId === 2, '旧任务没有晚到成功 ack, 只有当前任务完成');
audio.dispose();

const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
const failAt = store.indexOf('const fail = () =>', store.indexOf('private startBass'));
ok(store.indexOf('void api.bassStop()', failAt) < store.indexOf('this.bassActive = false', failAt), '渲染端回退前无条件停止 BASS');
const sidecar = fs.readFileSync(path.join(root, 'native/BassAudioSidecar/Program.cs'), 'utf8');
ok((sidecar.match(/requestId, ok =/g) ?? []).length === 2, '真实侧车成功/失败 ack 都回传 requestId');

console.log(failures ? `VERIFIER_V601_FAILED: ${failures}` : 'VERIFIER_V601_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
