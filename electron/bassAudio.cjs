// v599: 原生 BASS 侧车生命周期与 JSON 行协议 (仅供 Windows exe; 不可用时渲染端回退 Web Audio)
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const crypto = require("node:crypto")

function createBassAudio(app, readSettings, onPosition) {
  let proc = null
  let readyPromise = null
  let stdout = ""
  let ackQueue = []
  let playSeq = 0

  const exePath = () => app.isPackaged
    ? path.join(process.resourcesPath, "native", "BassAudioSidecar", "BassAudioSidecar.exe")
    : path.join(__dirname, "..", "native", "BassAudioSidecar", "publish", "BassAudioSidecar.exe")

  const rejectAcks = error => {
    for (const { reject } of ackQueue) reject(error)
    ackQueue = []
  }

  function ensureReady() {
    if (readyPromise) return readyPromise
    const exe = exePath()
    if (!fs.existsSync(exe)) return Promise.reject(new Error("BASS sidecar not found"))
    proc = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"] })
    readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("BASS sidecar ready timeout")), 8000)
      const onData = d => {
        stdout += d.toString()
        let nl
        while ((nl = stdout.indexOf("\n")) >= 0) {
          const line = stdout.slice(0, nl).trim()
          stdout = stdout.slice(nl + 1)
          if (!line) continue
          let msg
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.type === "ready") { clearTimeout(timer); resolve(); }
          if (msg.type === "init-error") { clearTimeout(timer); reject(new Error(msg.error)); }
          if (msg.type === "play-ack") {
            const i = ackQueue.findIndex(x => x.id === msg.requestId)
            if (i >= 0) ackQueue.splice(i, 1)[0].resolve(msg)
          }
          if (msg.type === "position") onPosition?.(msg) // v619
        }
      }
      proc.stdout.on("data", onData)
      proc.stderr.on("data", d => console.error("[bass]", d.toString().trim()))
      proc.once("error", e => { clearTimeout(timer); reject(e); })
      proc.once("exit", () => {
        clearTimeout(timer)
        proc = null; readyPromise = null
        rejectAcks(new Error("BASS sidecar exited"))
      })
    })
    // 初始化失败时允许下次播放重试, 不把 rejected Promise 永久缓存
    readyPromise.catch(() => { if (proc) proc.kill(); proc = null; readyPromise = null; }).catch(() => { })
    return readyPromise
  }

  async function play(payload) {
    try {
      if (!payload?.audioFilename) return { ok: false, error: "no native audio path" }
      let file
      if (payload.audioData) {
        // 非曲库来源: 原始字节哈希落盘, BASS 与曲库路径使用同一解码器
        const bytes = Buffer.from(payload.audioData)
        const ext = path.extname(payload.audioFilename).replace(/[^.\w]/g, '').slice(0, 12) || '.audio'
        const dir = path.join(app.getPath('userData'), 'bass-audio-cache')
        fs.mkdirSync(dir, { recursive: true })
        file = path.join(dir, crypto.createHash('sha256').update(bytes).digest('hex') + ext)
        if (!fs.existsSync(file)) fs.writeFileSync(file, bytes)
      } else {
        const root = readSettings().songsDir
        if (!root) return { ok: false, error: "no native audio path" }
        const absRoot = path.resolve(root)
        file = path.resolve(absRoot, payload.folderRel ?? "", payload.audioFilename)
        if (file !== absRoot && !file.startsWith(absRoot + path.sep)) return { ok: false, error: "audio path outside songs" }
      }
      if (!fs.existsSync(file)) return { ok: false, error: "audio file not found" }
      await ensureReady()
      return await new Promise((resolve, reject) => {
        const requestId = ++playSeq
        const timer = setTimeout(() => {
          ackQueue = ackQueue.filter(x => x.timer !== timer)
          resolve({ ok: false, error: "BASS play timeout" })
        }, 8000)
        ackQueue.push({ id: requestId, timer, resolve: msg => { clearTimeout(timer); resolve(msg) }, reject: e => { clearTimeout(timer); reject(e) } })
        proc.stdin.write(JSON.stringify({ type: "play", requestId, path: file, offset: payload.offset, rate: payload.rate, volume: payload.volume }) + "\n")
      })
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  }

  function stop() { if (proc) proc.stdin.write(JSON.stringify({ type: "stop" }) + "\n") }
  function volume(value) { if (proc) proc.stdin.write(JSON.stringify({ type: "volume", volume: value }) + "\n") }
  function dispose() { if (proc) { try { proc.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n"); proc.kill(); } catch { /* noop */ } } proc = null; readyPromise = null; rejectAcks(new Error("BASS disposed")) }
  return { play, stop, volume, dispose }
}

module.exports = { createBassAudio }
