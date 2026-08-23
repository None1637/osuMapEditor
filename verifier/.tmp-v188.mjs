// src/osu/parser.ts
function parseKV(line) {
  const i = line.indexOf(":");
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}
var nextId = 1;
function genId() {
  return nextId++;
}
var MODELED_SECTIONS = /* @__PURE__ */ new Set(["General", "Editor", "Metadata", "Difficulty", "TimingPoints", "HitObjects"]);
function parseOsu(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let section = "";
  const rawSections = {};
  const extraLines = {};
  const sectionOrder = [];
  const bm = {
    formatVersion: 14,
    general: { audioFilename: "audio.mp3", audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: "Normal", stackLeniency: 0.7, mode: 0, letterboxInBreaks: 0, widescreenStoryboard: 1, background: "" },
    editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 2, bookmarks: [] },
    metadata: { title: "", titleUnicode: "", artist: "", artistUnicode: "", creator: "", version: "", source: "", tags: "", beatmapID: "0", beatmapSetID: "-1" },
    difficulty: { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 },
    timingPoints: [],
    hitObjects: [],
    colors: { combos: [], sliderBorder: "", sliderTrackOverride: "" },
    rawSections,
    extraLines,
    sectionOrder
  };
  const pushExtra = (sec, line) => {
    (extraLines[sec] = extraLines[sec] || []).push(line);
  };
  const pushRaw = (sec, line) => {
    (rawSections[sec] = rawSections[sec] || []).push(line);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^osu file format v(\d+)/);
    if (m) {
      bm.formatVersion = parseInt(m[1]);
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      sectionOrder.push(section);
      continue;
    }
    if (section && !MODELED_SECTIONS.has(section)) {
      pushRaw(section, line);
      if (section === "Events") {
        const m2 = line.match(/^0,0,"?([^",]+)"?/);
        if (m2 && /\.(jpe?g|png|bmp|webp)$/i.test(m2[1])) bm.general.background = m2[1].trim();
      } else if (section === "Colours") {
        const [k, v] = parseKV(line);
        if (k.startsWith("Combo")) {
          const rgb = v.split(",").map((s) => parseInt(s.trim()) || 0);
          bm.colors.combos.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
        } else if (k === "SliderBorder") {
          const rgb = v.split(",").map((s) => parseInt(s.trim()) || 0);
          bm.colors.sliderBorder = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        } else if (k === "SliderTrackOverride") {
          const rgb = v.split(",").map((s) => parseInt(s.trim()) || 0);
          bm.colors.sliderTrackOverride = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        }
      }
      continue;
    }
    if (line.startsWith("//")) {
      pushExtra(section, line);
      continue;
    }
    if (section === "General") {
      const [k, v] = parseKV(line);
      if (k === "AudioFilename") bm.general.audioFilename = v;
      else if (k === "AudioLeadIn") bm.general.audioLeadIn = parseFloat(v) || 0;
      else if (k === "PreviewTime") bm.general.previewTime = parseFloat(v) || -1;
      else if (k === "Countdown") bm.general.countdown = parseInt(v) || 0;
      else if (k === "SampleSet") bm.general.sampleSet = v;
      else if (k === "StackLeniency") bm.general.stackLeniency = parseFloat(v) || 0;
      else if (k === "LetterboxInBreaks") bm.general.letterboxInBreaks = parseInt(v) || 0;
      else if (k === "WidescreenStoryboard") bm.general.widescreenStoryboard = parseInt(v) || 0;
      else if (k === "Mode") bm.general.mode = parseInt(v) || 0;
      else pushExtra(section, line);
    } else if (section === "Editor") {
      const [k, v] = parseKV(line);
      const n = parseFloat(v);
      if (k === "DistanceSpacing") bm.editor.distanceSpacing = n;
      else if (k === "BeatDivisor") bm.editor.beatDivisor = parseInt(v) || 4;
      else if (k === "GridSize") bm.editor.gridSize = n;
      else if (k === "TimelineZoom") bm.editor.timelineZoom = n;
      else if (k === "Bookmarks") bm.editor.bookmarks = v.split(",").map((s) => parseInt(s.trim())).filter((x) => isFinite(x));
      else pushExtra(section, line);
    } else if (section === "Metadata") {
      const [k, v] = parseKV(line);
      if (k === "Title") bm.metadata.title = v;
      else if (k === "TitleUnicode") bm.metadata.titleUnicode = v;
      else if (k === "Artist") bm.metadata.artist = v;
      else if (k === "ArtistUnicode") bm.metadata.artistUnicode = v;
      else if (k === "Creator") bm.metadata.creator = v;
      else if (k === "Version") bm.metadata.version = v;
      else if (k === "BeatmapID") bm.metadata.beatmapID = v;
      else if (k === "BeatmapSetID") bm.metadata.beatmapSetID = v;
      else if (k === "Source") bm.metadata.source = v;
      else if (k === "Tags") bm.metadata.tags = v;
      else pushExtra(section, line);
    } else if (section === "Difficulty") {
      const [k, v] = parseKV(line);
      const n = parseFloat(v);
      if (k === "HPDrainRate") bm.difficulty.hp = n;
      else if (k === "CircleSize") bm.difficulty.cs = n;
      else if (k === "OverallDifficulty") bm.difficulty.od = n;
      else if (k === "ApproachRate") bm.difficulty.ar = n;
      else if (k === "SliderMultiplier") bm.difficulty.sliderMultiplier = n;
      else if (k === "SliderTickRate") bm.difficulty.sliderTickRate = n;
      else pushExtra(section, line);
    } else if (section === "TimingPoints") {
      const p = line.split(",");
      if (p.length < 2) {
        pushExtra(section, line);
        continue;
      }
      bm.timingPoints.push({
        time: parseFloat(p[0]),
        beatLength: parseFloat(p[1]),
        meter: parseInt(p[2] ?? "4") || 4,
        sampleSet: parseInt(p[3] ?? "1") || 1,
        sampleIndex: parseInt(p[4] ?? "0") || 0,
        volume: p[5] === void 0 || p[5] === "" ? 100 : parseInt(p[5]),
        uninherited: p[6] !== "0",
        effects: parseInt(p[7] ?? "0") || 0
      });
    } else if (section === "HitObjects") {
      const obj = parseHitObjectLine(line);
      if (obj) bm.hitObjects.push(obj);
      else pushExtra(section, line);
    } else {
      if (section) pushExtra(section, line);
    }
  }
  if (!bm.colors.combos.length) bm.colors.combos = ["#FF69B4", "#46B4FF", "#FFD746", "#6BFF6B"];
  if (!bm.colors.sliderBorder) bm.colors.sliderBorder = "#FFFFFF";
  bm.hitObjects.sort((a, b) => a.time - b.time);
  bm.timingPoints.sort((a, b) => a.time - b.time);
  return bm;
}
function parseHitObjectLine(line) {
  const p = line.split(",");
  if (p.length < 5) return null;
  const x = parseFloat(p[0]), y = parseFloat(p[1]), time = parseFloat(p[2]);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(time)) return null;
  const typeFlags = parseInt(p[3]);
  const hitSound = parseInt(p[4]) || 0;
  const base = {
    id: genId(),
    type: "circle",
    x,
    y,
    time,
    hitSound,
    newCombo: !!(typeFlags & 4),
    comboSkip: typeFlags >> 4 & 7
  };
  if (typeFlags & 1) {
    base.type = "circle";
    base.hitSampleRaw = p[5];
    return base;
  }
  if (typeFlags & 2) {
    base.type = "slider";
    const curve = (p[5] ?? "L|0:0").split("|");
    base.curveType = curve[0];
    base.curvePoints = curve.slice(1).map((s) => {
      const [cx, cy] = s.split(":");
      return { x: parseFloat(cx), y: parseFloat(cy) };
    });
    base.slides = parseInt(p[6] ?? "1") || 1;
    base.length = parseFloat(p[7] ?? "100") || 100;
    base.edgeSoundsRaw = p[8];
    base.edgeSetsRaw = p[9];
    base.hitSampleRaw = p[10];
    return base;
  }
  if (typeFlags & 8) {
    base.type = "spinner";
    base.endTime = parseFloat(p[5] ?? String(time + 1e3)) || time + 1e3;
    base.hitSampleRaw = p[6];
    return base;
  }
  base.hitSampleRaw = p[5];
  return base;
}

