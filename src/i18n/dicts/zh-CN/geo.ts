// 几何吸附面板 (GeoSnapPanel) zh-CN 词典分片
export const zhCN: Record<string, string> = {
  'geo.title': '几何辅助 (Geometry)',
  'geo.center_name': '圆心辅助点 (Points on Blanket Centers)',
  'geo.center_desc': '选中的三点圆弧滑条: 显示圆心 (青色点), 可吸附',
  'geo.circle_name': '三点圆 (Circles on 3-Point Sliders)',
  'geo.circle_desc': '选中的三点圆弧滑条: 显示完整外接圆 (红色虚线), 圆周可吸附',
  'geo.lines_name': '直线延伸线 (Lines on Linear Sliders)',
  'geo.lines_desc': '选中的直线滑条或以直线开头/结尾的滑条: 显示头尾延伸线 (红色虚线), 可吸附',
  'geo.toggle_on': '点击开启',
  'geo.toggle_off': '点击关闭',
  'geo.dist_name': '视觉间距辅助线 (Distance Guides)',
  'geo.dist_desc': '物件边缘外扩等距轮廓 (单点=圆环, 滑条=环带轮廓, 金色); 放置/拖动物件时物件中心吸附到环带线上 (阈值同物件吸附 6.4px)',
  'geo.hint': '辅助图形仅作用于选中的滑条; 放置/拖动物件与控制点时在 6.4px 内自动吸附 (同物件吸附阈值)。间距辅助线作用于单点+滑条, 同样支持吸附 (v139: 物件中心直接吸到可见环带线)。',
  'geo.scope_all': '当前显示的所有物件都显示辅助线/点',
  'geo.scope_selection': '仅当前选中物件, 与上次选中其他物件时的辅助线/点',
};
