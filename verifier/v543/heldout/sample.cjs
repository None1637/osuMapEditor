// v543-heldout: 固定种子抽取 100 个歌曲目录；外部文件只复制，所有解析均在项目副本上进行。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCE_ROOT = 'F:\\Backup\\D\\osu!\\Songs';
const SEED = 543;
const COUNT = 100;
const root = __dirname;
const sampleRoot = path.join(root, 'samples');
const manifestPath = path.join(root, 'manifest.json');

if (fs.existsSync(manifestPath)) {
  throw new Error('manifest.json 已存在；为保持冻结样本，本次不覆盖、不重新抽样。');
}
fs.mkdirSync(sampleRoot, { recursive: true });

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const directories = fs.readdirSync(SOURCE_ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);
for (let i = directories.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [directories[i], directories[j]] = [directories[j], directories[i]];
}

function audioFilename(osuText) {
  for (const line of osuText.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*AudioFilename\s*:\s*(.*?)\s*$/i);
    if (match) return match[1];
  }
  return '';
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function safeSourceAudio(directory, filename) {
  if (!filename) return null;
  const resolved = path.resolve(directory, filename);
  const prefix = path.resolve(directory) + path.sep;
  if (!resolved.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return resolved;
}

const samples = [];
let skippedWithoutBeatmap = 0;
const copyErrors = [];
for (const directoryName of directories) {
  if (samples.length >= COUNT) break;
  const sourceDirectory = path.join(SOURCE_ROOT, directoryName);
  let beatmaps;
  try {
    beatmaps = fs.readdirSync(sourceDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.osu'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en'));
  } catch (error) {
    copyErrors.push({ directoryName, stage: 'read_directory', error: String(error) });
    continue;
  }
  if (!beatmaps.length) {
    skippedWithoutBeatmap++;
    continue;
  }

  const id = `sample-${String(samples.length + 1).padStart(3, '0')}`;
  const destination = path.join(sampleRoot, id);
  fs.mkdirSync(destination, { recursive: true });
  const copiedBeatmaps = [];
  try {
    for (const name of beatmaps) {
      const target = path.join(destination, name);
      fs.copyFileSync(path.join(sourceDirectory, name), target);
      copiedBeatmaps.push(name);
    }
  } catch (error) {
    copyErrors.push({ directoryName, stage: 'copy_beatmap', error: String(error) });
    continue;
  }

  const selected = copiedBeatmaps[Math.floor(random() * copiedBeatmaps.length)];
  const selectedPath = path.join(destination, selected);
  const osuText = fs.readFileSync(selectedPath, 'utf8');
  const originalAudioFilename = audioFilename(osuText);
  const sourceAudio = safeSourceAudio(sourceDirectory, originalAudioFilename);
  const extension = originalAudioFilename ? path.extname(originalAudioFilename).toLowerCase() : '';
  const localAudioName = extension ? `audio${extension}` : null;
  let audioCopyStatus = 'missing_audio_filename';
  let audioCopyError = null;
  if (sourceAudio && localAudioName) {
    try {
      fs.copyFileSync(sourceAudio, path.join(destination, localAudioName));
      audioCopyStatus = 'copied';
    } catch (error) {
      audioCopyStatus = 'copy_failed';
      audioCopyError = String(error);
    }
  }
  samples.push({
    id,
    sourceDirectory,
    directoryName,
    beatmapFile: selected,
    allBeatmapFiles: copiedBeatmaps,
    originalAudioFilename,
    localAudioFile: localAudioName,
    audioExtension: extension,
    audioCopyStatus,
    audioCopyError,
    decodeSupported: ['.mp3', '.ogg', '.wav'].includes(extension),
  });
  console.log(`[${samples.length}/${COUNT}] ${id} ${directoryName}`);
}

if (samples.length !== COUNT) throw new Error(`仅获得 ${samples.length} 个有效歌曲目录，未达到 ${COUNT}。`);
const algorithmFiles = ['src/osu/bpmResearch.ts', 'src/osu/bpmDetect.ts', 'src/osu/bpmVariableVerifier.ts', 'src/osu/fft.ts'];
const algorithm = Object.fromEntries(algorithmFiles.map(relative => {
  const absolute = path.resolve(root, '../../..', relative);
  return [relative, { sha256: sha256(absolute), bytes: fs.statSync(absolute).size }];
}));
const manifest = {
  version: 'v543-heldout',
  seed: SEED,
  requestedCount: COUNT,
  sampleUnit: 'song-directory; one uniformly selected .osu difficulty per directory',
  eligibility: 'directory containing at least one .osu file; missing/unsupported audio remains in the sample',
  sourceRoot: SOURCE_ROOT,
  sourceDirectoryCount: directories.length,
  skippedWithoutBeatmap,
  copyErrors,
  evaluationRules: {
    mainBpm: 'duration-weighted dominant positive uninherited timing point; strict relative error <= 0.002',
    octaveOnly: 'reported separately; never counted as strict correct',
    annotatedVariable: 'any positive uninherited red-line BPM differs from dominant BPM by > 2%',
    denominator: 100,
    offset: 'not evaluated',
  },
  algorithm,
  samples,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifest: manifestPath, samples: samples.length, skippedWithoutBeatmap, copyErrors: copyErrors.length }, null, 2));
