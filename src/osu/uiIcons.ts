// v524: 可配置 lucide 图标白名单 (配置仅存 lucide:Name, 不存组件函数)
import {
  ArrowRight, AudioWaveform, Box, Check, ChevronDown, ChevronRight, Circle, Crosshair, Disc, Download, Eye, EyeOff, FlipHorizontal2, FlipVertical2, FolderOpen, Globe,
  Grid3x3, Keyboard, Layers, LayoutDashboard, Lock, LockOpen, Magnet, MousePointer2, Move, Music, Package, Palette,
  Pause, Play, Plus, Redo2, RefreshCw, RotateCcw, RotateCw, Ruler, Settings2, Spline, Star, Target, TriangleAlert, Undo2, Upload,
  Volume2, X, ZoomIn, ZoomOut,
} from 'lucide-react';

export const UI_ICON_COMPONENTS: Record<string, typeof Play> = {
  Play, Pause, Plus, X, MousePointer2, Circle, Spline, Disc,
  Volume2, Keyboard, Eye, LayoutDashboard, RefreshCw, Globe,
  FolderOpen, Palette, Ruler, Lock, LockOpen, Move, Grid3x3, Crosshair, Target, Box,
  Magnet, Settings2, Package, AudioWaveform, Undo2, Redo2, RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, ArrowRight,
  ChevronDown, ChevronRight, Star, Music, TriangleAlert, Check, Layers, ZoomIn, ZoomOut, Upload, Download, EyeOff,
};
