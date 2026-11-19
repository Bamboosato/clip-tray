export type OcrStatus = 'idle' | 'pending' | 'processing' | 'done' | 'error';
export type OcrLanguage = 'jpn+eng' | 'eng';

export interface Group {
  id: string;           // crypto.randomUUID()
  name: string;         // グループ名
  color: string;        // ラベル色 (hex)
  order: number;        // 表示順
  createdAt: number;    // Unix timestamp (ms)
}

export interface ClipItem {
  id: string;           // crypto.randomUUID()
  groupId: string;      // 所属する Group.id
  imageBlob: Blob;      // 保存用画像データ (WebP等)
  thumbnailBlob: Blob;  // 一覧表示用軽量サムネイル
  mimeType: string;     // 'image/webp' | 'image/png' 等
  width: number;        // リサイズ後の幅
  height: number;       // リサイズ後の高さ
  memo: string;         // 検索用メモ（初期値: ""）
  ocrText?: string;     // 画像内から抽出した文字（検索・コピー用）
  ocrStatus?: OcrStatus;// OCR処理状態
  ocrError?: string;    // OCR失敗時のメッセージ
  isPinned: boolean;    // ピン留めフラグ（自動削除除外）
  createdAt: number;    // 作成日時 (ms)
  expiresAt: number | null; // 削除予定日時 (ms) / nullは無期限
}

export interface AppSettings {
  retentionDays: number | null; // 1, 3, 7, 30, または null (無期限)
  gridSize: 'sm' | 'md' | 'lg';
  maxImageDimension: number;    // デフォルト 1920
  autoOcr: boolean;             // 貼り付け時にバックグラウンド自動OCRを行うか (デフォルト true)
  ocrLanguage: OcrLanguage;     // OCR言語 (デフォルト 'jpn+eng')
}

export type FilterTab = 'all' | 'pinned' | string; // 'all' | 'pinned' | Group.id

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}
