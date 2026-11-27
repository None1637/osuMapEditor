// 共享端点逻辑: /api/local-fs/* (vite 中间件与 Electron 主进程共用)
// 唯一差异是 getDirs 数据源: dev 服务器读 local-dirs.json, exe 读 userData/settings.json
// ESM 格式: vite 打包配置时可直接内联; Electron 主进程经动态 import() 加载
// v323: 全部 fs 操作改异步 (fs.promises) — 曲库索引期间渲染端会连发数千个 list/file 请求,
//   旧实现 readdirSync/readFileSync 在 Electron 主进程同步执行, 事件循环被占满,
//   OS 判定窗口"未响应"且无法响应关闭/结束进程 (用户反馈: 无操作也卡死、杀不掉)
import fs from "node:fs"
import path from "node:path"

const JSON_TYPE = "application/json; charset=utf-8"
const TREE_CONCURRENCY = 16
const READ_BATCH_MAX = 16

/** v575: 一次请求返回曲库全部 .osu manifest; 不递归目录 symlink, 防循环 */
async function osuTree(rootAbs) {
  const pending = [rootAbs]
  const out = []
  let next = 0
  const worker = async () => {
    while (next < pending.length) {
      const dir = pending[next++]
      let entries
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) { pending.push(abs); continue }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.osu')) continue
        try {
          const st = await fs.promises.stat(abs)
          out.push({ rel: path.relative(rootAbs, abs).split(path.sep).join('/'), size: st.size, lastModified: Math.round(st.mtimeMs) })
        } catch { /* 文件消失/无权限时跳过 */ }
      }
    }
  }
  await Promise.all(Array.from({ length: TREE_CONCURRENCY }, worker))
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** v576: 按 Songs 顶层目录分页; 首屏不必等整棵曲库递归完成 */
async function osuTreePage(rootAbs, offset, limit) {
  const entries = await fs.promises.readdir(rootAbs, { withFileTypes: true })
  const dirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
  const page = dirs.slice(offset, offset + limit)
  const out = []
  let next = 0
  const worker = async () => {
    while (next < page.length) {
      const dir = path.join(rootAbs, page[next++].name)
      let children
      try { children = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of children) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.osu')) continue
        const abs = path.join(dir, entry.name)
        try {
          const st = await fs.promises.stat(abs)
          out.push({ rel: path.relative(rootAbs, abs).split(path.sep).join('/'), size: st.size, lastModified: Math.round(st.mtimeMs) })
        } catch { /* 文件消失/无权限时跳过 */ }
      }
    }
  }
  await Promise.all(Array.from({ length: TREE_CONCURRENCY }, worker))
  return { files: out.sort((a, b) => a.rel.localeCompare(b.rel)), total: dirs.length, nextOffset: offset + page.length < dirs.length ? offset + page.length : null }
}

/** v575: 有界批读, 单文件错误只跳过该项 */
async function readOsuBatch(rootAbs, files) {
  const out = await Promise.all(files.map(async rel => {
    const abs = path.resolve(rootAbs, rel)
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null
    try {
      const st = await fs.promises.stat(abs)
      if (!st.isFile()) return null
      const text = await fs.promises.readFile(abs, 'utf8')
      return { rel, text, size: st.size, lastModified: Math.round(st.mtimeMs) }
    } catch { return null }
  }))
  return out.filter(Boolean)
}

/**
 * @param {() => { songs: string | null, skin: string | null, external?: string | null }} getDirs 返回根目录 (null=未配置); v611: external = 显式选择的 Songs 外谱面目录
 * @returns {(method: string, pathname: string, searchParams: URLSearchParams, body?: Buffer) =>
 *   Promise<null | { status: number, contentType: string, body: Buffer | string }>}
 *   返回 null 表示非本 API, 交由下游 (静态服务/vite) 处理; v323 起为异步
 */
