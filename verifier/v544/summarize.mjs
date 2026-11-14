// v544: 两组百首统一汇总；与 v543 并列比较，不重写旧结果。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const frozenAlgorithm = JSON.parse(fs.readFileSync(path.join(root, 'algorithm-fallback.json'), 'utf8')).algorithm;
const algorithmFrozen = Object.entries(frozenAlgorithm).every(([relative, expected]) => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root, '../..', relative))).digest('hex') === expected.sha256);
const percent = (n, d) => d ? +(100 * n / d).toFixed(1) : null;
const fraction = (n, d) => ({ numerator: n, denominator: d, percent: percent(n, d) });
function evaluate(manifest, predictionRoot) {
  return manifest.samples.map(sample => {
    const file = path.join(predictionRoot, `${sample.id}.json`);
    const record = fs.existsSync(file) ? { ...sample, ...JSON.parse(fs.readFileSync(file, 'utf8')) } : { ...sample, status: 'not_evaluated', prediction: null, referenceBpm: null, referenceVariable: null };
    const reference = Number(record.referenceBpm), predicted = Number(record.prediction?.bpm);
    const hasReference = Number.isFinite(reference) && reference > 0, hasPrediction = Number.isFinite(predicted) && predicted > 0;
    const relativeBpmError = hasReference && hasPrediction ? Math.abs(predicted / reference - 1) : null;
    const strictCorrect = relativeBpmError !== null && relativeBpmError <= 0.002;
    let octaveOnly = false;
    if (!strictCorrect && hasReference && hasPrediction) {
      const octave = Math.round(Math.log2(predicted / reference));
      octaveOnly = octave !== 0 && Math.abs(predicted / (reference * 2 ** octave) - 1) <= 0.002;
    }
    const classCorrect = typeof record.referenceVariable === 'boolean' && typeof record.prediction?.variable === 'boolean' && record.referenceVariable === record.prediction.variable;
    const bothCorrect = strictCorrect && classCorrect;
    let category = 'correct';
    if (!hasReference) category = 'invalid_reference';
    else if (record.status !== 'ok') category = record.status;
    else if (!strictCorrect && !classCorrect) category = 'bpm_and_classification_error';
    else if (!strictCorrect) category = octaveOnly ? 'octave_error' : 'bpm_error';
    else if (!classCorrect) category = record.referenceVariable ? 'variable_false_negative' : 'variable_false_positive';
    return { ...record, evaluation: { relativeBpmError, strictCorrect, octaveOnly, classCorrect, bothCorrect, category } };
  });
}
function summarize(name, manifest, predictionRoot) {
  const records = evaluate(manifest, predictionRoot);
  const count = predicate => records.filter(predicate).length;
  const confusion = { constant: { constant: 0, variable: 0, unavailable: 0 }, variable: { constant: 0, variable: 0, unavailable: 0 }, invalid_reference: { constant: 0, variable: 0, unavailable: 0 } };
  for (const record of records) {
    const actual = typeof record.referenceVariable === 'boolean' ? record.referenceVariable ? 'variable' : 'constant' : 'invalid_reference';
    const predicted = typeof record.prediction?.variable === 'boolean' ? record.prediction.variable ? 'variable' : 'constant' : 'unavailable';
    confusion[actual][predicted]++;
  }
  const byClass = variable => {
    const group = records.filter(record => record.referenceVariable === variable);
    return { total: group.length, strictMainBpm: fraction(group.filter(r => r.evaluation.strictCorrect).length, group.length), classification: fraction(group.filter(r => r.evaluation.classCorrect).length, group.length), both: fraction(group.filter(r => r.evaluation.bothCorrect).length, group.length) };
  };
  const statusCounts = {}, categoryCounts = {};
  for (const record of records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    categoryCounts[record.evaluation.category] = (categoryCounts[record.evaluation.category] ?? 0) + 1;
  }
  const metrics = {
    version: `v544-${name}`, sampleCount: records.length, algorithmFrozen, statusCounts, categoryCounts, confusion,
    allSamples: {
      strictMainBpm: fraction(count(r => r.evaluation.strictCorrect), records.length),
      variableClassification: fraction(count(r => r.evaluation.classCorrect), records.length),
      bothCorrect: fraction(count(r => r.evaluation.bothCorrect), records.length),
    },
    byReferenceClass: { constant: byClass(false), variable: byClass(true) },
    complete: records.length === 100 && records.every(r => r.status !== 'not_evaluated'),
  };
  return { records, metrics };
}
const devManifest = JSON.parse(fs.readFileSync(path.join(root, '../v541/manifest.json'), 'utf8'));
const dev = summarize('frozen-dev', devManifest, path.join(root, 'frozen-predictions-final'));
fs.writeFileSync(path.join(root, 'frozen-results.jsonl'), dev.records.map(r => JSON.stringify(r)).join('\n') + '\n');
const previous = JSON.parse(fs.readFileSync(path.join(root, '../v543/frozen-metrics.json'), 'utf8'));
dev.metrics.v543 = { allSamples: previous.allSamples, confusion: previous.confusion };
fs.writeFileSync(path.join(root, 'frozen-metrics.json'), JSON.stringify(dev.metrics, null, 2));
let heldout = null;
if (fs.existsSync(path.join(root, 'heldout-predictions-final'))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '../v543/heldout/manifest.json'), 'utf8'));
  heldout = summarize('heldout', manifest, path.join(root, 'heldout-predictions-final'));
  heldout.metrics.v543 = JSON.parse(fs.readFileSync(path.join(root, '../v543/heldout/metrics.json'), 'utf8')).allSamples;
  fs.writeFileSync(path.join(root, 'heldout-results.jsonl'), heldout.records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'heldout-metrics.json'), JSON.stringify(heldout.metrics, null, 2));
}
console.log(JSON.stringify({ algorithmFrozen, frozen: dev.metrics, heldout: heldout?.metrics ?? null }, null, 2));
