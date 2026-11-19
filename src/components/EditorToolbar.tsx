import {
  ArrowUpRight,
  Check,
  Copy,
  Crop,
  Eraser,
  FilePlus2,
  Grid3x3,
  Loader2,
  RotateCcw,
  Save,
  Square,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  EDITOR_COLORS,
  STROKE_WIDTH_PRESETS,
  type CropRect,
  type EditorColor,
  type EditorTool,
  type StrokeWidthPreset,
} from '../types/editor';

interface EditorToolbarProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  color: EditorColor;
  onSelectColor: (color: EditorColor) => void;
  strokeWidth: StrokeWidthPreset;
  onSelectStrokeWidth: (width: StrokeWidthPreset) => void;
  hasDraftCrop: boolean;
  appliedCrop: CropRect | null;
  cropPixelSize: { width: number; height: number } | null;
  onConfirmCrop: () => void;
  onResetCrop: () => void;
  canUndo: boolean;
  hasChanges: boolean;
  onUndo: () => void;
  onClearAll: () => void;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomReset: () => void;
  isSaving: boolean;
  justCopied: boolean;
  onCopy: () => void;
  onSaveAsNew: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}

const TOOL_ITEMS: ReadonlyArray<{
  id: EditorTool;
  label: string;
  icon: typeof Crop;
}> = [
  { id: 'crop', label: '切り抜き', icon: Crop },
  { id: 'rect', label: '赤枠', icon: Square },
  { id: 'arrow', label: '矢印', icon: ArrowUpRight },
  { id: 'mosaic', label: 'モザイク', icon: Grid3x3 },
];

export function EditorToolbar({
  activeTool,
  onSelectTool,
  color,
  onSelectColor,
  strokeWidth,
  onSelectStrokeWidth,
  hasDraftCrop,
  appliedCrop,
  cropPixelSize,
  onConfirmCrop,
  onResetCrop,
  canUndo,
  hasChanges,
  onUndo,
  onClearAll,
  zoom,
  onZoomOut,
  onZoomIn,
  onZoomReset,
  isSaving,
  justCopied,
  onCopy,
  onSaveAsNew,
  onOverwrite,
  onCancel,
}: EditorToolbarProps) {
  const isShapeTool = activeTool === 'rect' || activeTool === 'arrow';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/95 px-4 py-2.5">
      {/* 左側: 描画ツール・色・太さ・Undo/クリア・ズーム */}
      <div className="flex flex-wrap items-center gap-2">
        {/* ツール選択 */}
        <div
          role="group"
          aria-label="編集ツール"
          className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5"
        >
          {TOOL_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTool === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTool(id)}
                aria-pressed={isActive}
                className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* 切り抜きコンテキスト操作 */}
        {activeTool === 'crop' && (
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-1.5 py-0.5">
            <button
              type="button"
              onClick={onConfirmCrop}
              disabled={!hasDraftCrop}
              title="切り抜き確定 (Enter)"
              className="inline-flex min-h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>切り抜き確定 (Enter)</span>
            </button>
            <button
              type="button"
              onClick={onResetCrop}
              disabled={!hasDraftCrop && !appliedCrop}
              title="切り抜き範囲をリセット"
              className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>リセット</span>
            </button>
            {cropPixelSize && (
              <span className="hidden px-1.5 font-mono text-[11px] text-slate-400 sm:inline">
                {cropPixelSize.width}×{cropPixelSize.height}
              </span>
            )}
          </div>
        )}

        {activeTool !== 'crop' && appliedCrop && (
          <div className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-950/35 px-2 py-1 text-[11px] text-emerald-200">
            <span>
              切り抜き{cropPixelSize ? `: ${cropPixelSize.width}×${cropPixelSize.height}` : '適用中'}
            </span>
            <button
              type="button"
              onClick={onResetCrop}
              aria-label="切り抜きをリセット"
              title="切り抜きをリセット"
              className="ml-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded p-0.5 text-emerald-300 transition hover:bg-emerald-900/70 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 色セレクタ */}
        <div
          role="group"
          aria-label="描画色"
          className={`flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 transition-opacity ${
            isShapeTool ? 'opacity-100' : 'opacity-50 hover:opacity-100'
          }`}
        >
          {EDITOR_COLORS.map((item) => {
            const isSelected = color === item.value;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectColor(item.value)}
                aria-label={`色: ${item.label}`}
                aria-pressed={isSelected}
                title={item.label}
                className={`relative flex min-h-6 min-w-6 items-center justify-center rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  item.value === '#111827' ? 'border-slate-500' : 'border-white/20'
                } ${
                  isSelected
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                    : 'hover:scale-105'
                }`}
                style={{ backgroundColor: item.value }}
              />
            );
          })}
        </div>

        {/* 線の太さセレクタ */}
        <div
          role="group"
          aria-label="線の太さ"
          className={`flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 transition-opacity ${
            isShapeTool ? 'opacity-100' : 'opacity-50 hover:opacity-100'
          }`}
        >
          {STROKE_WIDTH_PRESETS.map((preset) => {
            const isSelected = strokeWidth === preset.id;
            const dotSizeClass =
              preset.id === 'thin'
                ? 'h-1.5 w-1.5'
                : preset.id === 'medium'
                ? 'h-2 w-2'
                : 'h-2.5 w-2.5';
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectStrokeWidth(preset.id)}
                aria-pressed={isSelected}
                title={`線の太さ: ${preset.label}`}
                className={`inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  isSelected
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <span
                  className={`inline-block rounded-full bg-current ${dotSizeClass}`}
                  aria-hidden="true"
                />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        {/* Undo / すべてクリア */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="元に戻す (Ctrl+Z / ⌘Z)"
            aria-label="元に戻す"
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">戻す</span>
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={!hasChanges}
            title="すべてクリア"
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-rose-300 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">クリア</span>
          </button>
        </div>

        {/* ズームコントロール */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
          <button
            type="button"
            onClick={onZoomOut}
            title="縮小"
            aria-label="縮小"
            className="min-h-6 min-w-6 rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="min-w-[44px] text-center text-xs font-medium text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            title="拡大"
            aria-label="拡大"
            className="min-h-6 min-w-6 rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onZoomReset}
            title="100%にリセット"
            aria-label="100%にリセット"
            className="min-h-6 min-w-6 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 右端: 出力・完了アクション */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onCopy}
          title="編集した画像をクリップボードにコピー (Ctrl+C / ⌘C)"
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            justCopied
              ? 'bg-emerald-600 hover:bg-emerald-500'
              : 'bg-indigo-600 hover:bg-indigo-500'
          }`}
        >
          {justCopied ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>コピー済</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>コピー</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onSaveAsNew}
          disabled={isSaving}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>新規として保存</span>
        </button>

        <button
          type="button"
          onClick={onOverwrite}
          disabled={isSaving}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>上書き保存</span>
        </button>

        <button
          type="button"
          onClick={onCancel}
          title="編集をキャンセル (Esc)"
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span>キャンセル</span>
        </button>
      </div>
    </div>
  );
}
