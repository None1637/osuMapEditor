// v548: 汇总20首逐样本结果；同时给微合计、逐歌曲中位数与校准风险。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const selection = JSON.parse(readFileSync(join(root, 'selection.json'), 'utf8'));
const samples = selection.samples.map(selected => {
  const path = join(root, 'per-sample', `${selected.id}.json`);
  if (!existsSync(path)) throw new Error(`缺少 ${selected.id}`);
  return JSON.parse(readFileSync(path, 'utf8'));
});
const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q, lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(lower + 1, sorted.length - 1)] * fraction;
};
const subsets = {
  all: samples,
  constant: samples.filter(sample => !sample.referenceVariable),
  variable: samples.filter(sample => sample.referenceVariable),
  variableDenseSelection: samples.filter(sample => sample.selectionGroup === 'variable-dense-hash'),
  ownerConfirmedConstant: samples.filter(sample => sample.selectionGroup === 'owner-confirmed-constant'),
  calibrationWarning: samples.filter(sample => Math.abs(sample.globalDelay.delayMs) >= 60 || sample.globalDelay.delayMs < 0),
  calibrationNormal: samples.filter(sample => Math.abs(sample.globalDelay.delayMs) < 60 && sample.globalDelay.delayMs >= 0),
};
function micro(items, evaluation, region) {
  const totals = { count: 0, matched: 0, within5: 0 };
  for (const sample of items) {
    const metrics = evaluation(sample)[region];
    if (!metrics) continue;
    totals.count += metrics.count; totals.matched += metrics.matched; totals.within5 += metrics.within5;
  }
  return { ...totals, within5msAll: totals.count ? totals.within5 / totals.count : null, matchCoverage: totals.count ? totals.matched / totals.count : null };
}
function macro(items, actualEvaluation, nullEvaluation, region) {
  const eligible = items.filter(sample => actualEvaluation(sample)[region] && nullEvaluation(sample)[region]);
  const actualRates = eligible.map(sample => actualEvaluation(sample)[region].within5msAll);
  const advantages = eligible.map(sample => actualEvaluation(sample)[region].within5msAll - nullEvaluation(sample)[region].within5msAll);
  return {
    songCount: eligible.length,
    medianActualWithin5msAll: quantile(actualRates, 0.5),
    minActualWithin5msAll: quantile(actualRates, 0),
    maxActualWithin5msAll: quantile(actualRates, 1),
    medianActualMinusNull: quantile(advantages, 0.5),
    songsActualGreaterThanNull: advantages.filter(value => value > 1e-12).length,
    songsActualEqualNull: advantages.filter(value => Math.abs(value) <= 1e-12).length,
    songsActualLessThanNull: advantages.filter(value => value < -1e-12).length,
  };
}
const configurations = [];
for (const aggregate of ['max', 'top2']) {
  for (const method of ['independent', 'dp']) {
    const groups = {};
    for (const [subsetName, items] of Object.entries(subsets)) {
      const actual = sample => sample.configurations.find(config => config.aggregate === aggregate && config.method === method).actualCrossFit;
      const nullControl = sample => sample.configurations.find(config => config.aggregate === aggregate && config.method === method).nullCrossFit;
      const baseline = sample => sample.baselineGlobalOnly;
      groups[subsetName] = {
        sampleCount: items.length,
        all: { actual: micro(items, actual, 'all'), null: micro(items, nullControl, 'all'), baseline: micro(items, baseline, 'all'), macro: macro(items, actual, nullControl, 'all') },
        stable: { actual: micro(items, actual, 'stable'), null: micro(items, nullControl, 'stable'), baseline: micro(items, baseline, 'stable'), macro: macro(items, actual, nullControl, 'stable') },
        dense: { actual: micro(items, actual, 'dense'), null: micro(items, nullControl, 'dense'), baseline: micro(items, baseline, 'dense'), macro: macro(items, actual, nullControl, 'dense') },
      };
    }
    configurations.push({ aggregate, method, groups });
  }
}
const output = {
  version: 'v548-generalization-summary-v1',
  status: 'weak_label_consistency_not_independent_acoustic_accuracy',
  complete: samples.length === 20,
  sampleCount: samples.length,
  selection: selection.rule,
  excludedDevelopmentSamples: selection.excludedDevelopmentSamples,
  totalHitCount: samples.reduce((sum, sample) => sum + sample.hitCount, 0),
  totalDenseHitCount: samples.reduce((sum, sample) => sum + sample.denseHitCount, 0),
  songsWithDenseHits: samples.filter(sample => sample.denseHitCount > 0).map(sample => sample.id),
  calibrationWarnings: samples.filter(sample => Math.abs(sample.globalDelay.delayMs) >= 60 || sample.globalDelay.delayMs < 0).map(sample => ({
    id: sample.id,
    delayMs: sample.globalDelay.delayMs,
    reason: Math.abs(sample.globalDelay.delayMs) >= 60 ? 'global delay reached search boundary' : 'negative global delay unlike the common positive decoder delay',
    calibrationHitCount: sample.globalDelay.calibrationHitCount,
  })),
  configurations,
  samples: samples.map(sample => ({
    id: sample.id,
    selectionGroup: sample.selectionGroup,
    referenceVariable: sample.referenceVariable,
    referenceBpm: sample.referenceBpm,
    hitCount: sample.hitCount,
    denseHitCount: sample.denseHitCount,
    globalDelay: sample.globalDelay,
    baselineAll: sample.baselineGlobalOnly.all ?? null,
    baselineDense: sample.baselineGlobalOnly.dense ?? null,
  })),
};
writeFileSync(join(root, 'generalization-results.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ complete: output.complete, sampleCount: output.sampleCount, totalHitCount: output.totalHitCount, totalDenseHitCount: output.totalDenseHitCount, calibrationWarnings: output.calibrationWarnings }, null, 2));
console.log('V548_GENERALIZATION_SUMMARY_WRITTEN');
