// 共享端点逻辑: /api/local-fs/* (vite 中间件与 Electron 主进程共用)
// 唯一差异是 getDirs 数据源: dev 服务器读 local-dirs.json, exe 读 userData/settings.json
// ESM 格式: vite 打包配置时可直接内联; Electron 主进程经动态 import() 加载
// v323: 全部 fs 操作改异步 (fs.promises) — 曲库索引期间渲染端会连发数千个 list/file 请求,
//   旧实现 readdirSync/readFileSync 在 Electron 主进程同步执行, 事件循环被占满,
//   OS 判定窗口"未响应"且无法响应关闭/结束进程 (用户反馈: 无操作也卡死、杀不掉)
import fs from "node:fs"
import path from "node:path"

const JSON_TYPE = "application/json; charset=utf-8"

/**
 * @param {() => { songs: string | null, skin: string | null }} getDirs 返回两个根目录 (null=未配置)
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
    // 只允许访问配置的两个根目录之内, 拒绝 .. 越界
    const root = searchParams.get("root")
    const configured = root === "songs" || root === "skin" ? dirs[root] : null
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
      let data
      try { data = await fs.promises.readFile(abs) } catch { return json(404, { error: "文件不存在" }) }
      return { status: 200, contentType: "application/octet-stream", body: data }
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