// src/osu/displaySettings.ts
var LS_KEY = "osu-editor:display-settings";
function loadDisplaySettings() {
  const def = {
    skinColors: false,
    sliderPathLine: false,
    approachCircle: true,
    sliderFadeOut: true,
    hitExplosion: true,
    hitAnimation: true,
    bgBrightness: 35
    // v168: 旧固定 alpha 0.35
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw);
    return {
      skinColors: !!p.skinColors,
      sliderPathLine: !!p.sliderPathLine,
      approachCircle: p.approachCircle !== false,
      sliderFadeOut: p.sliderFadeOut !== false,
      hitExplosion: p.hitExplosion !== false,
      hitAnimation: p.hitAnimation !== false,
      bgBrightness: typeof p.bgBrightness === "number" && isFinite(p.bgBrightness) ? Math.max(0, Math.min(100, Math.round(p.bgBrightness))) : def.bgBrightness
      // v168: 钳制 0-100
    };
  } catch {
    return def;
  }
}
var displaySettings = loadDisplaySettings();

// src/osu/freehand/freehandFit.ts
var CIRCLE_PRESETS = [
  { arcLength: 0.4993379862754501, cps: [[1, 0], [1, 0.2549893626632736], [0.8778997558480327, 0.47884446188920726]] },
  { arcLength: 1.7579419829169447, cps: [[1, 0], [1, 0.6263026], [0.42931178, 1.0990661], [-0.18605515, 0.9825393]] },
  { arcLength: 3.1385246920140215, cps: [[1, 0], [1, 0.87084764], [2304826e-9, 1.5033062], [-0.9973236, 0.8739115], [-0.9999953, 0.0030679568]] },
  { arcLength: 5.69720464620727, cps: [[1, 0], [1, 1.4137783], [-1.4305235, 2.0779421], [-2.3410065, -0.94017583], [0.05132711, -1.7309346], [0.8331702, -0.5530167]] },
  { arcLength: 2 * Math.PI, cps: [[1, 0], [1, 1.2447058], [-0.8526471, 2.118367], [-2.6211002, 7854936e-12], [-0.8526448, -2.118357], [1, -1.2447058], [1, 0]] }
];

