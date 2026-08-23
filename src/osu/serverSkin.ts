// 应用"服务器直读"皮肤目录的共用逻辑 (首跑向导 / 皮肤列表面板 / App 启动恢复)
import { store } from './store';
import { collectSampleFiles, rememberSkinDir } from './library';
import { applySkinFromDir, resetSkinToDefault } from './skin';
import { serverDir } from './serverFs';

/**
 * 应用服务器皮肤并写入会话记忆 (防 IndexedDB 旧记忆覆盖)。
 * skinName = null 时恢复默认皮肤 (public/skin + 程序化回退 + 内置 hitsound)。
 */
export async function applyServerSkin(skinName: string | null): Promise<void> {
  if (!skinName) {
    resetSkinToDefault();
    store.resetSkinSamples();
    store.emitPlayback();
    return;
  }
  const dir = serverDir('skin', '', skinName);
  await applySkinFromDir(dir, dir.name).catch(() => { });
  const samples = await collectSampleFiles(dir).catch(() => new Map<string, File>());
  if (samples.size) await store.applySkinSamples(samples).catch(() => 0);
  rememberSkinDir(dir, null);
  store.emitPlayback();
}
