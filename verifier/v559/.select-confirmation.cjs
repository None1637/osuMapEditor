// verifier/v559/select-confirmation.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v548 = (0, import_node_path.join)(root, "../v548");
var manifest = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "manifest.json"), "utf8"));
var previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "selection.json"), "utf8"));
var excluded = /* @__PURE__ */ new Set(["sample-001", "sample-058", ...previous.samples.map((item) => item.id)]);
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
var digest = (id) => (0, import_node_crypto.createHash)("sha256").update(`v559-confirmation:${id}`).digest("hex");
var hashOrder = (a, b) => digest(a.id).localeCompare(digest(b.id));
var pick = (pool, selectionGroup) => pool.sort(hashOrder).slice(0, 2).map((item) => ({ ...item, selectionGroup }));
var constant = pick(candidates.filter((item) => !item.referenceVariable), "constant-hash");
var variableDense = pick(candidates.filter((item) => item.referenceVariable && item.denseRedLineCount >= 2), "variable-dense-hash");
var variableOther = pick(candidates.filter((item) => item.referenceVariable && item.denseRedLineCount < 2), "variable-other-hash");
var samples = [...constant, ...variableDense, ...variableOther].sort((a, b) => a.id.localeCompare(b.id));
if (samples.length !== 6 || constant.length !== 2 || variableDense.length !== 2 || variableOther.length !== 2) throw new Error("\u786E\u8BA4\u96C6\u5206\u5C42\u4E0D\u8DB3");
if (samples.some((item) => excluded.has(item.id))) throw new Error("\u786E\u8BA4\u96C6\u6DF7\u5165\u65E7\u5F00\u53D1/\u8BC4\u4F30\u6B4C\u66F2");
var output = {
  version: "v559-future-independent-confirmation-selection-v1",
  status: "reserved_not_decoded_by_v559_not_evaluated_not_labeled",
  selectionUsesOnlyBeatmapLabels: true,
  excludedDevelopmentAndEvaluationSamples: [...excluded].sort(),
  rule: "From the original frozen 100-song sample, exclude 001/058 and all v548 songs; select two constant, two dense-variable and two other-variable songs by hash",
  hashNamespace: "sha256(v559-confirmation:sample-id), lexicographic",
  denseDefinition: "positive-duration uninherited redline with durationMs <=1200",
  intendedObjectsPerSong: 30,
  intendedTotalObjects: 180,
  samples
};
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "confirmation-selection.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ count: samples.length, constant: constant.map((item) => item.id), variableDense: variableDense.map((item) => item.id), variableOther: variableOther.map((item) => item.id) }, null, 2));
console.log("V559_CONFIRMATION_SELECTION_WRITTEN");
