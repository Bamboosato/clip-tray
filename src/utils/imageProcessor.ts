export interface ProcessedImageResult {
  imageBlob: Blob;
  thumbnailBlob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

const THUMBNAIL_MAX_DIMENSION = 400;
const WEBP_QUALITY = 0.85;

/**
 * BlobまたはFileからHTMLImageElementを読み込む
 */
function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * 長辺がmaxDimensionを超える場合、アスペクト比を維持して縮小サイズを計算する
 */
function calculateDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDimension: number
): { width: number; height: number } {
  if (srcWidth <= maxDimension && srcHeight <= maxDimension) {
    return { width: srcWidth, height: srcHeight };
  }
  if (srcWidth >= srcHeight) {
    const width = maxDimension;
    const height = Math.max(1, Math.round((srcHeight * maxDimension) / srcWidth));
    return { width, height };
  } else {
    const height = maxDimension;
    const width = Math.max(1, Math.round((srcWidth * maxDimension) / srcHeight));
    return { width, height };
  }
}

/**
 * Canvasから指定フォーマットのBlobを生成する（WebP非対応環境ではimage/pngにフォールバック）
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        // フォールバックとしてPNGで再試行
        canvas.toBlob((fallbackBlob) => {
          if (fallbackBlob) {
            resolve(fallbackBlob);
          } else {
            reject(new Error('CanvasからBlobの生成に失敗しました'));
          }
        }, 'image/png');
      },
      mimeType,
      quality
    );
  });
}

/**
 * 取り込んだ画像File/Blobをリサイズ＆WebP最適化し、サムネイルも同時生成する
 */
export async function processIncomingImage(
  sourceBlob: Blob,
  maxImageDimension: number = 1920
): Promise<ProcessedImageResult> {
  const img = await loadImageFromBlob(sourceBlob);
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;

  // 1. メイン画像の生成
  const mainDims = calculateDimensions(naturalWidth, naturalHeight, maxImageDimension);
  const mainCanvas = document.createElement('canvas');
  mainCanvas.width = mainDims.width;
  mainCanvas.height = mainDims.height;
  const mainCtx = mainCanvas.getContext('2d');
  if (!mainCtx) {
    throw new Error('Canvas 2D context の取得に失敗しました');
  }
  mainCtx.imageSmoothingEnabled = true;
  mainCtx.imageSmoothingQuality = 'high';
  mainCtx.drawImage(img, 0, 0, mainDims.width, mainDims.height);

  const imageBlob = await canvasToBlob(mainCanvas, 'image/webp', WEBP_QUALITY);

  // 2. サムネイル画像の生成（長辺 400px 程度）
  const thumbDims = calculateDimensions(mainDims.width, mainDims.height, THUMBNAIL_MAX_DIMENSION);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbDims.width;
  thumbCanvas.height = thumbDims.height;
  const thumbCtx = thumbCanvas.getContext('2d');
  if (!thumbCtx) {
    throw new Error('Thumbnail Canvas 2D context の取得に失敗しました');
  }
  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = 'medium';
  thumbCtx.drawImage(mainCanvas, 0, 0, thumbDims.width, thumbDims.height);

  const thumbnailBlob = await canvasToBlob(thumbCanvas, 'image/webp', 0.8);

  return {
    imageBlob,
    thumbnailBlob,
    mimeType: imageBlob.type || 'image/webp',
    width: mainDims.width,
    height: mainDims.height,
  };
}

/**
 * 任意の画像BlobをPNG Blobに変換するPromiseを返す
 * Safari / Firefox互換のため、ClipboardItemにPromiseを直接渡せるように設計
 */
export function convertBlobToPngPromise(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') {
    return Promise.resolve(blob);
  }
  return loadImageFromBlob(blob).then((img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context の取得に失敗しました');
    }
    ctx.drawImage(img, 0, 0);
    return canvasToBlob(canvas, 'image/png');
  });
}

/**
 * ユーザージェスチャーの同期コンテキスト内で呼び出し、画像をPNGとしてクリップボードに書き込む。
 * Safari / Firefox 互換のため、await してから ClipboardItem を作るのではなく、
 * new ClipboardItem({ 'image/png': convertToPngBlobPromise }) として渡す。
 */
export function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    return Promise.reject(new Error('このブラウザはクリップボードへの画像コピーに対応していません'));
  }

  const convertToPngBlobPromise = convertBlobToPngPromise(blob);
  const clipboardItem = new ClipboardItem({
    'image/png': convertToPngBlobPromise,
  });

  return navigator.clipboard.write([clipboardItem]);
}
