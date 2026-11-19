import {
  STROKE_WIDTH_PRESETS,
  TEXT_FONT_SIZE_PRESETS,
  type ArrowAnnotation,
  type CropRect,
  type EditorAnnotation,
  type RectAnnotation,
  type StrokeWidthPreset,
  type TextAnnotation,
  type TextFontSizePreset,
} from '../types/editor';
import { canvasToBlob, loadImageFromBlob } from './imageProcessor';

export const FULL_VIEW_RECT: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export const EDITOR_TEXT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

export interface TextBoxMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizePx: number;
  lineHeight: number;
  padX: number;
  padY: number;
  lines: string[];
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeCropRect(rect: CropRect): CropRect {
  const x1 = clamp01(rect.x);
  const y1 = clamp01(rect.y);
  const x2 = clamp01(rect.x + rect.width);
  const y2 = clamp01(rect.y + rect.height);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    width: Math.min(1 - x, Math.abs(x2 - x1)),
    height: Math.min(1 - y, Math.abs(y2 - y1)),
  };
}

/**
 * 元画像解像度に比例した線幅を計算する
 */
export function getStrokeWidthPx(
  naturalWidth: number,
  naturalHeight: number,
  preset: StrokeWidthPreset,
  displayScale: number = 1
): number {
  const config =
    STROKE_WIDTH_PRESETS.find((item) => item.id === preset) ?? STROKE_WIDTH_PRESETS[1];
  const refDim = Math.sqrt(Math.max(1, naturalWidth) * Math.max(1, naturalHeight));
  const basePx = Math.max(config.minPx, refDim * config.ratio);
  return basePx * displayScale;
}

/**
 * 元画像解像度に比例したテキストのフォントサイズを計算する
 */
export function getTextFontSizePx(
  naturalWidth: number,
  naturalHeight: number,
  preset: TextFontSizePreset,
  displayScale: number = 1
): number {
  const config =
    TEXT_FONT_SIZE_PRESETS.find((item) => item.id === preset) ?? TEXT_FONT_SIZE_PRESETS[1];
  const refDim = Math.sqrt(Math.max(1, naturalWidth) * Math.max(1, naturalHeight));
  const basePx = Math.max(config.minPx, refDim * config.ratio);
  return basePx * displayScale;
}

/**
 * Safari互換のピクセル化（モザイク）方式で対象領域を描画する。
 * ctx.filter = 'blur()' は使用せず、一時Canvasへの縮小描画 + imageSmoothingEnabled = false 拡大で実現する。
 */
export function drawMosaicRegion(
  ctx: CanvasRenderingContext2D,
  sourceImage: HTMLImageElement,
  rect: CropRect,
  viewRect: CropRect,
  canvasWidth: number,
  canvasHeight: number,
  tempCanvas?: HTMLCanvasElement
): void {
  const imgW = sourceImage.naturalWidth || sourceImage.width;
  const imgH = sourceImage.naturalHeight || sourceImage.height;
  if (imgW <= 0 || imgH <= 0 || viewRect.width <= 0 || viewRect.height <= 0) {
    return;
  }

  const norm = normalizeCropRect(rect);
  const sx = Math.max(0, Math.floor(norm.x * imgW));
  const sy = Math.max(0, Math.floor(norm.y * imgH));
  const sx2 = Math.min(imgW, Math.ceil((norm.x + norm.width) * imgW));
  const sy2 = Math.min(imgH, Math.ceil((norm.y + norm.height) * imgH));
  const sw = sx2 - sx;
  const sh = sy2 - sy;
  if (sw < 1 || sh < 1) return;

  const dx = ((norm.x - viewRect.x) / viewRect.width) * canvasWidth;
  const dy = ((norm.y - viewRect.y) / viewRect.height) * canvasHeight;
  const dw = (norm.width / viewRect.width) * canvasWidth;
  const dh = (norm.height / viewRect.height) * canvasHeight;

  if (
    dw <= 0 ||
    dh <= 0 ||
    dx + dw <= 0 ||
    dx >= canvasWidth ||
    dy + dh <= 0 ||
    dy >= canvasHeight
  ) {
    return;
  }

  const blockSize = Math.max(16, Math.round(Math.max(imgW, imgH) / 96));
  const smallW = Math.max(1, Math.round(sw / blockSize));
  const smallH = Math.max(1, Math.round(sh / blockSize));

  const off = tempCanvas ?? document.createElement('canvas');
  off.width = smallW;
  off.height = smallH;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;

  offCtx.clearRect(0, 0, smallW, smallH);
  offCtx.imageSmoothingEnabled = true;
  offCtx.imageSmoothingQuality = 'low';
  offCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, smallW, smallH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, smallW, smallH, dx, dy, dw, dh);
  ctx.restore();
}

