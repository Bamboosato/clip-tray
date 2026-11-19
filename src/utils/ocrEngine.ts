import type { LoggerMessage, PSM, Worker } from 'tesseract.js';
import { detectBarcodesFromImage, type DetectedBarcodeResult } from './barcodeDecoder';
import type { OcrLanguage } from '../types';

export interface OcrProgress {
  status: string;
  progress: number;
  label: string;
}

export interface OcrResult {
  text: string;
}

export interface OcrEngine {
  recognize(
    imageBlob: Blob,
    language: OcrLanguage,
    onProgress?: (progress: OcrProgress) => void
  ): Promise<OcrResult>;
  dispose(): Promise<void>;
}

const IDLE_TERMINATE_MS = 30_000;
const OCR_UPSCALE_THRESHOLD = 800;
const OCR_UPSCALE_TARGET = 1600;
const OCR_MAX_DIMENSION = 2000;
const DARK_MODE_BORDER_LUMA_THRESHOLD = 115;
const CONTRAST_FACTOR = 1.25;
const INK_LUMA_THRESHOLD = 200;
const PURE_BARCODE_AREA_RATIO = 0.4;
const MIN_REMAINING_INK_RATIO = 0.008;

const LINEAR_BARCODE_FORMATS = new Set([
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'itf',
  'itf_14',
  'isbn',
]);

const STATUS_LABELS: Record<string, string> = {
  'detecting barcodes': 'バーコード解析中',
  'loading tesseract core': 'エンジン読込中',
  'initializing tesseract': '初期化中',
  'loaded tesseract core': 'エンジン読込完了',
  'loading language traineddata': '言語データ読込中',
  'loading language traineddata (from cache)': '言語データ読込中',
  'loaded language traineddata': '言語データ読込完了',
  'initializing api': '初期化中',
  'initialized api': '準備完了',
  'recognizing text': '文字抽出中',
};

function mapStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  return STATUS_LABELS[normalized] ?? '解析中';
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('OCR用画像の読み込みに失敗しました'));
    };
    img.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('OCR前処理画像の生成に失敗しました'));
      }
    }, 'image/png');
  });
}

/**
 * 画像外周（上下左右の最大4px枠）の平均輝度からダークモード背景かどうかを判定する。
 * 全画素平均と異なり、白背景に黒バーが密集するバーコード画像で誤反転しない。
 */
function detectDarkBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  const border = Math.min(4, Math.floor(width / 2), Math.floor(height / 2));
  if (border <= 0) {
    return false;
  }

  let lumaSum = 0;
  let sampleCount = 0;

  const samplePixel = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    lumaSum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    sampleCount += 1;
  };

  // 上端・下端
  for (let y = 0; y < border; y++) {
    for (let x = 0; x < width; x++) {
      samplePixel(x, y);
      samplePixel(x, height - 1 - y);
    }
  }

  // 左端・右端（角の重複を除く）
  for (let y = border; y < height - border; y++) {
    for (let x = 0; x < border; x++) {
      samplePixel(x, y);
      samplePixel(width - 1 - x, y);
    }
  }

  if (sampleCount === 0) return false;
  return lumaSum / sampleCount < DARK_MODE_BORDER_LUMA_THRESHOLD;
}

/**
 * 検出済みバーコード領域を背景色で塗りつぶし、OCR が縦縞からゴミ文字を拾うのを防ぐ。
 * 1Dバーコードは左端・右端の補助数字（EAN-13の先頭桁等）および下部の目視用数字も含めてカバーする。
 */
function maskDetectedBarcodes(
  ctx: CanvasRenderingContext2D,
  barcodes: DetectedBarcodeResult[],
  scale: number,
  fillColor: string
): void {
  if (barcodes.length === 0) return;

  ctx.save();
  ctx.fillStyle = fillColor;

  for (const barcode of barcodes) {
    const box = barcode.boundingBox;
    if (box.width <= 0 || box.height <= 0) continue;

    const isLinear = LINEAR_BARCODE_FORMATS.has(barcode.format);
    const padLeft = isLinear ? box.width * 0.1 : Math.max(box.width, box.height) * 0.03;
    const padRight = isLinear ? box.width * 0.1 : Math.max(box.width, box.height) * 0.03;
    const padTop = isLinear ? box.height * 0.02 : Math.max(box.width, box.height) * 0.03;
    const padBottom = isLinear
      ? box.height * 0.24
      : Math.max(box.width, box.height) * 0.03;

    const x = Math.max(0, Math.floor((box.x - padLeft) * scale));
    const y = Math.max(0, Math.floor((box.y - padTop) * scale));
    const right = Math.ceil((box.x + box.width + padRight) * scale);
    const bottom = Math.ceil((box.y + box.height + padBottom) * scale);

    ctx.fillRect(x, y, Math.max(1, right - x), Math.max(1, bottom - y));
  }

  ctx.restore();
}

interface PreprocessedOcrInput {
  blob: Blob | null;
  skipOcr: boolean;
}