// src/osu/clock/hitSounds.ts
var HIT_SOUND_IDS = ["hitnormal", "hitwhistle", "hitfinish", "hitclap"];
var DEFAULT_SAMPLE_STEMS = ["normal", "soft", "drum"].flatMap((s) => HIT_SOUND_IDS.map((x) => `${s}-${x}`));
var DEFAULT_SLIDER_STEMS = ["normal", "soft", "drum"].flatMap((s) => ["slidertick", "sliderslide"].map((x) => `${s}-${x}`));

// src/osu/skin.ts
function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}
function drawHitcircle(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.1, r, r, r * 0.95);
  grad.addColorStop(0, "rgba(255,255,255,0.98)");
  grad.addColorStop(0.8, "rgba(245,245,245,0.98)");
  grad.addColorStop(0.96, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}
function drawOverlay(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.strokeStyle = "#ffffff";
  g.lineWidth = size * 0.045;
  g.shadowColor = "#ffffff";
  g.shadowBlur = size * 0.05;
  g.beginPath();
  g.arc(r, r, r * 0.92, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = size * 0.02;
  g.beginPath();
  g.arc(r, r, r * 0.97, 0, Math.PI * 2);
  g.stroke();
  return c;
}
function drawApproach(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = size * 0.035;
  g.beginPath();
  g.arc(r, r, r * 0.94, 0, Math.PI * 2);
  g.stroke();
  return c;
}
function drawSliderBall(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r * 0.85, r * 0.85, r * 0.05, r, r, r * 0.95);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.5, "#e9f6ff");
  grad.addColorStop(0.85, "#9ed5ff");
  grad.addColorStop(1, "rgba(110,180,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}
function drawFollow(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.3, r, r, r);
  grad.addColorStop(0, "rgba(255,220,120,0.22)");
  grad.addColorStop(0.9, "rgba(255,190,60,0.32)");
  grad.addColorStop(1, "rgba(255,190,60,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}
function drawScorePoint(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(r, r, r * 0.5, 0, Math.PI * 2);
  g.fill();
  return c;
}
function drawFollowPoint(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.2, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}
function drawReverse(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#ffffff";
  g.lineWidth = size * 0.07;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(r - r * 0.45, r - r * 0.5);
  g.lineTo(r + r * 0.4, r);
  g.lineTo(r - r * 0.45, r + r * 0.5);
  g.stroke();
  return c;
}
function drawSpinnerCircle(size) {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.2, r, r, r);
  grad.addColorStop(0, "rgba(255,160,60,0.55)");
  grad.addColorStop(0.85, "rgba(255,120,30,0.5)");
  grad.addColorStop(1, "rgba(255,120,30,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,200,150,0.9)";
  g.lineWidth = size * 0.01;
  g.beginPath();
  g.arc(r, r, r * 0.96, 0, Math.PI * 2);
  g.stroke();
  return c;
}
function drawSpinnerBackground(size) {
  const [c, g] = makeCanvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.7);
  grad.addColorStop(0, "rgba(0,20,40,0.55)");
  grad.addColorStop(1, "rgba(0,10,25,0.25)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
function drawDigit(size, d) {
  const [c, g] = makeCanvas(size);
  g.font = `bold ${size * 0.7}px "Venera", "Segoe UI", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(255,255,255,0.6)";
  g.shadowBlur = size * 0.03;
  g.fillText(String(d), size / 2, size / 2 + size * 0.02);
  return c;
}
var SKIN_FILES = [
  ["hitcircle", "hitcircle.png"],
  ["hitcircleoverlay", "hitcircleoverlay.png"],
  ["approachcircle", "approachcircle.png"],
  ["reversearrow", "reversearrow.png"],
  ["sliderstartcircle", "sliderstartcircle.png"],
  ["sliderstartcircleoverlay", "sliderstartcircleoverlay.png"],
  ["sliderendcircle", "sliderendcircle.png"],
  ["sliderendcircleoverlay", "sliderendcircleoverlay.png"],
  ["sliderb", "sliderb0.png"],
  ["sliderfollowcircle", "sliderfollowcircle.png"],
  ["sliderscorepoint", "sliderscorepoint.png"],
  ["followpoint", "followpoint.png"],
  ["spinnerCircle", "spinner-circle.png"],
  ["spinnerApproach", "spinner-approachcircle.png"],
  ["spinnerBackground", "spinner-background.png"]
];
var emptyImg = null;
function emptyImage() {
  if (!emptyImg) {
    emptyImg = document.createElement("canvas");
    emptyImg.width = emptyImg.height = 1;
  }
  return emptyImg;
}
function resolveSliderCircleFallback(skin, has, empty) {
  const pairs = [
    ["sliderstartcircle", "sliderstartcircleoverlay"],
    ["sliderendcircle", "sliderendcircleoverlay"]
  ];
  for (const [circle, overlay] of pairs) {
    if (has(circle)) {
      if (!has(overlay)) skin[overlay] = empty ?? emptyImage();
    } else {
      skin[circle] = skin.hitcircle;
      skin[overlay] = skin.hitcircleoverlay;
    }
  }
}
function createSkin() {
  const skin = makeProceduralBase();
  loadDefaultFilesInto(skin);
  return skin;
}
function makeProceduralBase() {
  const hitcircle = drawHitcircle(256);
  const overlay = drawOverlay(256);
  const sliderb = drawSliderBall(256);
  skinSpriteWidth.set(sliderb, 128);
  return {
    hitcircle,
    hitcircleoverlay: overlay,
    approachcircle: drawApproach(256),
    reversearrow: drawReverse(256),
    sliderstartcircle: hitcircle,
    sliderstartcircleoverlay: overlay,
    sliderendcircle: hitcircle,
    sliderendcircleoverlay: overlay,
    sliderb,
    sliderfollowcircle: drawFollow(256),
    sliderscorepoint: drawScorePoint(64),
    followpoint: drawFollowPoint(16),
    followpointFrames: [],
    followpointFrameMs: 1e3,
    spinnerCircle: drawSpinnerCircle(1024),
    spinnerApproach: drawApproach(512),
    spinnerBackground: drawSpinnerBackground(512),
    default0: Array.from({ length: 10 }, (_, i) => drawDigit(160, i)),
    comboColors: [],
    // v132: 程序化回退无皮肤颜色
    sliderBorder: null,
    sliderTrackOverride: null,
    hitCircleOverlap: null,
    // v170
    filesLoaded: false
  };
}
function loadDefaultFilesInto(skin) {
  const base = import.meta.env.BASE_URL || "/";
  const loadedKeys = /* @__PURE__ */ new Set();
  let pending = SKIN_FILES.length + 10;
  const done = () => {
    if (--pending === 0) {
      resolveSliderCircleFallback(skin, (k) => loadedKeys.has(k));
      skin.filesLoaded = true;
    }
  };
  for (const [key, file] of SKIN_FILES) {
    const img = new Image();
    img.onload = () => {
      skin[key] = img;
      loadedKeys.add(key);
      done();
    };
    img.onerror = done;
    img.src = `${base}skin/${file}`;
  }
  for (let i = 0; i < 10; i++) {
    const img = new Image();
    img.onload = () => {
      skin.default0[i] = img;
      done();
    };
    img.onerror = done;
    img.src = `${base}skin/default-${i}.png`;
  }
}
var singleton = null;
function getSkin() {
  if (!singleton) singleton = createSkin();
  return singleton;
}
var skinSourceName = "\u9ED8\u8BA4\u76AE\u80A4";
var skinObjectUrls = [];
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}
function fileVariants(file) {
  const out = [file.replace(/\.png$/i, "@2x.png"), file];
  if (file === "sliderb0.png") out.push("sliderb.png");
  return out;
}
var skinScaleAdjust = /* @__PURE__ */ new WeakMap();
var skinSpriteWidth = /* @__PURE__ */ new WeakMap();
var INTRINSIC_SIZE_KEYS = /* @__PURE__ */ new Set([
  "hitcircle",
  "hitcircleoverlay",
  "sliderstartcircle",
  "sliderstartcircleoverlay",
  "sliderendcircle",
  "sliderendcircleoverlay",
  "sliderb"
]);
function resetToProcedural() {
  const skin = getSkin();
  for (const u of skinObjectUrls) URL.revokeObjectURL(u);
  skinObjectUrls = [];
  Object.assign(skin, makeProceduralBase());
}
async function applySkinFromDir(dir, sourceName) {
  resetToProcedural();
  const skin = getSkin();
  const total = SKIN_FILES.length + 10;
  let loaded = 0;
  const loadName = async (name, assign) => {
    try {
      const f = await (await dir.getFileHandle(name)).getFile();
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      skinObjectUrls.push(url);
      assign(img);
      if (name.toLowerCase().endsWith("@2x.png")) skinScaleAdjust.set(img, 2);
      return true;
    } catch {
      return false;
    }
  };
  const iniTextP = (async () => {
    try {
      const f = await (await dir.getFileHandle("skin.ini")).getFile();
      return await f.text();
    } catch {
      return "";
    }
  })();
  const jobs = [];
  jobs.push((async () => {
    const cols = parseSkinIniColours(await iniTextP);
    skin.comboColors = cols.combos;
    skin.sliderBorder = cols.sliderBorder;
    skin.sliderTrackOverride = cols.sliderTrackOverride;
  })());
  const loadedKeys = /* @__PURE__ */ new Set();
  for (const [key, file] of SKIN_FILES) {
    if (key === "followpoint") continue;
    jobs.push((async () => {
      for (const name of fileVariants(file)) {
        if (await loadName(name, (img) => {
          skin[key] = img;
          if (INTRINSIC_SIZE_KEYS.has(key)) skinSpriteWidth.set(img, img.width / (name.toLowerCase().endsWith("@2x.png") ? 2 : 1));
        })) {
          loaded++;
          loadedKeys.add(key);
          return;
        }
      }
    })());
  }
  jobs.push((async () => {
    const fonts = parseSkinIniFonts(await iniTextP);
    skin.hitCircleOverlap = fonts.hitCircleOverlap;
    const prefix = fonts.hitCirclePrefix ?? "default";
    await Promise.all(Array.from({ length: 10 }, (_, i) => (async () => {
      const bases = prefix === "default" ? [`default-${i}.png`] : [`${prefix}-${i}.png`, `default-${i}.png`];
      for (const b of bases) {
        let got = false;
        for (const name of fileVariants(b)) {
          if (await loadName(name, (img) => {
            skin.default0[i] = img;
          })) {
            got = true;
            break;
          }
        }
        if (got) {
          loaded++;
          return;
        }
      }
    })()));
  })());
  jobs.push((async () => {
    const frames = [];
    for (let i = 0; i < 120; i++) {
      let got = false;
      for (const name of [`followpoint-${i}@2x.png`, `followpoint-${i}.png`]) {
        if (await loadName(name, (img) => {
          frames[i] = img;
        })) {
          got = true;
          break;
        }
      }
      if (!got) break;
    }
    if (frames.length) {
      const m = (await iniTextP).match(/^\s*AnimationFramerate\s*:\s*(\d+)/mi);
      const iniRate = m ? parseInt(m[1]) : 0;
      skin.followpointFrames = frames;
      skin.followpoint = frames[0];
      skin.followpointFrameMs = iniRate > 0 ? 1e3 / iniRate : 1e3 / frames.length;
      loaded++;
      return;
    }
    for (const name of ["followpoint@2x.png", "followpoint.png"]) {
      if (await loadName(name, (img) => {
        skin.followpoint = img;
      })) {
        loaded++;
        return;
      }
    }
  })());
  await Promise.all(jobs);
  resolveSliderCircleFallback(skin, (k) => loadedKeys.has(k));
  skin.filesLoaded = true;
  skinSourceName = sourceName;
  return { loaded, total };
}
function resetSkinToDefault() {
  resetToProcedural();
  skinSourceName = "\u9ED8\u8BA4\u76AE\u80A4";
  loadDefaultFilesInto(getSkin());
}
function parseSkinIniFonts(ini) {
  const out = { hitCirclePrefix: null, hitCircleOverlap: null };
  const sec = /^\s*\[Fonts\]\s*$/mi.exec(ini);
  if (!sec) return out;
  const body = ini.slice(sec.index + sec[0].length);
  const next = body.search(/^\s*\[/m);
  const lines = (next >= 0 ? body.slice(0, next) : body).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    if (/^HitCirclePrefix$/i.test(m[1])) out.hitCirclePrefix = m[2];
    else if (/^HitCircleOverlap$/i.test(m[1])) {
      const v = parseFloat(m[2]);
      if (isFinite(v)) out.hitCircleOverlap = v;
    }
  }
  return out;
}
function parseSkinIniColours(ini) {
  const out = { combos: [], sliderBorder: null, sliderTrackOverride: null };
  const sec = /^\s*\[Colours\]\s*$/mi.exec(ini);
  if (!sec) return out;
  const body = ini.slice(sec.index + sec[0].length);
  const next = body.search(/^\s*\[/m);
  const lines = (next >= 0 ? body.slice(0, next) : body).split(/\r?\n/);
  const hex = (v) => {
    const m = v.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const h = (n) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  };
  const comboMap = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const val = hex(m[2]);
    if (!val) continue;
    const cm = m[1].match(/^Combo(\d+)$/i);
    if (cm) {
      comboMap.set(+cm[1], val);
      continue;
    }
    if (/^SliderBorder$/i.test(m[1])) out.sliderBorder = val;
    else if (/^SliderTrackOverride$/i.test(m[1])) out.sliderTrackOverride = val;
  }
  out.combos = [...comboMap.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  return out;
}
if (typeof window !== "undefined") {
  window.__osuSkin = { applySkinFromDir, resetSkinToDefault, getSkin, skinScaleAdjust };
}

// src/osu/renderer.ts
function computeCombos(bm) {
  const m = /* @__PURE__ */ new Map();
  let combo = -1, idx = 0;
  for (const o of bm.hitObjects) {
    if (o.newCombo || combo === -1) {
      combo++;
      idx = 1;
    } else idx++;
    m.set(o.id, { combo, index: idx });
  }
  return m;
}
function comboColor(bm, combo, override) {
  const colors = override?.length ? override : bm.colors.combos.length ? bm.colors.combos : ["#FF69B4"];
  return colors[combo % colors.length];
}
export {
  comboColor,
  computeCombos,
  parseOsu
};