export function drawRectAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: RectAnnotation,
  viewRect: CropRect,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number
): void {
  if (
    viewRect.width <= 0 ||
    viewRect.height <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return;
  }

  const dx = ((annotation.x - viewRect.x) / viewRect.width) * canvasWidth;
  const dy = ((annotation.y - viewRect.y) / viewRect.height) * canvasHeight;
  const dw = (annotation.width / viewRect.width) * canvasWidth;
  const dh = (annotation.height / viewRect.height) * canvasHeight;
  if (dw <= 0 || dh <= 0) return;

  const displayScale = canvasWidth / (viewRect.width * naturalWidth);
  const lineWidth = getStrokeWidthPx(
    naturalWidth,
    naturalHeight,
    annotation.strokeWidth,
    displayScale
  );

  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.restore();
}

export function drawArrowAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: ArrowAnnotation,
  viewRect: CropRect,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number
): void {
  if (
    viewRect.width <= 0 ||
    viewRect.height <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return;
  }

  const x1 = ((annotation.startX - viewRect.x) / viewRect.width) * canvasWidth;
  const y1 = ((annotation.startY - viewRect.y) / viewRect.height) * canvasHeight;
  const x2 = ((annotation.endX - viewRect.x) / viewRect.width) * canvasWidth;
  const y2 = ((annotation.endY - viewRect.y) / viewRect.height) * canvasHeight;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;

  const displayScale = canvasWidth / (viewRect.width * naturalWidth);
  const lineWidth = getStrokeWidthPx(
    naturalWidth,
    naturalHeight,
    annotation.strokeWidth,
    displayScale
  );
  const headLength = Math.min(
    Math.max(lineWidth * 3.8, 12 * displayScale),
    dist * 0.65
  );
  const headAngle = Math.PI / 6.5;
  const angle = Math.atan2(dy, dx);

  const shaftEndX = x2 - Math.cos(angle) * headLength * 0.72;
  const shaftEndY = y2 - Math.sin(angle) * headLength * 0.72;

  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 太い線端が矢じり先端から飛び出さないように手前で止める
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();

  // 先端の三角形矢じり
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLength * Math.cos(angle - headAngle),
    y2 - headLength * Math.sin(angle - headAngle)
  );
  ctx.lineTo(
    x2 - headLength * Math.cos(angle + headAngle),
    y2 - headLength * Math.sin(angle + headAngle)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function measureTextAnnotationBox(
  ctx: CanvasRenderingContext2D,
  annotation: Pick<
    TextAnnotation,
    'x' | 'y' | 'text' | 'fontSize' | 'backgroundStyle'
  >,
  viewRect: CropRect,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number
): TextBoxMetrics {
  const safeViewW = Math.max(1e-6, viewRect.width);
  const safeViewH = Math.max(1e-6, viewRect.height);
  const displayScale = canvasWidth / (safeViewW * Math.max(1, naturalWidth));
  const fontSizePx = getTextFontSizePx(
    naturalWidth,
    naturalHeight,
    annotation.fontSize,
    displayScale
  );
  const lineHeight = fontSizePx * 1.28;
  const lines = annotation.text.split(/\r?\n/);
  const isPill = annotation.backgroundStyle === 'pill';
  const padX = isPill ? fontSizePx * 0.42 : fontSizePx * 0.14;
  const padY = isPill ? fontSizePx * 0.24 : fontSizePx * 0.1;

  ctx.save();
  ctx.font = `700 ${fontSizePx}px ${EDITOR_TEXT_FONT_FAMILY}`;
  let maxLineWidth = fontSizePx * 0.6;
  for (const line of lines) {
    const measured = ctx.measureText(line || ' ').width;
    if (measured > maxLineWidth) {
      maxLineWidth = measured;
    }
  }
  ctx.restore();

  const x = ((annotation.x - viewRect.x) / safeViewW) * canvasWidth;
  const y = ((annotation.y - viewRect.y) / safeViewH) * canvasHeight;

  return {
    x,
    y,
    width: maxLineWidth + padX * 2,
    height: lines.length * lineHeight + padY * 2,
    fontSizePx,
    lineHeight,
    padX,
    padY,
    lines,
  };
}

export function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  viewRect: CropRect,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number
): void {
  if (
    !annotation.text.trim() ||
    viewRect.width <= 0 ||
    viewRect.height <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return;
  }

  const metrics = measureTextAnnotationBox(
    ctx,
    annotation,
    viewRect,
    canvasWidth,
    canvasHeight,
    naturalWidth,
    naturalHeight
  );
  const { x, y, width, height, fontSizePx, lineHeight, padX, padY, lines } = metrics;
  const displayScale = canvasWidth / (viewRect.width * naturalWidth);

  ctx.save();
  ctx.font = `700 ${fontSizePx}px ${EDITOR_TEXT_FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  if (annotation.backgroundStyle === 'pill') {
    const isLightText =
      annotation.color === '#FFFFFF' || annotation.color === '#EAB308';
    const radius = Math.max(3, Math.min(fontSizePx * 0.35, 14 * displayScale));

    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = isLightText ? 'rgba(15, 23, 42, 0.9)' : annotation.color;
    ctx.fill();

    if (isLightText || annotation.color === '#111827') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = Math.max(1, fontSizePx * 0.06);
      ctx.stroke();
    }

    ctx.fillStyle = isLightText ? annotation.color : '#FFFFFF';
    const textOffsetY = (lineHeight - fontSizePx) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + padX, y + padY + i * lineHeight + textOffsetY);
    }
    ctx.restore();
    return;
  }

  const textOffsetY = (lineHeight - fontSizePx) / 2;

  if (annotation.backgroundStyle === 'outline') {
    const isLightText =
      annotation.color === '#FFFFFF' || annotation.color === '#EAB308';
    ctx.lineWidth = Math.max(2, fontSizePx * 0.16);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = isLightText ? 'rgba(15, 23, 42, 0.92)' : '#FFFFFF';
    ctx.fillStyle = annotation.color;

    for (let i = 0; i < lines.length; i++) {
      const lx = x + padX;
      const ly = y + padY + i * lineHeight + textOffsetY;
      ctx.strokeText(lines[i], lx, ly);
      ctx.fillText(lines[i], lx, ly);
    }
    ctx.restore();
    return;
  }

  ctx.fillStyle = annotation.color;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + padX, y + padY + i * lineHeight + textOffsetY);
  }
  ctx.restore();
}

/**
 * 元画像・モザイク・枠/矢印・テキスト・トリミングを指定順序でオフスクリーン合成する
 * 1. モザイク領域の適用
 * 2. 矩形・矢印の描画
 * 3. テキスト注釈の描画
 * 4. トリミング枠の切り出し
 */
export function renderEditedCanvas(
  sourceImage: HTMLImageElement,
  annotations: EditorAnnotation[],
  crop: CropRect | null
): HTMLCanvasElement {
  const naturalWidth = sourceImage.naturalWidth || sourceImage.width;
  const naturalHeight = sourceImage.naturalHeight || sourceImage.height;

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.max(1, naturalWidth);
  fullCanvas.height = Math.max(1, naturalHeight);
  const ctx = fullCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context の取得に失敗しました');
  }

  ctx.drawImage(sourceImage, 0, 0, fullCanvas.width, fullCanvas.height);

  // 1. モザイク適用
  const tempCanvas = document.createElement('canvas');
  for (const annotation of annotations) {
    if (annotation.type === 'mosaic') {
      drawMosaicRegion(
        ctx,
        sourceImage,
        annotation,
        FULL_VIEW_RECT,
        fullCanvas.width,
        fullCanvas.height,
        tempCanvas
      );
    }
  }

  // 2. 矩形・矢印描画
  for (const annotation of annotations) {
    if (annotation.type === 'rect') {
      drawRectAnnotation(
        ctx,
        annotation,
        FULL_VIEW_RECT,
        fullCanvas.width,
        fullCanvas.height,
        fullCanvas.width,
        fullCanvas.height
      );
    } else if (annotation.type === 'arrow') {
      drawArrowAnnotation(
        ctx,
        annotation,
        FULL_VIEW_RECT,
        fullCanvas.width,
        fullCanvas.height,
        fullCanvas.width,
        fullCanvas.height
      );
    }
  }

  // 3. テキスト注釈描画
  for (const annotation of annotations) {
    if (annotation.type === 'text') {
      drawTextAnnotation(
        ctx,
        annotation,
        FULL_VIEW_RECT,
        fullCanvas.width,
        fullCanvas.height,
        fullCanvas.width,
        fullCanvas.height
      );
    }
  }

  // 4. トリミング切り出し
  if (crop && crop.width > 0 && crop.height > 0) {
    const normalized = normalizeCropRect(crop);
    const cx = Math.max(
      0,
      Math.min(fullCanvas.width - 1, Math.round(normalized.x * fullCanvas.width))
    );
    const cy = Math.max(
      0,
      Math.min(fullCanvas.height - 1, Math.round(normalized.y * fullCanvas.height))
    );
    const cw = Math.max(
      1,
      Math.min(fullCanvas.width - cx, Math.round(normalized.width * fullCanvas.width))
    );
    const ch = Math.max(
      1,
      Math.min(fullCanvas.height - cy, Math.round(normalized.height * fullCanvas.height))
    );

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cw;
    croppedCanvas.height = ch;
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) {
      throw new Error('Cropped Canvas 2D context の取得に失敗しました');
    }
    croppedCtx.drawImage(fullCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
    return croppedCanvas;
  }

  return fullCanvas;
}

/**
 * 編集結果を合成した画像Blobを返す
 */
export function renderEditedImageToBlob(
  sourceBlob: Blob,
  annotations: EditorAnnotation[],
  crop: CropRect | null,
  mimeType: string = 'image/png',
  quality?: number,
  loadedImage?: HTMLImageElement | null
): Promise<Blob> {
  if (
    loadedImage &&
    loadedImage.complete &&
    loadedImage.naturalWidth > 0 &&
    loadedImage.naturalHeight > 0
  ) {
    return Promise.resolve().then(() => {
      const canvas = renderEditedCanvas(loadedImage, annotations, crop);
      return canvasToBlob(canvas, mimeType, quality);
    });
  }

  return loadImageFromBlob(sourceBlob).then((img) => {
    const canvas = renderEditedCanvas(img, annotations, crop);
    return canvasToBlob(canvas, mimeType, quality);
  });
}

/**
 * Safari / Firefox 互換のため、ユーザージェスチャー同期コンテキスト内で await を挟まず
 * Promise を直接 ClipboardItem に渡してクリップボードへPNG画像を書き込む
 */
export function copyEditedImageToClipboard(
  sourceBlob: Blob,
  annotations: EditorAnnotation[],
  crop: CropRect | null,
  loadedImage?: HTMLImageElement | null
): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    return Promise.reject(
      new Error('このブラウザはクリップボードへの画像コピーに対応していません')
    );
  }

  const pngBlobPromise = renderEditedImageToBlob(
    sourceBlob,
    annotations,
    crop,
    'image/png',
    undefined,
    loadedImage
  );

  const clipboardItem = new ClipboardItem({
    'image/png': pngBlobPromise,
  });

  return navigator.clipboard.write([clipboardItem]);
}