/**
 * スクリーンショット（ダークモードUIや小さめのUI文字・バーコード混在画像）向けに
 * 1) 適正解像度へのスケーリング
 * 2) 白背景でのアルファ合成（透明PNGの黒判定防止）
 * 3) 外周輝度ベースのダークモード判定
 * 4) 検出済みバーコード領域のマスクと純粋バーコード画像の高速スキップ判定
 * 5) 暗背景反転＋ソフトコントラスト強調グレースケール化
 * を施す。
 */
async function preprocessImageForOcr(
  img: HTMLImageElement,
  barcodes: DetectedBarcodeResult[],
  barcodeAreaRatio: number
): Promise<PreprocessedOcrInput> {
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error('画像サイズが不正です');
  }

  const maxSide = Math.max(srcWidth, srcHeight);
  let scale = 1;
  if (maxSide < OCR_UPSCALE_THRESHOLD) {
    scale = Math.min(2, OCR_UPSCALE_TARGET / maxSide);
  } else if (maxSide > OCR_MAX_DIMENSION) {
    scale = OCR_MAX_DIMENSION / maxSide;
  }

  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Canvas 2D context の取得に失敗しました');
  }

  // 透明PNGの透過部分が輝度0としてカウントされダークモード誤判定しないよう白で下塗り
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const initialData = ctx.getImageData(0, 0, width, height);
  const shouldInvert = detectDarkBackground(initialData.data, width, height);

  if (barcodes.length > 0) {
    const maskFill = shouldInvert ? '#000000' : '#ffffff';
    maskDetectedBarcodes(ctx, barcodes, scale, maskFill);
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const pixelCount = width * height;
  let inkPixels = 0;

  // 暗背景反転 + コントラスト強調グレースケール（二値化せずアンチエイリアス情報を保持）
  for (let i = 0; i < data.length; i += 4) {
    let luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (shouldInvert) {
      luma = 255 - luma;
    }
    const enhanced = Math.min(
      255,
      Math.max(0, Math.round((luma - 128) * CONTRAST_FACTOR + 128))
    );
    if (enhanced < INK_LUMA_THRESHOLD) {
      inkPixels += 1;
    }
    data[i] = enhanced;
    data[i + 1] = enhanced;
    data[i + 2] = enhanced;
    data[i + 3] = 255;
  }

  const remainingInkRatio = pixelCount > 0 ? inkPixels / pixelCount : 0;

  // バーコード専有率が高い、またはマスク後に文字らしい画素がほぼ残らない場合は OCR をスキップ
  if (
    barcodes.length > 0 &&
    (barcodeAreaRatio >= PURE_BARCODE_AREA_RATIO || remainingInkRatio < MIN_REMAINING_INK_RATIO)
  ) {
    return { blob: null, skipOcr: true };
  }

  ctx.putImageData(imageData, 0, 0);
  const blob = await canvasToPngBlob(canvas);
  return { blob, skipOcr: false };
}

/**
 * Tesseract が出力した日本語テキスト間の余分な半角スペース・タブを整形する（改行は維持）
 */
function normalizeOcrText(raw: string, language: OcrLanguage): string {
  let text = raw.replace(/\r\n/g, '\n');

  if (language === 'jpn+eng') {
    const jpChar = '[\\u3000-\\u303F\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF\\uFF01-\\uFF60]';
    const betweenJpSpaces = new RegExp(`(${jpChar})[ \\t]+(?=${jpChar})`, 'g');
    // 2回適用して "あ い う" のような重複ペアを確実に除去
    text = text.replace(betweenJpSpaces, '$1').replace(betweenJpSpaces, '$1');
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * デコード済みバーコード値と周囲の OCR テキストを重複除去しつつ統合する
 */
function mergeBarcodeAndOcrText(barcodeValues: string[], ocrText: string): string {
  if (barcodeValues.length === 0) {
    return ocrText;
  }
  if (!ocrText) {
    return barcodeValues.join('\n');
  }

  const normalizedBarcodes = barcodeValues.map((value) => ({
    compact: value.replace(/\s+/g, '').toLowerCase(),
    digits: value.replace(/\D+/g, ''),
  }));

  const filteredLines: string[] = [];
  for (const rawLine of ocrText.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] !== '') {
        filteredLines.push('');
      }
      continue;
    }

    const compactLine = trimmed.replace(/\s+/g, '').toLowerCase();
    const digitsInLine = trimmed.replace(/\D+/g, '');
    const looksLikeBarcodeNoise = /^[\s|Il!.,\-_0-9]+$/.test(trimmed);

    const isRedundant = normalizedBarcodes.some(({ compact, digits }) => {
      if (compact.length >= 4 && compactLine === compact) {
        return true;
      }
      if (
        compact.length >= 6 &&
        looksLikeBarcodeNoise &&
        compactLine.length >= 4 &&
        (compactLine.includes(compact) || compact.includes(compactLine))
      ) {
        return true;
      }
      if (
        digits.length >= 6 &&
        looksLikeBarcodeNoise &&
        digitsInLine.length >= 4 &&
        (digits.includes(digitsInLine) || digitsInLine.includes(digits))
      ) {
        return true;
      }
      return false;
    });

    if (!isRedundant) {
      filteredLines.push(trimmed);
    }
  }

  const cleanOcr = filteredLines.join('\n').trim();
  if (!cleanOcr) {
    return barcodeValues.join('\n');
  }
  return `${barcodeValues.join('\n')}\n${cleanOcr}`;
}

