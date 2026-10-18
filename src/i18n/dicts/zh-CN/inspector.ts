// v346: inspector 模块 (右侧物件详情面板) 简体中文词典分片
export const zhCN: Record<string, string> = {
  'inspector.hint_slider_node_control': '滑条节点控制：Alt+点选/框选，Shift+Alt 多选；按住 Alt 时可整体拖动 · 旋转 · 缩放（Esc 退出）',
  'inspector.hint_playfield_pan': '游玩区平移已开启：按住鼠标中键拖动游玩区，Alt+滚轮缩放游玩区大小',
  'inspector.transform_title': '变换 (选区)',
  'inspector.origin': '原点',
  'inspector.origin_selection': '选区',
  'inspector.origin_playfield': '中心',
  'inspector.origin_custom': '自定义',
  'inspector.rotate': '旋转',
  // v427: 按钮文案缩短 (en), 完整文案进 tooltip
  'inspector.rotate_ccw': '旋转',
  'inspector.rotate_ccw_tip': '逆时针旋转一次',
  'inspector.rotate_cw': '旋转',
  'inspector.rotate_cw_tip': '顺时针旋转一次',
  'inspector.scale': '缩放',
  'inspector.apply_scale': '应用倍率',
  'inspector.apply_scale_tip': '按输入倍率缩放 (仅X: y 填 1; 仅Y: x 填 1; 滑条长度同步)',
  'inspector.flip': '镜像',
  'inspector.flip_h': '水平',
  'inspector.flip_h_tip': '水平镜像 ({key})',
  'inspector.flip_v': '垂直',
  'inspector.flip_v_tip': '垂直镜像 ({key})',
  'inspector.transform_hotkeys_hint': '快捷键 {ccw}/{cw} 旋转90°, {flipH}/{flipV} 镜像, 围绕游玩区中心 (stable 同款); 上方按钮用所选原点; {reverse} 反转 (lazer 同款)',
  'inspector.mixed': '混合',
  'inspector.auto_inherit': 'Auto 继承',
  'inspector.whistle_tip': '口哨音 (W)',
  'inspector.finish_tip': 'Finish 音 (E)',
  'inspector.clap_tip': '拍手音 (R)',
  'inspector.sample_index': '采样序号',
  'inspector.volume': '音量',
  'inspector.sample_file': '采样文件: {filename}',
  'inspector.sliders_to_stream': '滑条转连打 ({n} 条)', // v429: 快捷键挪进 tooltip (v396 曾加在文本)
  'inspector.stream_tip': '把滑条转成连打单点 ({key})', // v429
  'inspector.arc_to_bezier': '圆弧→贝塞尔 ({n} 条)',
  'inspector.bspline_to_bezier': 'B 样条→贝塞尔 ({n} 条)', // v388: 选中集 B4 一键转 stable 兼容贝塞尔
  'inspector.bezier_to_bspline': '贝塞尔→B4 ({n} 条)', // v464: 反向 — 选中集贝塞尔一键转 B 样条
  'inspector.selected_n': '已选中 {n} 个物件',
  'inspector.no_selection': '未选中物件',
  'inspector.convert_title': '转换',
  'inspector.merge_to_slider': '合并为滑条',
  'inspector.generate_title': '生成',
  'inspector.polygon_generate': '多边形生成', // v429: 快捷键挪进 tooltip
  'inspector.polygon_tip': '生成多边形单点 ({key})', // v429
  'inspector.duplicate': '批量复制',
  'inspector.duplicate_count': '批量复制 ({n} 个)',
  'inspector.type_circle': '单点 Circle',
  'inspector.type_slider': '滑条 Slider',
  'inspector.type_spinner': '转盘 Spinner',
  'inspector.time': '时间',
  'inspector.curve_type': '曲线类型',
  'inspector.curve_linear': 'L 直线',
  'inspector.curve_perfect': 'P 圆弧',
  'inspector.curve_bezier': 'B 贝塞尔',
  'inspector.curve_catmull': 'C 卡特姆',
  'inspector.length': '长度',
  'inspector.repeats': '折返',
  'inspector.end_time': '结束时间',
  'inspector.new_combo': '新 Combo',
  'inspector.control_points': '控制点: {n}',
  'inspector.split_slider': '拆分滑条 (等时间)',
  // v409: 选中锚点处分割 (节点选区存在时显示)
  'inspector.split_at_anchors': '在锚点处分割',
  'inspector.symmetric_slider': '对称滑条',
  'inspector.delete': '删除', // v429: (Del) 挪进 tooltip
  'inspector.delete_tip': '删除选中物件 ({key})', // v429
  // v387: B 样条 curveType
  'inspector.curve_bspline': '{t} B 样条 (lazer)',
  'inspector.curve_bspline_hint': 'B 样条滑条 stable osu! 无法读取 (可用右侧警告条/作图菜单一键转贝塞尔)',
};
