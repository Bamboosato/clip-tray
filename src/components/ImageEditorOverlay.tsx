import { useEffect, useRef, useState } from 'react';
import type {
  CropHandle,
  CropRect,
  EditorAnnotation,
  EditorColor,
  EditorTool,
  StrokeWidthPreset,
} from '../types/editor';
import {
  FULL_VIEW_RECT,
  drawArrowAnnotation,
  drawMosaicRegion,
  drawRectAnnotation,
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
  annotations: EditorAnnotation[];
  appliedCrop: CropRect | null;
  draftCrop: CropRect | null;
  onDraftCropChange: (crop: CropRect | null) => void;
  onAddAnnotation: (annotation: EditorAnnotation) => void;
  onImageLoaded: (img: HTMLImageElement | null) => void;
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
  annotations,
  appliedCrop,
  draftCrop,
  onDraftCropChange,
  onAddAnnotation,
  onImageLoaded,
}: ImageEditorOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tempMosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const onImageLoadedRef = useRef(onImageLoaded);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [naturalSize, setNaturalSize] = useState({
    width: Math.max(1, fallbackWidth),
    height: Math.max(1, fallbackHeight),
  });
  const [isImageReady, setIsImageReady] = useState(false);
  const [draftAnnotation, setDraftAnnotation] = useState<EditorAnnotation | null>(null);
  const [hoverCursor, setHoverCursor] = useState('crosshair');

  useEffect(() => {
    onImageLoadedRef.current = onImageLoaded;
  }, [onImageLoaded]);

  // 画像URL切り替え時のリセットおよびキャッシュ済み画像の即時検出
  useEffect(() => {
    setNaturalSize({
      width: Math.max(1, fallbackWidth),
      height: Math.max(1, fallbackHeight),
    });
    setDraftAnnotation(null);
    activeDragRef.current = null;

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

  // ツール変更時にドラッグ中の未確定描画をクリア
  useEffect(() => {
    activeDragRef.current = null;
    setDraftAnnotation(null);
    setHoverCursor('crosshair');
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

    // 3. 切り抜きオーバーレイ（8方向ハンドル・三分割ガイド・サイズ表示）
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
    activeTool,
    annotations,
    displayHeight,
    displayWidth,
    draftAnnotation,
    draftCrop,
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
              : finalized.width * naturalSize.width >= 2 &&
                finalized.height * naturalSize.height >= 2;

          if (isValid) {
            onAddAnnotation({
              ...finalized,
              id: crypto.randomUUID(),
            });
          }
        }
      }
      setDraftAnnotation(null);
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

  return (
    <div
      ref={containerRef}
      onWheel={onWheelZoom}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-auto bg-slate-950 p-4 select-none"
    >
      <div
        className="relative m-auto shrink-0 overflow-hidden rounded-sm bg-slate-950 shadow-2xl ring-1 ring-slate-800"
        style={{ width: displayWidth, height: displayHeight }}
      >
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
    </div>
  );
}
