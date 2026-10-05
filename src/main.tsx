import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { getElectronAPI } from '@/osu/electronBridge'

// v338: 全局错误上报 (Electron) — 远程用户白屏本地无法复现, 把 window error / unhandledrejection
// 写到 <userData>/crash.log。渲染循环里的异常会每帧刷屏, 按消息去重 + 5s 节流。
{
  const api = getElectronAPI();
  if (api) {
    let lastMsg = '', lastAt = 0;
    const report = (msg: string) => {
      const now = Date.now();
      if (msg === lastMsg && now - lastAt < 5000) return; // 同消息 5s 内只报一次
      lastMsg = msg; lastAt = now;
      api.reportError(msg.slice(0, 3500));
    };
    window.addEventListener('error', (e) => {
      report(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${(e.error as Error | undefined)?.stack ?? ''}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      report(`unhandledrejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`);
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
