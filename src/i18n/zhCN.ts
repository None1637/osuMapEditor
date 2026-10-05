// v346: 简体中文词典聚合 (各功能模块分片在 dicts/zh-CN/ 下, 由改造批次各自维护)
// key = 调用点 t(key, enDefault) 的符号键; value = 简体中文译文。
// 完整性由 verifier/v346 断言 (每个被调用的 key 必须在此有译文; 同 key 跨分片冲突报错)。
import { zhCN as app } from './dicts/zh-CN/app';
import { zhCN as library } from './dicts/zh-CN/library';
import { zhCN as hotkey } from './dicts/zh-CN/hotkey';
import { zhCN as display } from './dicts/zh-CN/display';
import { zhCN as skin } from './dicts/zh-CN/skin';
import { zhCN as inspector } from './dicts/zh-CN/inspector';
import { zhCN as timing } from './dicts/zh-CN/timing';
import { zhCN as geo } from './dicts/zh-CN/geo';
import { zhCN as transform } from './dicts/zh-CN/transform';
import { zhCN as convert } from './dicts/zh-CN/convert';
import { zhCN as setup } from './dicts/zh-CN/setup';
import { zhCN as pattern } from './dicts/zh-CN/pattern';
import { zhCN as timeline } from './dicts/zh-CN/timeline';
import { zhCN as panels } from './dicts/zh-CN/panels';
import { zhCN as backend } from './dicts/zh-CN/backend';

export const ZH_CN: Record<string, string> = Object.assign(
  {},
  app,
  library,
  hotkey,
  display,
  skin,
  inspector,
  timing,
  geo,
  transform,
  convert,
  setup,
  pattern,
  timeline,
  panels,
  backend,
);
