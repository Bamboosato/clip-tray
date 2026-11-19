export type EditorTool = 'crop' | 'rect' | 'arrow' | 'mosaic';

export type StrokeWidthPreset = 'thin' | 'medium' | 'thick';

export const EDITOR_COLORS = [
  { id: 'red', label: '赤', value: '#EF4444' },
  { id: 'yellow', label: '黄', value: '#EAB308' },
  { id: 'blue', label: '青', value: '#3B82F6' },
  { id: 'black', label: '黒', value: '#111827' },
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

export type EditorAnnotation = RectAnnotation | ArrowAnnotation | MosaicAnnotation;

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface EditorHistorySnapshot {
  annotations: EditorAnnotation[];
  appliedCrop: CropRect | null;
}
