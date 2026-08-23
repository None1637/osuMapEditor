import fs from "fs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { createLocalFsHandler } from "./server/localFsCore.mjs"

// ============================================================
// 服务器直读本地目录 (免浏览器授权, 启动即恢复)
// 在 app/local-dirs.json 配置曲库/皮肤绝对路径:
//   { "songsDir": "D:/Games/osu!/Songs", "skinDir": "D:/Games/osu!/Skins/xxx" }
// 前端经 /api/local-fs/* 访问; 留空或文件缺失则该功能自动关闭,
// 回退到 File System Access API (浏览器授权) 模式。
// 每次请求实时重读配置, 改路径不用重启服务器。
// 端点逻辑与 Electron 主进程共用: server/localFsCore.cjs
// ============================================================
const CONFIG_FILE = path.resolve(__dirname, "local-dirs.json")

type RootKey = "songs" | "skin"

function readLocalDirs(): Record<RootKey, string | null> {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>
    const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    return { songs: pick(cfg.songsDir), skin: pick(cfg.skinDir) }
  } catch {
    return { songs: null, skin: null }
  }
}

const handleLocalFs = createLocalFsHandler(() => readLocalDirs())

function localFsPlugin(): Plugin {
  return {
    name: "local-fs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "", "http://localhost")
        if (!url.pathname.startsWith("/api/local-fs/")) return next()
        // 收集请求体 (write 端点需要; GET 立即 end)
        const chunks: Buffer[] = []
        req.on("data", (c: Buffer) => chunks.push(c))
        req.on("end", () => {
          const r = handleLocalFs(req.method ?? "GET", url.pathname, url.searchParams, chunks.length ? Buffer.concat(chunks) : undefined)
          if (!r) return next()
          res.statusCode = r.status
          res.setHeader("Content-Type", r.contentType)
          res.end(r.body)
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), localFsPlugin()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
