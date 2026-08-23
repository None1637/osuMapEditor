// 服务器直读模式: local-dirs.json 配置目录后, 经 /api/local-fs/* 访问本地文件,
// 实现与 File System Access 相同的 FsDirLike 接口, 曲库扫描/皮肤加载等上层代码无感。
// 与浏览器授权模式互斥: 配置了服务器目录时优先使用 (见 App.tsx 启动恢复逻辑)。
import type { FsDirLike, FsFileLike } from './library';

export interface ServerDirs {
  songsDir: string | null;
  skinDir: string | null;
  songsName: string | null;
  skinName: string | null;
}

/** 读取服务器配置的曲库/皮肤目录; 未配置或端点不可用 (如纯静态部署) 返回 null */
export async function fetchServerDirs(): Promise<ServerDirs | null> {
  try {
    const res = await fetch('api/local-fs/config');
    if (!res.ok) return null;
    const cfg = await res.json() as ServerDirs;
    return cfg.songsDir || cfg.skinDir ? cfg : null;
  } catch {
    return null;
  }
}

function serverFile(root: 'songs' | 'skin', rel: string, name: string): FsFileLike {
  return {
    kind: 'file', name,
    async getFile() {
      const res = await fetch(`api/local-fs/file?root=${root}&rel=${encodeURIComponent(rel)}`);
      if (!res.ok) throw new Error(`读取失败 (${res.status}): ${rel}`);
      return new File([await res.blob()], name);
    },
  };
}

/** 服务器目录 -> FsDirLike (懒加载: entries()/getFile() 调用时才发请求) */
export function serverDir(root: 'songs' | 'skin', rel: string, name: string): FsDirLike {
  const childRel = (n: string) => (rel ? `${rel}/${n}` : n);
  return {
    kind: 'directory', name,
    serverRel: rel, // v77: Electron 菜单需要 Songs 内相对路径
    async *entries() {
      const res = await fetch(`api/local-fs/list?root=${root}&rel=${encodeURIComponent(rel)}`);
      if (!res.ok) throw new Error(`目录读取失败 (${res.status}): ${rel || '/'}`);
      const list = await res.json() as { name: string; kind: string }[];
      for (const e of list) {
        yield [e.name, e.kind === 'directory'
          ? serverDir(root, childRel(e.name), e.name)
          : serverFile(root, childRel(e.name), e.name)] as [string, FsDirLike | FsFileLike];
      }
    },
    // getFileHandle 不预先探测存在性; 不存在时 getFile() 才 reject,
    // 现有调用方 (findFileInDir / loadDifficulty / applySkinFromDir) 的 try/catch 均覆盖两者
    getFileHandle(n: string) {
      return Promise.resolve(serverFile(root, childRel(n), n));
    },
    // v67: Ctrl+S 保存谱面写回 (POST /api/local-fs/write, 服务端做越界防护)
    async writeFile(n: string, content: string) {
      const res = await fetch(`api/local-fs/write?root=${root}&rel=${encodeURIComponent(childRel(n))}`, { method: 'POST', body: content });
      if (!res.ok) throw new Error(`保存失败 (${res.status}): ${n}`);
    },
  };
}
