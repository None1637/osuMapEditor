// v493: GitHub Releases 更新检测核心 (纯函数, main.cjs 动态 import; 可单测)
// 数据源: https://api.github.com/repos/None1637/osuMapEditor/releases/latest
// 注意: 仓库同时存在 v0.1.x 语义版本标签与 vXXX 构建标签 — 只认 x.y.z 语义版本 release,
//   非语义版本 tag 的 release 忽略 (返回 null = 无可用更新信息)。

/** 解析 release tag → [major, minor, patch]; 非语义版本 (如 "v492") 返回 null */
export function parseSemverTag(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(tag ?? '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/** latest 是否比 current 新 (同长数组逐位比较; 任一非法 → false) */
export function isNewer(latest, current) {
  if (!latest || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (latest[i] > current[i]) return true;
    if (latest[i] < current[i]) return false;
  }
  return false;
}

/**
 * 从 GitHub release JSON 提取更新信息; 无更新/非法 tag 返回 null。
 * 返回 { version, name, body, url, publishedAt } — body = 更新说明 (markdown 原文, 渲染端纯文本展示)。
 */
export function pickUpdateInfo(release, currentVersion) {
  if (!release || release.draft) return null;
  const latest = parseSemverTag(release.tag_name);
  const current = parseSemverTag(currentVersion);
  if (!isNewer(latest, current)) return null;
  return {
    version: latest.join('.'),
    name: String(release.name || release.tag_name || ''),
    body: String(release.body || ''),
    url: String(release.html_url || 'https://github.com/None1637/osuMapEditor/releases'),
    publishedAt: String(release.published_at || ''),
  };
}
