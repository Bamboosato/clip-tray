import { useEffect, useId, useRef, useState } from 'react';
import type {
  CropHandle,
  CropRect,
  EditorAnnotation,
  EditorColor,
  EditorTool,
  StrokeWidthPreset,
  TextAnnotation,
  TextBackgroundStyle,
  TextFontSizePreset,
} from '../types/editor';
import {
  FULL_VIEW_RECT,
  drawArrowAnnotation,
  drawMosaicRegion,
  drawRectAnnotation,
  drawTextAnnotation,
  measureTextAnnotationBox,
  normalizeCropRect,
} from '../utils/imageEditor';

interface ImageEditorOverlayProps {
  imageUrl: string;
  alt: string;
  fallbackWidth: number;
  fallbackHeight: number;
  zoom: number;
  onWheelZoom: (e: React.WheelEvent) => void;
  activeTool: EditorTool;
  color: EditorColor;
  strokeWidth: StrokeWidthPreset;
  textFontSize: TextFontSizePreset;
  textBackgroundStyle: TextBackgroundStyle;
  cancelTextSignal: number;
  annotations: EditorAnnotation[];
  appliedCrop: CropRect | null;
  draftCrop: CropRect | null;
  onDraftCropChange: (crop: CropRect | null) => void;
  onAddAnnotation: (annotation: EditorAnnotation) => void;
  onUpdateAnnotation: (
    id: string,
    updater: (prev: EditorAnnotation) => EditorAnnotation
  ) => void;
  onDeleteAnnotation: (id: string) => void;
  onEditingTextChange: (isEditingText: boolean) => void;
  onPendingTextChange: (
    pending: { editingId: string | null; annotation: TextAnnotation } | null
  ) => void;
  onImageLoaded: (img: HTMLImageElement | null) => void;
}

interface ActiveTextEdit {
  editingId: string | null;
  x: number;
  y: number;
  value: string;
  color: EditorColor;
  fontSize: TextFontSizePreset;
  backgroundStyle: TextBackgroundStyle;
}

type CropHitResult =
  | { kind: 'handle'; handle: CropHandle }
  | { kind: 'move' }
  | null;

type ActiveDragState =
  | {
      mode: 'draw';
      pointerId: number;
      tool: 'rect' | 'arrow' | 'mosaic';
      startClientX: number;
      startClientY: number;
      startNormX: number;
      startNormY: number;
      hasMovedThreshold: boolean;
    }
  | {
      mode: 'text-drag';
      pointerId: number;
      annotation: TextAnnotation;
      startClientX: number;
      startClientY: number;
      startNormX: number;
      startNormY: number;
      origX: number;
      origY: number;
      hasMovedThreshold: boolean;
    }
  | {
      mode: 'crop-create';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startNormX: number;
      startNormY: number;
      initialDraftCrop: CropRect | null;
      hasMovedThreshold: boolean;
    }
  | {
      mode: 'crop-move';
      pointerId: number;
      startNormX: number;
      startNormY: number;
      startCrop: CropRect;
      initialDraftCrop: CropRect | null;
    }
  | {
      mode: 'crop-resize';
      pointerId: number;
      handle: CropHandle;
      startCrop: CropRect;
      initialDraftCrop: CropRect | null;
    };

const HANDLE_CURSORS: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCropHandlePoints(
  cx: number,
  cy: number,
  cw: number,
  ch: number
): Array<{ handle: CropHandle; x: number; y: number }> {
  return [
    { handle: 'nw', x: cx, y: cy },
    { handle: 'n', x: cx + cw / 2, y: cy },
    { handle: 'ne', x: cx + cw, y: cy },
    { handle: 'e', x: cx + cw, y: cy + ch / 2 },
    { handle: 'se', x: cx + cw, y: cy + ch },
    { handle: 's', x: cx + cw / 2, y: cy + ch },
    { handle: 'sw', x: cx, y: cy + ch },
    { handle: 'w', x: cx, y: cy + ch / 2 },
  ];
}

function hitTestCrop(
  px: number,
  py: number,
  crop: CropRect | null,
  canvasWidth: number,
  canvasHeight: number
): CropHitResult {
  if (!crop || crop.width <= 0 || crop.height <= 0) return null;

  const cx = crop.x * canvasWidth;
  const cy = crop.y * canvasHeight;
  const cw = crop.width * canvasWidth;
  const ch = crop.height * canvasHeight;

  const hitRadius = 14;
  let bestHandle: CropHandle | null = null;
  let bestDist = Infinity;

  for (const pt of getCropHandlePoints(cx, cy, cw, ch)) {
    if (Math.abs(px - pt.x) <= hitRadius && Math.abs(py - pt.y) <= hitRadius) {
      const dist = Math.hypot(px - pt.x, py - pt.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestHandle = pt.handle;
      }
    }
  }

  if (bestHandle) {
    return { kind: 'handle', handle: bestHandle };
  }

  if (px >= cx && px <= cx + cw && py >= cy && py <= cy + ch) {
    return { kind: 'move' };
  }

  return null;
}