export class TesseractOcrEngine implements OcrEngine {
  private worker: Worker | null = null;
  private psmEnum: typeof PSM | null = null;
  private activeLanguage: OcrLanguage | null = null;
  private idleTimer: number | null = null;
  private currentProgressHandler: ((progress: OcrProgress) => void) | undefined;

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleDispose(): void {
    this.clearIdleTimer();
    this.idleTimer = window.setTimeout(() => {
      void this.dispose();
    }, IDLE_TERMINATE_MS);
  }

  private async ensureWorker(language: OcrLanguage): Promise<Worker> {
    if (this.worker && this.activeLanguage === language) {
      return this.worker;
    }

    if (this.worker) {
      await this.dispose();
    }

    this.currentProgressHandler?.({
      status: 'loading tesseract core',
      progress: 0,
      label: 'エンジン読込中',
    });

    const { createWorker, PSM: LoadedPSM } = await import('tesseract.js');
    this.psmEnum = LoadedPSM;

    let rejectInit: ((err: unknown) => void) | null = null;
    const initErrorPromise = new Promise<never>((_resolve, reject) => {
      rejectInit = reject;
    });

    const workerPromise = createWorker(language, 1, {
      logger: (msg: LoggerMessage) => {
        this.currentProgressHandler?.({
          status: msg.status,
          progress: typeof msg.progress === 'number' ? msg.progress : 0,
          label: mapStatusLabel(msg.status),
        });
      },
      errorHandler: (err: unknown) => {
        if (rejectInit) {
          rejectInit(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });

    const worker = await Promise.race([workerPromise, initErrorPromise]);
    rejectInit = null;
    this.worker = worker;
    this.activeLanguage = language;
    return worker;
  }

  async recognize(
    imageBlob: Blob,
    language: OcrLanguage,
    onProgress?: (progress: OcrProgress) => void
  ): Promise<OcrResult> {
    this.clearIdleTimer();
    this.currentProgressHandler = onProgress;

    try {
      onProgress?.({
        status: 'detecting barcodes',
        progress: 0.05,
        label: 'バーコード解析中',
      });

      const img = await loadImageFromBlob(imageBlob);
      const barcodes = await detectBarcodesFromImage(img);
      const barcodeValues = Array.from(new Set(barcodes.map((b) => b.rawValue)));

      const srcWidth = img.naturalWidth || img.width;
      const srcHeight = img.naturalHeight || img.height;
      const barcodeAreaRatio =
        srcWidth > 0 && srcHeight > 0
          ? Math.min(
              1,
              barcodes.reduce(
                (sum, b) => sum + b.boundingBox.width * b.boundingBox.height,
                0
              ) /
                (srcWidth * srcHeight)
            )
          : 0;

      onProgress?.({
        status: 'preprocessing',
        progress: 0.1,
        label: '画像前処理中',
      });

      const preprocessed = await preprocessImageForOcr(img, barcodes, barcodeAreaRatio);

      // バーコード単体画像なら Tesseract を呼ばず正確なデコード値を即返却
      if (preprocessed.skipOcr || !preprocessed.blob) {
        if (this.worker) {
          this.scheduleIdleDispose();
        }
        return { text: barcodeValues.join('\n') };
      }

      const worker = await this.ensureWorker(language);
      const result = await worker.recognize(preprocessed.blob);
      let ocrText = normalizeOcrText(result.data.text ?? '', language);

      // バーコード未検出かつ通常モードで空文字の場合、疎なテキスト向け PSM.SPARSE_TEXT で再試行
      if (barcodes.length === 0 && !ocrText && this.psmEnum) {
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: this.psmEnum.SPARSE_TEXT,
          });
          const sparseResult = await worker.recognize(preprocessed.blob);
          ocrText = normalizeOcrText(sparseResult.data.text ?? '', language);
        } finally {
          await worker.setParameters({
            tessedit_pageseg_mode: this.psmEnum.AUTO,
          });
        }
      }

      this.scheduleIdleDispose();
      return { text: mergeBarcodeAndOcrText(barcodeValues, ocrText) };
    } catch (err) {
      await this.dispose();
      throw err;
    } finally {
      this.currentProgressHandler = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.clearIdleTimer();
    const workerToClose = this.worker;
    this.worker = null;
    this.activeLanguage = null;
    if (workerToClose) {
      try {
        await workerToClose.terminate();
      } catch {
        // Ignore termination errors
      }
    }
  }
}

export const ocrEngine: OcrEngine = new TesseractOcrEngine();
