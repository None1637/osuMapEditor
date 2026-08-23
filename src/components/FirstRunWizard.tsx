import { useEffect, useState } from 'react';
import { Music } from 'lucide-react'; // v181: 🎵 → lucide
import { getElectronAPI, ipcErrorMessage } from '../osu/electronBridge';
import { rememberSongsDir } from '../osu/library';
import { applyServerSkin } from '../osu/serverSkin';
import { serverDir } from '../osu/serverFs';

/**
 * exe 首跑配置向导 (仅 Electron 环境出现):
 * 选 osu! 目录 (原生对话框, 能拿绝对路径) → 选皮肤 → 保存到 settings.json → 进入曲库。
 * 之后每次启动由 App 启动恢复逻辑静默读盘, 不再需要本向导。
 */
export function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const api = getElectronAPI();
  const [osuPath, setOsuPath] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [skins, setSkins] = useState<string[]>([]);
  const [skinName, setSkinName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api?.getSettings().then(s => setSuggested(s.suggestedOsuPath)).catch(() => { });
  }, [api]);

  const pickDir = async () => {
    if (!api) return;
    setError(null);
    try {
      const r = await api.pickOsuDir(osuPath ?? suggested);
      if (!r) return; // 用户取消
      setOsuPath(r.osuPath);
      if (!r.hasSongs) {
        setError(`所选目录下没有 Songs 文件夹, 请选择 osu! 安装目录`);
        setSkins([]); setSkinName(null);
        return;
      }
      const list = await api.listSkinDirs(r.osuPath);
      setSkins(list);
      setSkinName(prev => prev && list.includes(prev) ? prev : (list[0] ?? null));
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const finish = async () => {
    if (!api || !osuPath) return;
    setBusy(true); setError(null);
    try {
      const r = await api.saveSettings({ osuPath, skinName });
      // 立即生效: 写入会话记忆 (与 App 启动恢复路径一致, 下次启动走 settings.json)
      rememberSongsDir(serverDir('songs', '', 'Songs'), null);
      if (r.skinDir) await applyServerSkin(r.skinName);
      onDone();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center">
      <div className="w-[520px] max-w-[92vw] bg-[#16161d] border border-[#333] rounded-lg flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#2c2c38]">
          <span className="text-sm font-semibold flex items-center gap-1.5"><Music className="w-4 h-4" />首次配置</span>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* 步骤 1: osu! 目录 */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-300 font-medium">① 选择 osu! 安装目录</div>
            <div className="text-[11px] text-slate-500 leading-4">
              包含 Songs / Skins 文件夹的目录{suggested ? ` (已探测到默认安装: ${suggested})` : ''}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium" onClick={pickDir}>
                {osuPath ? '重新选择…' : '选择 osu! 目录…'}
              </button>
              {osuPath && <span className="text-xs text-emerald-400 truncate">{osuPath}</span>}
            </div>
            {osuPath && !error && (
              <div className="text-[11px] text-slate-500">曲库目录: {osuPath}/Songs (自动选定) · 皮肤父目录: {osuPath}/Skins</div>
            )}
          </div>

          {/* 步骤 2: 皮肤 (选好 osu! 目录后出现) */}
          {osuPath && skins.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-slate-300 font-medium">② 选择皮肤</div>
              <div className="max-h-48 overflow-y-auto border border-[#2c2c38] rounded">
                {skins.map(name => (
                  <label key={name}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${skinName === name ? 'bg-[#e6437d]/25 text-white' : 'text-slate-300 hover:bg-[#22222c]'}`}>
                    <input type="radio" name="skin" checked={skinName === name} onChange={() => setSkinName(name)} />
                    <span className="truncate">{name}</span>
                  </label>
                ))}
                <label className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${skinName === null ? 'bg-[#e6437d]/25 text-white' : 'text-slate-300 hover:bg-[#22222c]'}`}>
                  <input type="radio" name="skin" checked={skinName === null} onChange={() => setSkinName(null)} />
                  <span className="text-slate-500">暂不选择 (使用默认皮肤)</span>
                </label>
              </div>
            </div>
          )}
          {osuPath && skins.length === 0 && !error && (
            <div className="text-[11px] text-slate-500">Skins 文件夹为空或不存在, 将使用默认皮肤</div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <button
            className="self-end px-5 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium disabled:opacity-40"
            disabled={!osuPath || busy}
            onClick={finish}>
            {busy ? '保存中…' : '完成, 进入曲库'}
          </button>
        </div>
      </div>
    </div>
  );
}
