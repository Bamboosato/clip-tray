import type { BarcodeDetector, BarcodeFormat } from 'barcode-detector/ponyfill';

export interface BarcodeBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedBarcodeResult {
  format: string;
  rawValue: string;
  boundingBox: BarcodeBoundingBox;
}

const QUIET_ZONE_PX = 24;

const PREFERRED_FORMATS: BarcodeFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'itf',
  'qr_code',
  'data_matrix',
  'aztec',
  'pdf417',
];

let detectorPromise: Promise<BarcodeDetector> | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function getBarcodeDetector(): Promise<BarcodeDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const [{ BarcodeDetector: DetectorClass, prepareZXingModule }, wasmModule] =
        await Promise.all([
          import('barcode-detector/ponyfill'),
          import('zxing-wasm/reader/zxing_reader.wasm?url'),
        ]);

      const wasmUrl = wasmModule.default;
      prepareZXingModule({
        overrides: {
          locateFile: (path, prefix) => {
            if (path.endsWith('.wasm') && wasmUrl) {
              return wasmUrl;
            }
            return prefix + path;
          },
        },
      });

      const supported = await DetectorClass.getSupportedFormats();
      const supportedSet = new Set(supported);
      const formats = PREFERRED_FORMATS.filter((fmt) => supportedSet.has(fmt));

      return new DetectorClass(formats.length > 0 ? { formats } : undefined);
    })().catch((err) => {
      detectorPromise = null;
      throw err;
    });
  }

  return detectorPromise;
}

/**
 * 読み込んだ HTMLImageElement から 1D/2D バーコードおよび QR コードを検出・デコードする。
 * 余白が切り詰められたバーコードでも認識できるよう、周囲に白いクワイエットゾーンを付与して検出する。
 */
export async function detectBarcodesFromImage(
  img: HTMLImageElement
): Promise<DetectedBarcodeResult[]> {
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  if (srcWidth <= 0 || srcHeight <= 0) {
    return [];
  }

  try {
    const detector = await getBarcodeDetector();

    const canvas = document.createElement('canvas');
    canvas.width = srcWidth + QUIET_ZONE_PX * 2;
    canvas.height = srcHeight + QUIET_ZONE_PX * 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return [];
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, QUIET_ZONE_PX, QUIET_ZONE_PX, srcWidth, srcHeight);

    const detected = await detector.detect(canvas);
    const seen = new Set<string>();
    const results: DetectedBarcodeResult[] = [];

    for (const item of detected) {
      const rawValue = item.rawValue?.trim();
      if (!rawValue) continue;

      const format = String(item.format || 'unknown');
      const dedupeKey = `${format}:${rawValue}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const box = item.boundingBox;
      const x = clamp(box.x - QUIET_ZONE_PX, 0, srcWidth);
      const y = clamp(box.y - QUIET_ZONE_PX, 0, srcHeight);
      const right = clamp(box.x + box.width - QUIET_ZONE_PX, 0, srcWidth);
      const bottom = clamp(box.y + box.height - QUIET_ZONE_PX, 0, srcHeight);

      results.push({
        format,
        rawValue,
        boundingBox: {
          x,
          y,
          width: Math.max(0, right - x),
          height: Math.max(0, bottom - y),
        },
      });
    }

    return results;
  } catch (err) {
    console.warn('バーコード解析をスキップしました:', err);
    return [];
  }
}