export function createLocalFsHandler(getDirs) {
  const json = (status, obj) => ({ status, contentType: JSON_TYPE, body: JSON.stringify(obj) })
  return async (method, pathname, searchParams, body) => {
    if (!pathname.startsWith("/api/local-fs/")) return null
    const dirs = getDirs()
    if (pathname === "/api/local-fs/config") {
      return json(200, {
        songsDir: dirs.songs, skinDir: dirs.skin,
        songsName: dirs.songs ? path.basename(dirs.songs) : null,
        skinName: dirs.skin ? path.basename(dirs.skin) : null,
      })
    }
    // 只允许访问配置的根目录之内, 拒绝 .. 越界; external 也必须先由主进程显式注册
    const root = searchParams.get("root")
    const configured = root === "songs" || root === "skin" || root === "external" ? dirs[root] : null
    if (!configured) return json(404, { error: "该 root 未配置" })
    const rootAbs = path.resolve(configured)
    const abs = path.resolve(rootAbs, searchParams.get("rel") ?? "")
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return json(403, { error: "路径越界" })
    if (pathname === "/api/local-fs/list") {
      let entries
      try { entries = await fs.promises.readdir(abs, { withFileTypes: true }) } catch { return json(404, { error: "目录不存在" }) }
      return json(200, entries.map(e => ({ name: e.name, kind: e.isDirectory() ? "directory" : "file" })))
    }
    if (pathname === "/api/local-fs/file") {
      let data, mtimeMs
      try {
        const st = await fs.promises.stat(abs) // v450: 顺带取真实 mtime
        if (!st.isFile()) return json(404, { error: "文件不存在" })
        data = await fs.promises.readFile(abs)
        mtimeMs = st.mtimeMs
      } catch { return json(404, { error: "文件不存在" }) }
      // v450: 响应头带真实 mtime — 前端 serverFile.getFile 构造 File 时写入 lastModified,
      //   v444 audioKey (name:size:lastModified) 在服务器模式由此稳定, 刷新谱面命中解码缓存;
      //   两个挂载点 (electron/main.cjs / vite.config.ts) 负责透传 headers
      return { status: 200, contentType: "application/octet-stream", body: data, headers: { "X-File-Mtime": String(Math.round(mtimeMs)) } }
    }
    if (pathname === "/api/local-fs/tree-page") {
      const parsedOffset = Number.parseInt(searchParams.get("offset") ?? "0", 10)
      const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "256", 10)
      const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0
      const limit = Number.isFinite(parsedLimit) ? Math.min(256, Math.max(1, parsedLimit)) : 256
      return json(200, await osuTreePage(rootAbs, offset, limit))
    }
    if (pathname === "/api/local-fs/tree") {
      return json(200, { files: await osuTree(rootAbs) })
    }
    if (pathname === "/api/local-fs/read-batch") {
      if (method !== "POST") return json(405, { error: "只支持 POST" })
      let files
      try { files = JSON.parse((body ?? Buffer.alloc(0)).toString('utf8')).files } catch { return json(400, { error: "非法 JSON" }) }
      if (!Array.isArray(files) || !files.length || files.length > READ_BATCH_MAX || files.some(f => typeof f !== 'string'))
        return json(400, { error: `文件批次需为 1..${READ_BATCH_MAX} 个路径` })
      return json(200, { files: await readOsuBatch(rootAbs, files) })
    }
    // Ctrl+S 保存谱面写回 (POST, body = 文件内容; 沿用上方越界防护, 只允许写根目录内的文件)
    if (pathname === "/api/local-fs/write") {
      if (method !== "POST" && method !== "PUT") return json(405, { error: "只支持 POST" })
      if (abs === rootAbs) return json(400, { error: "缺少文件路径" })
      if (!body || !body.length) return json(400, { error: "空内容" })
      try { await fs.promises.writeFile(abs, body) } catch (e) { return json(500, { error: "写入失败: " + (e?.message ?? e) }) }
      return json(200, { ok: true })
    }
    return json(404, { error: "unknown endpoint" })
  }
}
