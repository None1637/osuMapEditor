// v290: 曲库搜索查询解析与匹配 — 对齐 lazer FilterQueryParser.cs / BeatmapCarouselFilterMatching.cs 语义
// 纯函数模块 (无浏览器依赖, 可单测):
//   parseLibraryQuery(q)  — 查询串 -> 结构化 LibraryQuery (键值对过滤 + 自由文本 term + [diff] 段)
//   matchLibraryEntry(q, e) — 索引条目是否命中 (全部条件 AND)
// 不支持 (无本地数据源): status / played / lastplayed / ranked / created / divisor / ln
import type { LibraryIndexEntry } from './libraryIndex';

export interface QueryFilter {
  key: string;   // 小写
  op: string;    // = : != !: < <= <: > >= >:
  value: string; // 原始值 (去引号)
}

export interface FreeTerm {
  text: string;
  quoted: boolean;  // "..." → 词边界短语
  exact: boolean;   // "..."! → 整字段相等
}

export interface LibraryQuery {
  filters: QueryFilter[];
  terms: FreeTerm[];
  diff: string | null; // [Insane] 段 → 难度名过滤 (lazer 同款)
}

// v290: 支持的键表 (数值键带容差, 语义同 lazer)
const NUMERIC_KEYS: Record<string, { tol: number; get: (e: LibraryIndexEntry) => number | null }> = {
  star:  { tol: 0.005, get: e => e.star },  // 无星级数据 (mode≠0 或未算完) 不命中
  stars: { tol: 0.005, get: e => e.star },
  sr:    { tol: 0.005, get: e => e.star },
  ar:    { tol: 0.05, get: e => e.ar },
  cs:    { tol: 0.05, get: e => e.cs },
  od:    { tol: 0.05, get: e => e.od },
  hp:    { tol: 0.05, get: e => e.hp },
  dr:    { tol: 0.05, get: e => e.hp },
  bpm:   { tol: 0.5,  get: e => e.bpm },
};

// v290: 文本键 (仅 = / != 有效, : 同 =, !: 同 !=)
const TEXT_KEYS: Record<string, (e: LibraryIndexEntry) => string> = {
  creator: e => e.creator,
  author:  e => e.creator,
  mapper:  e => e.creator,
  artist:  e => `${e.artist} ${e.artistUnicode}`,
  title:   e => `${e.title} ${e.titleUnicode}`,
  diff:    e => e.version,
  source:  e => e.source,
  tag:     e => e.tags, // 词级子串匹配 (见 matchTextFilter)
};

const MODE_NAMES: Record<string, number> = { std: 0, osu: 0, taiko: 1, catch: 2, fruits: 2, mania: 3 };

// v290: key op value — key 小写 \w+; value 支持 "..." 引号短语 (引号串后可跟 !)
const FILTER_RE = /(\w+)\s*(!?=|!:|:|<=?|<:|>=?|>:)\s*(?:"([^"]*)"(!)?|([^\s"]+))/g;

export function parseLibraryQuery(q: string): LibraryQuery {
  const filters: QueryFilter[] = [];
  let rest = q;

  // 提取已识别的键值对; 未知键/非法 op 不退化 — 留作自由文本 term (与 lazer 退回自由文本一致)
  rest = rest.replace(FILTER_RE, (whole, key: string, op: string, qv: string | undefined, bang: string | undefined, bv: string | undefined) => {
    const k = key.toLowerCase();
    const value = qv ?? bv ?? '';
    const isEq = op === '=' || op === ':';
    const isNe = op === '!=' || op === '!:';
    if (NUMERIC_KEYS[k] || k === 'length' || k === 'keys') {
      if (!/^[0-9]/.test(value) && !/^\d/.test(value)) return whole; // 数值键的值必须是数字开头, 否则留作自由文本
      filters.push({ key: k, op, value });
      return ' ';
    }
    if (TEXT_KEYS[k]) {
      if (!isEq && !isNe) return whole; // 文本键仅 = / !=, 其他 op 留作自由文本
      filters.push({ key: k, op: isNe ? '!=' : '=', value: value + (bang ? '!' : '') });
      return ' ';
    }
    if (k === 'mode') {
      if (!isEq && !isNe) return whole;
      if (!(value.toLowerCase() in MODE_NAMES) && !/^[0-3]$/.test(value)) return whole;
      filters.push({ key: k, op: isNe ? '!=' : '=', value: value.toLowerCase() });
      return ' ';
    }
    return whole; // 未知键 → 留作自由文本
  });

  // [...] 段 → diff 过滤 (lazer 同款)
  let diff: string | null = null;
  rest = rest.replace(/\[([^\]]*)\]/g, (_w, inner: string) => {
    if (diff === null) diff = inner.trim();
    return ' ';
  });

  // 剩余文本: "..." 引号段独立 term (可跟 ! 表整字段相等); 其余按空格分词, 多 term AND
  const terms: FreeTerm[] = [];
  rest = rest.replace(/"([^"]*)"(!)?/g, (_w, phrase: string, bang: string | undefined) => {
    if (phrase) terms.push({ text: phrase.toLowerCase(), quoted: true, exact: !!bang });
    return ' ';
  });
  for (const t of rest.split(/\s+/)) {
    if (t) terms.push({ text: t.toLowerCase(), quoted: false, exact: false });
  }
  return { filters, terms, diff };
}

