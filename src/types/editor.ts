export type EditorTool = 'crop' | 'rect' | 'ellipse' | 'arrow' | 'mosaic' | 'text';

export type StrokeWidthPreset = 'thin' | 'medium' | 'thick';

export type TextFontSizePreset = 'sm' | 'md' | 'lg';

export type TextBackgroundStyle = 'outline' | 'pill' | 'none';

export const EDITOR_COLORS = [
  { id: 'red', label: '赤', value: '#EF4444' },
  { id: 'yellow', label: '黄', value: '#EAB308' },
  { id: 'blue', label: '青', value: '#3B82F6' },
  { id: 'black', label: '黒', value: '#111827' },
  { id: 'white', label: '白', value: '#FFFFFF' },
] as const;

export type EditorColor = (typeof EDITOR_COLORS)[number]['value'];

export const STROKE_WIDTH_PRESETS: ReadonlyArray<{
  id: StrokeWidthPreset;
  label: string;
  ratio: number;
  minPx: number;
}> = [
  { id: 'thin', label: '細', ratio: 0.0025, minPx: 2 },
  { id: 'medium', label: '中', ratio: 0.005, minPx: 4 },
  { id: 'thick', label: '太', ratio: 0.009, minPx: 7 },
];

export const TEXT_FONT_SIZE_PRESETS: ReadonlyArray<{
  id: TextFontSizePreset;
  label: string;
  ratio: number;
  minPx: number;
}> = [
  { id: 'sm', label: '小', ratio: 0.022, minPx: 14 },
  { id: 'md', label: '中', ratio: 0.034, minPx: 20 },
  { id: 'lg', label: '大', ratio: 0.052, minPx: 30 },
];

export const TEXT_BACKGROUND_STYLES: ReadonlyArray<{
  id: TextBackgroundStyle;
  label: string;
}> = [
  { id: 'outline', label: '縁取り' },
  { id: 'pill', label: '背景あり' },
  { id: 'none', label: 'シンプル' },
];

/**
 * 元画像の幅・高さに対する正規化座標（0.0 〜 1.0）
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectAnnotation {
  id: string;
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: EditorColor;
  strokeWidth: StrokeWidthPreset;
}

export interface EllipseAnnotation {
  id: string;
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  color: EditorColor;
  strokeWidth: StrokeWidthPreset;
}

export interface ArrowAnnotation {
  id: string;
  type: 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: EditorColor;
  strokeWidth: StrokeWidthPreset;
}

export interface MosaicAnnotation {
  id: string;
  type: 'mosaic';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextAnnotation {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: EditorColor;
  fontSize: TextFontSizePreset;
  backgroundStyle: TextBackgroundStyle;
}

export type EditorAnnotation =
  | RectAnnotation
  | EllipseAnnotation
  | ArrowAnnotation
  | MosaicAnnotation
  | TextAnnotation;

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface EditorHistorySnapshot {
  annotations: EditorAnnotation[];
  appliedCrop: CropRect | null;
}