export function ImageEditorOverlay({
  imageUrl,
  alt,
  fallbackWidth,
  fallbackHeight,
  zoom,
  onWheelZoom,
  activeTool,
  color,
  strokeWidth,
  textFontSize,
  textBackgroundStyle,
  cancelTextSignal,
  annotations,
  appliedCrop,
  draftCrop,
  onDraftCropChange,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onEditingTextChange,
  onPendingTextChange,
  onImageLoaded,
}: ImageEditorOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tempMosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const textFormRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textInputId = useId();

  const onImageLoadedRef = useRef(onImageLoaded);
  const onAddAnnotationRef = useRef(onAddAnnotation);
  const onUpdateAnnotationRef = useRef(onUpdateAnnotation);
  const onDeleteAnnotationRef = useRef(onDeleteAnnotation);
  const onEditingTextChangeRef = useRef(onEditingTextChange);
  const onPendingTextChangeRef = useRef(onPendingTextChange);
  const activeTextEditRef = useRef<ActiveTextEdit | null>(null);
  const lastTextClickRef = useRef<{ id: string; time: number } | null>(null);
  const lastCancelSignalRef = useRef(cancelTextSignal);
  const prevTextOpenRef = useRef(false);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [naturalSize, setNaturalSize] = useState({
    width: Math.max(1, fallbackWidth),
    height: Math.max(1, fallbackHeight),
  });
  const [isImageReady, setIsImageReady] = useState(false);
  const [draftAnnotation, setDraftAnnotation] = useState<EditorAnnotation | null>(null);
  const [hoverCursor, setHoverCursor] = useState('crosshair');
  const [activeTextEdit, setActiveTextEdit] = useState<ActiveTextEdit | null>(null);
  const [draggingText, setDraggingText] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredTextId, setHoveredTextId] = useState<string | null>(null);

  useEffect(() => {
    onImageLoadedRef.current = onImageLoaded;
  }, [onImageLoaded]);

  useEffect(() => {
    onAddAnnotationRef.current = onAddAnnotation;
  }, [onAddAnnotation]);

  useEffect(() => {
    onUpdateAnnotationRef.current = onUpdateAnnotation;
  }, [onUpdateAnnotation]);

  useEffect(() => {
    onDeleteAnnotationRef.current = onDeleteAnnotation;
  }, [onDeleteAnnotation]);

  useEffect(() => {
    onEditingTextChangeRef.current = onEditingTextChange;
  }, [onEditingTextChange]);

  useEffect(() => {
    onPendingTextChangeRef.current = onPendingTextChange;
  }, [onPendingTextChange]);

  activeTextEditRef.current = activeTextEdit;

  const openTextEdit = (next: ActiveTextEdit) => {
    activeTextEditRef.current = next;
    setActiveTextEdit(next);
    onEditingTextChangeRef.current(true);
  };

  const closeTextEdit = () => {
    activeTextEditRef.current = null;
    setActiveTextEdit(null);
    onEditingTextChangeRef.current(false);
    onPendingTextChangeRef.current(null);
  };

  const commitTextEdit = (editState: ActiveTextEdit) => {
    const hasContent = editState.value.trim().length > 0;
    if (editState.editingId !== null) {
      if (hasContent) {
        onUpdateAnnotationRef.current(editState.editingId, (prev) =>
          prev.type === 'text'
            ? {
                ...prev,
                text: editState.value,
                color: editState.color,
                fontSize: editState.fontSize,
                backgroundStyle: editState.backgroundStyle,
              }
            : prev
        );
      } else {
        onDeleteAnnotationRef.current(editState.editingId);
      }
    } else if (hasContent) {
      onAddAnnotationRef.current({
        id: crypto.randomUUID(),
        type: 'text',
        x: editState.x,
        y: editState.y,
        text: editState.value,
        color: editState.color,
        fontSize: editState.fontSize,
        backgroundStyle: editState.backgroundStyle,
      });
    }
    closeTextEdit();
  };

  // ツールバーのスタイル変更を編集中テキストにリアルタイム反映
  useEffect(() => {
    setActiveTextEdit((prev) => (prev ? { ...prev, color } : null));
  }, [color]);

  useEffect(() => {
    setActiveTextEdit((prev) =>
      prev ? { ...prev, fontSize: textFontSize } : null
    );
  }, [textFontSize]);

  useEffect(() => {
    setActiveTextEdit((prev) =>
      prev ? { ...prev, backgroundStyle: textBackgroundStyle } : null
    );
  }, [textBackgroundStyle]);

  // 編集中テキストの状態・未確定内容の親への通知
  useEffect(() => {
    onEditingTextChangeRef.current(activeTextEdit !== null);
    if (activeTextEdit && activeTextEdit.value.trim().length > 0) {
      onPendingTextChangeRef.current({
        editingId: activeTextEdit.editingId,
        annotation: {
          id: activeTextEdit.editingId ?? 'pending-text',
          type: 'text',
          x: activeTextEdit.x,
          y: activeTextEdit.y,
          text: activeTextEdit.value,
          color: activeTextEdit.color,
          fontSize: activeTextEdit.fontSize,
          backgroundStyle: activeTextEdit.backgroundStyle,
        },
      });
    } else {
      onPendingTextChangeRef.current(null);
    }
  }, [activeTextEdit]);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      onEditingTextChangeRef.current(false);
      onPendingTextChangeRef.current(null);
    };
  }, []);

  // 親モーダルからの Esc キャンセルシグナルを処理
  useEffect(() => {
    if (cancelTextSignal !== lastCancelSignalRef.current) {
      lastCancelSignalRef.current = cancelTextSignal;
      closeTextEdit();
    }
  }, [cancelTextSignal]);

  // テキスト入力開始時に自動フォーカス
  useEffect(() => {
    const isOpen = activeTextEdit !== null;
    if (isOpen && !prevTextOpenRef.current) {
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          const len = ta.value.length;
          ta.setSelectionRange(len, len);
        }
      });
    }
    prevTextOpenRef.current = isOpen;
  }, [activeTextEdit]);

  // 画像URL切り替え時のリセットおよびキャッシュ済み画像の即時検出
  useEffect(() => {
    setNaturalSize({
      width: Math.max(1, fallbackWidth),
      height: Math.max(1, fallbackHeight),
    });
    setDraftAnnotation(null);
    setDraggingText(null);
    setHoveredTextId(null);
    activeDragRef.current = null;
    closeTextEdit();

    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setNaturalSize({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      setIsImageReady(true);
      onImageLoadedRef.current(img);
    } else {
      setIsImageReady(false);
      onImageLoadedRef.current(null);
    }

    return () => {
      onImageLoadedRef.current(null);
    };
  }, [imageUrl, fallbackWidth, fallbackHeight]);

  // コンテナサイズの監視
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ツール変更時にドラッグ中の未確定描画をクリア、テキスト入力中なら確定
  useEffect(() => {
    activeDragRef.current = null;
    setDraftAnnotation(null);
    setDraggingText(null);
    setHoveredTextId(null);
    if (activeTool !== 'text' && activeTextEditRef.current) {
      commitTextEdit(activeTextEditRef.current);
    }
    setHoverCursor(activeTool === 'text' ? 'text' : 'crosshair');
  }, [activeTool]);

  const viewRect =
    activeTool !== 'crop' && appliedCrop ? appliedCrop : FULL_VIEW_RECT;

  const visibleNatW = Math.max(1, naturalSize.width * viewRect.width);
  const visibleNatH = Math.max(1, naturalSize.height * viewRect.height);
  const availW = Math.max(80, containerSize.width - 32);
  const availH = Math.max(80, containerSize.height - 32);
  const maxAutoScale = activeTool !== 'crop' && appliedCrop ? 2.5 : 1;
  const baseScale = Math.min(
    availW / visibleNatW,
    availH / visibleNatH,
    maxAutoScale
  );
  const displayWidth = Math.max(1, Math.round(visibleNatW * baseScale * zoom));
  const displayHeight = Math.max(1, Math.round(visibleNatH * baseScale * zoom));

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNaturalSize({
      width: img.naturalWidth || Math.max(1, fallbackWidth),
      height: img.naturalHeight || Math.max(1, fallbackHeight),
    });
    setIsImageReady(true);
    onImageLoadedRef.current(img);
  };

  // Canvas へのリアルタイム再描画
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas) return;

    const maxDim = Math.max(displayWidth, displayHeight, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 4096 / maxDim);
    canvas.width = Math.max(1, Math.round(displayWidth * dpr));
    canvas.height = Math.max(1, Math.round(displayHeight * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const canDrawMosaic = Boolean(
      img && isImageReady && img.complete && img.naturalWidth > 0
    );

    if (canDrawMosaic && img) {
      if (!tempMosaicCanvasRef.current) {
        tempMosaicCanvasRef.current = document.createElement('canvas');
      }
      const tempCanvas = tempMosaicCanvasRef.current;

      // 1. モザイク（確定済み＋ドラッグ中）
      for (const annotation of annotations) {
        if (annotation.type === 'mosaic') {
          drawMosaicRegion(
            ctx,
            img,
            annotation,
            viewRect,
            displayWidth,
            displayHeight,
            tempCanvas
          );
        }
      }
      if (draftAnnotation && draftAnnotation.type === 'mosaic') {
        drawMosaicRegion(
          ctx,
          img,
          draftAnnotation,
          viewRect,
          displayWidth,
          displayHeight,
          tempCanvas
        );
        const dx = ((draftAnnotation.x - viewRect.x) / viewRect.width) * displayWidth;
        const dy = ((draftAnnotation.y - viewRect.y) / viewRect.height) * displayHeight;
        const dw = (draftAnnotation.width / viewRect.width) * displayWidth;
        const dh = (draftAnnotation.height / viewRect.height) * displayHeight;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.restore();
      }
    }

    // 2. 矩形・矢印（確定済み＋ドラッグ中）
    const natW = naturalSize.width;
    const natH = naturalSize.height;

    for (const annotation of annotations) {
      if (annotation.type === 'rect') {
        drawRectAnnotation(
          ctx,
          annotation,
          viewRect,
          displayWidth,
          displayHeight,
          natW,
          natH
        );
      } else if (annotation.type === 'arrow') {
        drawArrowAnnotation(
          ctx,
          annotation,
          viewRect,
          displayWidth,
          displayHeight,
          natW,
          natH
        );
      }
    }

    if (draftAnnotation) {
      if (draftAnnotation.type === 'rect') {
        drawRectAnnotation(
          ctx,
          draftAnnotation,
          viewRect,
          displayWidth,
          displayHeight,
          natW,
          natH
        );
      } else if (draftAnnotation.type === 'arrow') {
        drawArrowAnnotation(
          ctx,
          draftAnnotation,
          viewRect,
          displayWidth,
          displayHeight,
          natW,
          natH
        );
      }
    }

    // 3. テキスト注釈（編集中対象は二重表示防止のためスキップ）
    for (const annotation of annotations) {
      if (annotation.type !== 'text') continue;
      if (activeTextEdit && activeTextEdit.editingId === annotation.id) continue;

      const effectiveAnn =
        draggingText && draggingText.id === annotation.id
          ? { ...annotation, x: draggingText.x, y: draggingText.y }
          : annotation;

      drawTextAnnotation(
        ctx,
        effectiveAnn,
        viewRect,
        displayWidth,
        displayHeight,
        natW,
        natH
      );

      if (
        activeTool === 'text' &&
        !activeTextEdit &&
        hoveredTextId === annotation.id
      ) {
        const metrics = measureTextAnnotationBox(
          ctx,
          effectiveAnn,
          viewRect,
          displayWidth,
          displayHeight,
          natW,
          natH
        );
        ctx.save();
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(
          metrics.x - 2,
          metrics.y - 2,
          metrics.width + 4,
          metrics.height + 4
        );
        ctx.restore();
      }
    }

    // 4. 切り抜きオーバーレイ（8方向ハンドル・三分割ガイド・サイズ表示）
    if (activeTool === 'crop' && draftCrop && draftCrop.width > 0 && draftCrop.height > 0) {
      const cx = draftCrop.x * displayWidth;
      const cy = draftCrop.y * displayHeight;
      const cw = draftCrop.width * displayWidth;
      const ch = draftCrop.height * displayHeight;

      // 選択範囲外を暗くマスク
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
      ctx.beginPath();
      ctx.rect(0, 0, displayWidth, displayHeight);
      ctx.rect(cx, cy, cw, ch);
      ctx.fill('evenodd');
      ctx.restore();

      // 三分割ガイド線
      if (cw >= 24 && ch >= 24) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + cw / 3, cy);
        ctx.lineTo(cx + cw / 3, cy + ch);
        ctx.moveTo(cx + (cw * 2) / 3, cy);
        ctx.lineTo(cx + (cw * 2) / 3, cy + ch);
        ctx.moveTo(cx, cy + ch / 3);
        ctx.lineTo(cx + cw, cy + ch / 3);
        ctx.moveTo(cx, cy + (ch * 2) / 3);
        ctx.lineTo(cx + cw, cy + (ch * 2) / 3);
        ctx.stroke();
        ctx.restore();
      }

      // 枠線（視認性のため暗色外枠＋白枠）
      ctx.save();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.restore();

      // 8方向ハンドル
      const handleSize = 10;
      const halfHandle = handleSize / 2;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      for (const pt of getCropHandlePoints(cx, cy, cw, ch)) {
        const hx = clampRange(pt.x - halfHandle, 1, Math.max(1, displayWidth - handleSize - 1));
        const hy = clampRange(pt.y - halfHandle, 1, Math.max(1, displayHeight - handleSize - 1));
        ctx.fillRect(hx, hy, handleSize, handleSize);
        ctx.strokeRect(hx, hy, handleSize, handleSize);
      }
      ctx.restore();

      // 切り抜きピクセルサイズバッジ
      const cropPxW = Math.max(1, Math.round(draftCrop.width * natW));
      const cropPxH = Math.max(1, Math.round(draftCrop.height * natH));
      const labelText = `${cropPxW} × ${cropPxH} px`;

      ctx.save();
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const textWidth = ctx.measureText(labelText).width;
      const pillW = textWidth + 12;
      const pillH = 20;
      const pillX = clampRange(cx, 4, Math.max(4, displayWidth - pillW - 4));
      const pillY = cy >= pillH + 6 ? cy - pillH - 4 : Math.min(displayHeight - pillH - 4, cy + 6);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, pillX + 6, pillY + pillH / 2);
      ctx.restore();
    }
  }, [
    activeTextEdit,
    activeTool,
    annotations,
    displayHeight,
    displayWidth,
    draftAnnotation,
    draftCrop,
    draggingText,
    hoveredTextId,
    isImageReady,
    naturalSize.height,
    naturalSize.width,
    viewRect,
  ]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { px: 0, py: 0, normX: viewRect.x, normY: viewRect.y };
    }
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const relX = clampRange(px / Math.max(1, rect.width), 0, 1);
    const relY = clampRange(py / Math.max(1, rect.height), 0, 1);
    return {
      px,
      py,
      normX: clampRange(viewRect.x + relX * viewRect.width, viewRect.x, viewRect.x + viewRect.width),
      normY: clampRange(viewRect.y + relY * viewRect.height, viewRect.y, viewRect.y + viewRect.height),
    };
  };

  const hitTestText = (px: number, py: number): TextAnnotation | null => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return null;

    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (ann.type !== 'text') continue;
      const metrics = measureTextAnnotationBox(
        ctx,
        ann,
        viewRect,
        displayWidth,
        displayHeight,
        naturalSize.width,
        naturalSize.height
      );
      const pad = 4;
      if (
        px >= metrics.x - pad &&
        px <= metrics.x + metrics.width + pad &&
        py >= metrics.y - pad &&
        py <= metrics.y + metrics.height + pad
      ) {
        return ann;
      }
    }
    return null;
  };

  const buildDraftAnnotation = (
    tool: 'rect' | 'arrow' | 'mosaic',
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): EditorAnnotation => {
    if (tool === 'arrow') {
      return {
        id: 'draft',
        type: 'arrow',
        startX,
        startY,
        endX,
        endY,
        color,
        strokeWidth,
      };
    }

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    if (tool === 'mosaic') {
      return {
        id: 'draft',
        type: 'mosaic',
        x,
        y,
        width,
        height,
      };
    }

    return {
      id: 'draft',
      type: 'rect',
      x,
      y,
      width,
      height,
      color,
      strokeWidth,
    };
  };

  const finishPointerSession = (
    commit: boolean,
    endEvent?: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const drag = activeDragRef.current;
    if (!drag) return;
    activeDragRef.current = null;

    if (drag.mode === 'draw') {
      if (commit && endEvent) {
        const dist = Math.hypot(
          endEvent.clientX - drag.startClientX,
          endEvent.clientY - drag.startClientY
        );
        if (drag.hasMovedThreshold || dist >= 4) {
          const { normX, normY } = toCanvasCoords(endEvent.clientX, endEvent.clientY);
          const finalized = buildDraftAnnotation(
            drag.tool,
            drag.startNormX,
            drag.startNormY,
            normX,
            normY
          );
          const isValid =
            finalized.type === 'arrow'
              ? Math.hypot(
                  (finalized.endX - finalized.startX) * naturalSize.width,
                  (finalized.endY - finalized.startY) * naturalSize.height
                ) >= 2
              : finalized.type !== 'text' &&
                finalized.width * naturalSize.width >= 2 &&
                finalized.height * naturalSize.height >= 2;

          if (isValid) {
            onAddAnnotationRef.current({
              ...finalized,
              id: crypto.randomUUID(),
            });
          }
        }
      }
      setDraftAnnotation(null);
      return;
    }

    if (drag.mode === 'text-drag') {
      setDraggingText(null);
      setHoverCursor('move');
      if (commit && endEvent) {
        const dist = Math.hypot(
          endEvent.clientX - drag.startClientX,
          endEvent.clientY - drag.startClientY
        );
        if (drag.hasMovedThreshold || dist >= 4) {
          const { normX, normY } = toCanvasCoords(endEvent.clientX, endEvent.clientY);
          const maxX = Math.max(viewRect.x, viewRect.x + viewRect.width - 0.02);
          const maxY = Math.max(viewRect.y, viewRect.y + viewRect.height - 0.02);
          const finalX = clampRange(drag.origX + (normX - drag.startNormX), viewRect.x, maxX);
          const finalY = clampRange(drag.origY + (normY - drag.startNormY), viewRect.y, maxY);
          onUpdateAnnotationRef.current(drag.annotation.id, (prev) =>
            prev.type === 'text' ? { ...prev, x: finalX, y: finalY } : prev
          );
        } else {
          const now = Date.now();
          const prevClick = lastTextClickRef.current;
          if (prevClick && prevClick.id === drag.annotation.id && now - prevClick.time < 380) {
            lastTextClickRef.current = null;
            openTextEdit({
              editingId: drag.annotation.id,
              x: drag.annotation.x,
              y: drag.annotation.y,
              value: drag.annotation.text,
              color: drag.annotation.color,
              fontSize: drag.annotation.fontSize,
              backgroundStyle: drag.annotation.backgroundStyle,
            });
          } else {
            lastTextClickRef.current = { id: drag.annotation.id, time: now };
          }
        }
      }
      return;
    }

    if (drag.mode === 'crop-create') {
      if (!commit || !endEvent) {
        onDraftCropChange(drag.initialDraftCrop);
        return;
      }
      const dist = Math.hypot(
        endEvent.clientX - drag.startClientX,
        endEvent.clientY - drag.startClientY
      );
      if (!drag.hasMovedThreshold && dist < 4) {
        onDraftCropChange(drag.initialDraftCrop);
        return;
      }

      const { normX, normY } = toCanvasCoords(endEvent.clientX, endEvent.clientY);
      const minW = Math.min(0.5, 16 / Math.max(1, naturalSize.width));
      const minH = Math.min(0.5, 16 / Math.max(1, naturalSize.height));
      const raw = normalizeCropRect({
        x: Math.min(drag.startNormX, normX),
        y: Math.min(drag.startNormY, normY),
        width: Math.abs(normX - drag.startNormX),
        height: Math.abs(normY - drag.startNormY),
      });

      if (raw.width < minW || raw.height < minH) {
        onDraftCropChange(drag.initialDraftCrop);
      } else {
        onDraftCropChange(raw);
      }
      return;
    }

    if (!commit) {
      onDraftCropChange(drag.initialDraftCrop);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    e.preventDefault();
    const { px, py, normX, normY } = toCanvasCoords(e.clientX, e.clientY);

    if (activeTool === 'text') {
      if (activeTextEditRef.current) {
        commitTextEdit(activeTextEditRef.current);
        return;
      }

      const hitText = hitTestText(px, py);
      if (hitText) {
        canvas.setPointerCapture(e.pointerId);
        activeDragRef.current = {
          mode: 'text-drag',
          pointerId: e.pointerId,
          annotation: hitText,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startNormX: normX,
          startNormY: normY,
          origX: hitText.x,
          origY: hitText.y,
          hasMovedThreshold: false,
        };
        setHoverCursor('grabbing');
        return;
      }

      const maxX = Math.max(viewRect.x, viewRect.x + viewRect.width - 0.02);
      const maxY = Math.max(viewRect.y, viewRect.y + viewRect.height - 0.02);
      openTextEdit({
        editingId: null,
        x: clampRange(normX, viewRect.x, maxX),
        y: clampRange(normY, viewRect.y, maxY),
        value: '',
        color,
        fontSize: textFontSize,
        backgroundStyle: textBackgroundStyle,
      });
      return;
    }

    canvas.setPointerCapture(e.pointerId);

    if (activeTool === 'crop') {
      const hit = hitTestCrop(px, py, draftCrop, displayWidth, displayHeight);
      if (hit?.kind === 'handle' && draftCrop) {
        activeDragRef.current = {
          mode: 'crop-resize',
          pointerId: e.pointerId,
          handle: hit.handle,
          startCrop: draftCrop,
          initialDraftCrop: draftCrop,
        };
        setHoverCursor(HANDLE_CURSORS[hit.handle]);
        return;
      }

      if (hit?.kind === 'move' && draftCrop) {
        activeDragRef.current = {
          mode: 'crop-move',
          pointerId: e.pointerId,
          startNormX: normX,
          startNormY: normY,
          startCrop: draftCrop,
          initialDraftCrop: draftCrop,
        };
        setHoverCursor('grabbing');
        return;
      }

      activeDragRef.current = {
        mode: 'crop-create',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startNormX: normX,
        startNormY: normY,
        initialDraftCrop: draftCrop,
        hasMovedThreshold: false,
      };
      setHoverCursor('crosshair');
      return;
    }

    activeDragRef.current = {
      mode: 'draw',
      pointerId: e.pointerId,
      tool: activeTool,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNormX: normX,
      startNormY: normY,
      hasMovedThreshold: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = activeDragRef.current;
    const { px, py, normX, normY } = toCanvasCoords(e.clientX, e.clientY);

    if (!drag) {
      if (activeTool === 'crop') {
        const hit = hitTestCrop(px, py, draftCrop, displayWidth, displayHeight);
        if (hit?.kind === 'handle') {
          setHoverCursor(HANDLE_CURSORS[hit.handle]);
        } else if (hit?.kind === 'move') {
          setHoverCursor('move');
        } else {
          setHoverCursor('crosshair');
        }
      } else if (activeTool === 'text') {
        if (activeTextEditRef.current) {
          setHoveredTextId(null);
          setHoverCursor('default');
        } else {
          const hitText = hitTestText(px, py);
          setHoveredTextId(hitText?.id ?? null);
          setHoverCursor(hitText ? 'move' : 'text');
        }
      } else {
        setHoverCursor('crosshair');
      }
      return;
    }

    if (e.pointerId !== drag.pointerId) return;

    if (drag.mode === 'draw') {
      if (!drag.hasMovedThreshold) {
        const dist = Math.hypot(
          e.clientX - drag.startClientX,
          e.clientY - drag.startClientY
        );
        if (dist < 4) return;
        drag.hasMovedThreshold = true;
      }
      setDraftAnnotation(
        buildDraftAnnotation(drag.tool, drag.startNormX, drag.startNormY, normX, normY)
      );
      return;
    }

    if (drag.mode === 'text-drag') {
      if (!drag.hasMovedThreshold) {
        const dist = Math.hypot(
          e.clientX - drag.startClientX,
          e.clientY - drag.startClientY
        );
        if (dist < 4) return;
        drag.hasMovedThreshold = true;
      }
      const maxX = Math.max(viewRect.x, viewRect.x + viewRect.width - 0.02);
      const maxY = Math.max(viewRect.y, viewRect.y + viewRect.height - 0.02);
      setDraggingText({
        id: drag.annotation.id,
        x: clampRange(drag.origX + (normX - drag.startNormX), viewRect.x, maxX),
        y: clampRange(drag.origY + (normY - drag.startNormY), viewRect.y, maxY),
      });
      return;
    }

    if (drag.mode === 'crop-create') {
      if (!drag.hasMovedThreshold) {
        const dist = Math.hypot(
          e.clientX - drag.startClientX,
          e.clientY - drag.startClientY
        );
        if (dist < 4) return;
        drag.hasMovedThreshold = true;
      }
      onDraftCropChange(
        normalizeCropRect({
          x: Math.min(drag.startNormX, normX),
          y: Math.min(drag.startNormY, normY),
          width: Math.abs(normX - drag.startNormX),
          height: Math.abs(normY - drag.startNormY),
        })
      );
      return;
    }

    if (drag.mode === 'crop-move') {
      const dx = normX - drag.startNormX;
      const dy = normY - drag.startNormY;
      onDraftCropChange({
        x: clampRange(drag.startCrop.x + dx, 0, Math.max(0, 1 - drag.startCrop.width)),
        y: clampRange(drag.startCrop.y + dy, 0, Math.max(0, 1 - drag.startCrop.height)),
        width: drag.startCrop.width,
        height: drag.startCrop.height,
      });
      return;
    }

    if (drag.mode === 'crop-resize') {
      const minW = Math.min(0.5, 16 / Math.max(1, naturalSize.width));
      const minH = Math.min(0.5, 16 / Math.max(1, naturalSize.height));

      let left = drag.startCrop.x;
      let top = drag.startCrop.y;
      let right = drag.startCrop.x + drag.startCrop.width;
      let bottom = drag.startCrop.y + drag.startCrop.height;

      const handle = drag.handle;
      if (handle === 'nw' || handle === 'w' || handle === 'sw') {
        left = clampRange(normX, 0, Math.max(0, right - minW));
      }
      if (handle === 'ne' || handle === 'e' || handle === 'se') {
        right = clampRange(normX, Math.min(1, left + minW), 1);
      }
      if (handle === 'nw' || handle === 'n' || handle === 'ne') {
        top = clampRange(normY, 0, Math.max(0, bottom - minH));
      }
      if (handle === 'sw' || handle === 's' || handle === 'se') {
        bottom = clampRange(normY, Math.min(1, top + minH), 1);
      }

      onDraftCropChange({
        x: left,
        y: top,
        width: Math.max(minW, right - left),
        height: Math.max(minH, bottom - top),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = activeDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;

    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    finishPointerSession(true, e);
    if (activeTool === 'crop') {
      setHoverCursor('crosshair');
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = activeDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    finishPointerSession(false);
  };

  const handleLostPointerCapture = () => {
    finishPointerSession(false);
  };

  const handleTextFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (activeTextEditRef.current) {
      commitTextEdit(activeTextEditRef.current);
    }
  };

  return (
    <div
      ref={containerRef}
      onWheel={onWheelZoom}
      onPointerDown={(e) => {
        if (activeTextEditRef.current && e.target === containerRef.current) {
          commitTextEdit(activeTextEditRef.current);
        }
      }}
      className="lightbox-stage-bg relative flex min-h-0 min-w-0 flex-1 overflow-auto p-4 select-none"
    >
      <div
        className="relative m-auto shrink-0"
        style={{ width: displayWidth, height: displayHeight }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-sm bg-slate-950 shadow-[0_12px_40px_rgba(0,0,0,0.7)] ring-1 ring-slate-400/35">
          <img
            ref={imgRef}
            src={imageUrl}
            alt={alt}
            draggable={false}
            onLoad={handleImageLoad}
            style={{
              width: `${100 / viewRect.width}%`,
              height: `${100 / viewRect.height}%`,
              left: `${-(viewRect.x / viewRect.width) * 100}%`,
              top: `${-(viewRect.y / viewRect.height) * 100}%`,
            }}
            className="pointer-events-none absolute max-w-none select-none"
          />

          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
            style={{ cursor: hoverCursor, WebkitUserSelect: 'none' }}
            className="absolute inset-0 block h-full w-full touch-none select-none"
          />
        </div>

        {/* インラインテキスト入力オーバーレイ */}
        {activeTextEdit && (
          <form
            ref={textFormRef}
            onSubmit={handleTextFormSubmit}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              left: clampRange(
                ((activeTextEdit.x - viewRect.x) / viewRect.width) * displayWidth,
                4,
                Math.max(4, displayWidth - 292)
              ),
              top: clampRange(
                ((activeTextEdit.y - viewRect.y) / viewRect.height) * displayHeight,
                4,
                Math.max(4, displayHeight - 112)
              ),
            }}
            className="absolute z-20 flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-1.5 rounded-xl border border-indigo-400/60 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md"
          >
            <label htmlFor={textInputId} className="sr-only">
              テキスト注釈
            </label>
            <textarea
              id={textInputId}
              ref={textareaRef}
              rows={2}
              value={activeTextEdit.value}
              onChange={(e) => {
                const val = e.target.value;
                setActiveTextEdit((prev) =>
                  prev ? { ...prev, value: val } : null
                );
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeTextEdit();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                    return;
                  }
                  textFormRef.current?.requestSubmit();
                }
              }}
              placeholder="テキストを入力..."
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/25"
                  style={{ backgroundColor: activeTextEdit.color }}
                  aria-hidden="true"
                />
                <span className="whitespace-nowrap">Enter 確定 · Shift+Enter 改行</span>
              </div>
              <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                <button
                  type="button"
                  onClick={closeTextEdit}
                  className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="shrink-0 whitespace-nowrap rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500"
                >
                  確定
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