// ---------- 值解析 ----------
// v290: length 值格式 1:30 / 1h2m3s / 纯秒 → ms; 容差 = 最小单位一半
function parseLengthValue(v: string): { ms: number; tol: number } | null {
  let m = v.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) { // mm:ss 或 h:mm:ss — 最小单位秒
    const a = +m[1]!, b = +m[2]!, c = m[3] != null ? +m[3] : null;
    const ms = c != null ? (a * 3600 + b * 60 + c) * 1000 : (a * 60 + b) * 1000;
    return { ms, tol: 500 };
  }
  m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) {
    const ms = ((+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0))) * 1000;
    const tol = m[3] != null ? 500 : m[2] != null ? 30000 : 1800000; // 最小单位一半
    return { ms, tol };
  }
  const s = parseFloat(v);
  if (!Number.isFinite(s)) return null;
  return { ms: s * 1000, tol: 500 }; // 纯秒
}

// ---------- 匹配 ----------
// v290: 数值 op 语义: = → [v−tol, v+tol]; > → > v+tol; >= → ≥ v−tol; </<= 对称; != 反选
function matchNumeric(op: string, actual: number | null, v: number, tol: number): boolean {
  if (actual === null || !Number.isFinite(actual)) return false; // 无数据不命中
  switch (op) {
    case '=': case ':': return Math.abs(actual - v) <= tol;
    case '!=': case '!:': return Math.abs(actual - v) > tol;
    case '>': case '>:': return actual > v + tol;
    case '>=': return actual >= v - tol;
    case '<': case '<:': return actual < v - tol;
    case '<=': return actual <= v + tol;
    default: return false;
  }
}

function matchTextFilter(f: QueryFilter, e: LibraryIndexEntry): boolean {
  const field = TEXT_KEYS[f.key]!(e).toLowerCase();
  let v = f.value.toLowerCase();
  let exact = false;
  if (v.endsWith('!')) { exact = true; v = v.slice(0, -1); }
  let hit: boolean;
  if (f.key === 'tag') {
    // v290: tag 在 tags 字符串内做词级子串匹配
    hit = field.split(/\s+/).some(w => exact ? w === v : w.includes(v));
  } else {
    hit = exact ? field === v : field.includes(v);
  }
  return f.op === '!=' ? !hit : hit;
}

function matchFilter(f: QueryFilter, e: LibraryIndexEntry): boolean {
  if (NUMERIC_KEYS[f.key]) {
    const { tol, get } = NUMERIC_KEYS[f.key]!;
    return matchNumeric(f.op, get(e), parseFloat(f.value), tol);
  }
  if (f.key === 'length') {
    const p = parseLengthValue(f.value);
    return p ? matchNumeric(f.op, e.lengthMs, p.ms, p.tol) : false;
  }
  if (f.key === 'keys') {
    // v290: mania 键数 = cs 字段, 仅 mode=3 条目, 精确
    if (e.mode !== 3) return false;
    const n = parseInt(f.value);
    return matchNumeric(f.op, Number.isFinite(n) ? Math.round(e.cs) : null, n, 0);
  }
  if (f.key === 'mode') {
    const want = f.value in MODE_NAMES ? MODE_NAMES[f.value]! : parseInt(f.value);
    return f.op === '!=' ? e.mode !== want : e.mode === want;
  }
  return matchTextFilter(f, e);
}

// v290: 自由文本匹配字段 (大小写不敏感子串, AND); dirName 兼容旧目录名搜索习惯
function termFields(e: LibraryIndexEntry): string[] {
  return [e.title, e.titleUnicode, e.artist, e.artistUnicode, e.creator, e.version, e.source, e.tags, e.dirName]
    .map(s => s.toLowerCase());
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchTerm(t: FreeTerm, e: LibraryIndexEntry): boolean {
  const fields = termFields(e);
  if (t.exact) return fields.some(f => f === t.text); // "..."! → 整字段相等
  if (t.quoted) {
    // "..." → 词边界短语
    const re = new RegExp(`\\b${escapeRe(t.text)}\\b`, 'i');
    return fields.some(f => re.test(f));
  }
  if (fields.some(f => f.includes(t.text))) return true;
  // v290: 单个纯数字 term 且文本未命中 → 兜底匹配 beatmapID / beatmapSetID
  if (/^\d+$/.test(t.text)) return e.beatmapID === t.text || e.beatmapSetID === t.text;
  return false;
}

export function matchLibraryEntry(q: LibraryQuery, e: LibraryIndexEntry): boolean {
  if (q.diff !== null && !e.version.toLowerCase().includes(q.diff.toLowerCase())) return false;
  for (const f of q.filters) if (!matchFilter(f, e)) return false;
  for (const t of q.terms) if (!matchTerm(t, e)) return false;
  return true;
}
