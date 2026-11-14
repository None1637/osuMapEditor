// verifier/v548/select.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var manifest = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "manifest.json"), "utf8"));
var excluded = /* @__PURE__ */ new Set(["sample-001", "sample-058"]);
var forcedConstant = ["sample-032", "sample-034", "sample-088"];
var candidates = [];
for (const item of manifest.samples) {
  if (excluded.has(item.id) || !(0, import_node_fs.existsSync)((0, import_node_path.join)(v541, "decoded", item.id, "meta.json"))) continue;
  const predictionPath = (0, import_node_path.join)(v541, "predictions", `${item.id}.json`);
  if (!(0, import_node_fs.existsSync)(predictionPath)) continue;
  const prediction = JSON.parse((0, import_node_fs.readFileSync)(predictionPath, "utf8"));
  if (typeof prediction.referenceVariable !== "boolean" || !Array.isArray(prediction.redLines)) continue;
  candidates.push({
    id: item.id,
    referenceVariable: prediction.referenceVariable,
    denseRedLineCount: prediction.redLines.filter((line) => line.durationMs > 0 && line.durationMs <= 1200).length,
    redLineCount: prediction.redLines.length,
    referenceBpm: prediction.referenceBpm,
    directoryName: item.directoryName,
    beatmapFile: item.beatmapFile
  });
}
var hashOrder = (a, b) => (0, import_node_crypto.createHash)("sha256").update(`v548:${a.id}`).digest("hex").localeCompare((0, import_node_crypto.createHash)("sha256").update(`v548:${b.id}`).digest("hex"));
var forced = forcedConstant.map((id) => {
  const item = candidates.find((candidate) => candidate.id === id);
  if (!item || item.referenceVariable) throw new Error(`\u4EBA\u5DE5\u6052\u901F\u6837\u672C\u4E0D\u53EF\u7528\uFF1A${id}`);
  return { ...item, selectionGroup: "owner-confirmed-constant" };
});
var constantPool = candidates.filter((item) => !item.referenceVariable && !forcedConstant.includes(item.id)).sort(hashOrder).slice(0, 7).map((item) => ({ ...item, selectionGroup: "constant-hash" }));
var variableDense = candidates.filter((item) => item.referenceVariable && item.denseRedLineCount >= 2).sort(hashOrder).slice(0, 5).map((item) => ({ ...item, selectionGroup: "variable-dense-hash" }));
var variableOther = candidates.filter((item) => item.referenceVariable && item.denseRedLineCount < 2).sort(hashOrder).slice(0, 5).map((item) => ({ ...item, selectionGroup: "variable-other-hash" }));
var samples = [...forced, ...constantPool, ...variableDense, ...variableOther].sort((a, b) => a.id.localeCompare(b.id));
if (samples.length !== 20 || samples.filter((item) => !item.referenceVariable).length !== 10 || samples.filter((item) => item.referenceVariable).length !== 10 || variableDense.length !== 5 || variableOther.length !== 5) {
  throw new Error(`\u5206\u5C42\u9009\u6837\u5931\u8D25\uFF1A${samples.length}\uFF0Cdense=${variableDense.length}\uFF0Cother=${variableOther.length}`);
}
var output = {
  version: "v548-generalization-selection-v1",
  selectionUsesOnlyBeatmapLabels: true,
  excludedDevelopmentSamples: [...excluded],
  rule: "3 owner-confirmed constant + 7 hash-selected constant + 5 hash-selected variable with >=2 dense redlines + 5 hash-selected other variable; dense duration <=1200 ms",
  hashNamespace: "sha256(v548:sample-id), lexicographic",
  samples
};
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "selection.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ count: samples.length, constant: 10, variable: 10, variableDense: variableDense.map((item) => item.id), variableOther: variableOther.map((item) => item.id), constantIds: samples.filter((item) => !item.referenceVariable).map((item) => item.id) }, null, 2));
console.log("V548_SELECTION_WRITTEN");
