# スクリーンショット一時保存・グループ管理Webアプリ 仕様書

## 1. プロジェクト概要
* **目的:** WindowsおよびmacOSのデスクトップブラウザ上で、スクリーンショットや参考画像を「一時的に」素早くストックし、グループ単位で整理・再利用するための完全ローカル完結型Webアプリケーション。
* **基本方針:**
  * サーバー・クラウド同期は持たず、すべての画像データおよびメタデータはブラウザの **IndexedDB** に保存する。
  * 大量アーカイブではなく「作業中のスクショの仮置き場」に特化し、**ペースト即保存・ワンクリック再利用・期限切れ自動削除** を最優先とする。

## 2. 技術スタック・セットアップ要件
* **構成:** Vite + React + TypeScript（`strict: true`）
* **スタイリング:** Tailwind CSS（落ち着いたダーク基調、またはシステム設定連動のシンプルで視認性の高いダッシュボードUI）
* **アイコン:** `lucide-react`
* **ローカルDB:** `dexie` + `dexie-react-hooks`
* **対応環境:** Windows / macOS のモダンブラウザ（Chrome, Edge, Safari, Firefox）。キーボードショートカットは `Ctrl`（Windows）および `Cmd / Meta`（macOS）の両方に対応すること。

## 3. 機能要件

### 3.1. グループ（ボード／タブ）管理
* **初期状態:** アプリ初回起動時にデフォルトグループ（例：「Inbox」）を1つ自動作成する（StrictModeの二重実行で重複作成されないようトランザクションや存在チェックを徹底すること）。
* **CRUD操作:**
  * グループの新規作成（名前、任意のアクセントカラー設定）。
  * グループ名のインライン編集（ダブルクリック等）。
  * グループの並び替え（ドラッグ＆ドロップ、または左右移動ボタン）。
  * グループの削除（確認ダイアログ付き。配下の画像も同時に削除）。
* **フィルタリング:** 「すべて表示」「ピン留めのみ」「各グループ」の切り替え。各タブにアイテム件数バッジを表示。

### 3.2. 画像の取り込み（インプット）
* **クリップボードからの直接ペースト（最重要）:**
  * 画面上のどこにいても `Ctrl + V` / `Cmd + V`（`window` の `paste` イベント）でクリップボード内の画像（PNG / JPEG / WebP）を取得し、現在選択中のグループ（「すべて」「ピン留め」選択時はデフォルトグループ）に即座に追加する。
  * テキスト入力欄（`input`, `textarea`, `contentEditable`）にフォーカスがある場合は、通常のテキストペーストを優先し画像登録を発火させないこと。
* **ドラッグ＆ドロップ / ファイル選択:**
  * ブラウザ画面全体への画像ファイルドロップ（複数ファイル同時対応、ドラッグオーバー時の視覚的フィードバック表示）。
  * ヘッダーの「画像を追加」ボタンからのファイルピッカー選択。
* **保存時の自動最適化（軽量化）:**
  * Canvas APIを用いて、長辺が `maxImageDimension`（デフォルト `1920px`）を超える画像はアスペクト比を維持して縮小し、`WebP`（品質 `0.85`）または軽量フォーマットの `Blob` として保存する。
  * 一覧表示のパフォーマンス維持のため、軽量なサムネイル用 `Blob`（長辺 `400px` 程度）も同時に生成して保存する。

### 3.3. 画像カードの操作・閲覧（アウトプット）
* **一覧表示:** レスポンシブなグリッドレイアウト（カードサイズの「小・中・大」切り替え対応）。
* **プレビュー（ライトボックス）:** 画像クリックで原寸大モーダル表示。左右矢印キーでグループ内の前後画像へ移動、`Esc` で閉じる、ボタンやホイールで拡大縮小。
* **クリップボードへ再コピー（重要・ブラウザ互換性厳守）:**
  * カード上の「コピー」ボタン（またはプレビュー中の `Ctrl + C` / `Cmd + C`）で、画像をPNG形式に変換してクリップボードへ書き込む。
  * **実装制約:** Safari / Firefox 互換のため、ユーザージェスチャー（クリック／キーイベント）の同期コンテキスト内で `new ClipboardItem({ 'image/png': convertToPngBlobPromise })` のように **Promiseを直接 `ClipboardItem` に渡して `navigator.clipboard.write()` を呼ぶこと**（`await` してから `ClipboardItem` を作らないこと）。コピー完了時はトースト通知を表示。
* **グループ移動:** カード上のメニュー（またはドラッグ＆ドロップ）で別グループへ移動。
* **メモ・検索:** 各画像に短いインラインメモ（検索対象）を付与・編集可能。ヘッダーの検索バーでリアルタイム絞り込み。
* **画像内文字・バーコード抽出（OCR / Barcode）:**
  * フロントエンド完結（`tesseract.js` Web Worker + `barcode-detector` / ZXing-C++ WASM + 直列キュー）で画像内テキスト・バーコード・QRコードを抽出し、外部サーバーへの送信は行わない。
  * 貼り付け／ドロップ時のバックグラウンド自動抽出（デフォルト ON、設定で OFF 切替可）に加え、カード／ライトボックス上のボタンから手動抽出・再抽出が可能。
  * **バーコード／QRコード自動デコード:** JAN / EAN-13 / EAN-8 / UPC / Code 128 / Code 39 / ITF / QRコード等を検出し、余白が切り詰められた画像向けに白いクワイエットゾーン（24px）を補完して高精度にデコードする。純粋なバーコード画像は OCR をスキップし高速・高精度に値のみを出力し、テキスト混在画像ではバーコード領域を背景色でマスクして縦縞ノイズの誤認識を防ぎつつ周囲テキストと重複除去して統合する。
  * **スクリーンショット向け OCR 前処理:** 透過領域の白下塗り、外周（上下左右最大 4px）輝度ベースの暗背景判定による輝度反転（白背景バーコード等での誤反転防止）、コントラスト強調グレースケール化を実施。通常レイアウト解析で空文字だった場合は疎テキストモード（`PSM.SPARSE_TEXT`）でフォールバック認識を行う。
  * 抽出したテキストはライトボックス内で閲覧・手直し編集・ワンクリックコピーでき、ヘッダー検索バーの横断検索対象（一致スニペット表示付き）になる。
* **ピン留め機能:** 重要な画像をピン留め（`isPinned: true`）し、一覧の上部に固定＆自動削除の対象外にする。
* **ダウンロード / 削除:** 個別画像のローカル保存（`<a download>`）および個別削除。

### 3.4. 一時保存向けクリーンアップ機能
* **自動期限切れ削除（TTL）:**
  * 設定モーダルから自動削除期間を選択可能にする（選択肢：`オフ` / `24時間` / `3日` / `7日` / `30日`、デフォルトは `7日`）。
  * アプリ起動時および定期インターバルで、`isPinned === false` かつ `expiresAt` を過ぎたレコードを自動削除する。
* **グループ一括クリア:** 「ピン留め以外をすべて削除」ボタンを配置（確認ダイアログ付き）。
* **ストレージ使用量表示:** `navigator.storage.estimate()` を利用し、現在の使用容量の目安を設定画面またはフッターに表示。

### 3.5. PWA / デプロイ対応（Vercel）
* **Web App Manifest & アイコン:** `vite-plugin-pwa` を用いて `display: "standalone"`、テーマカラー `#020617`、`start_url: "/"` の Manifest と各種アイコン（`192×192`, `512×512`, `maskable`, Apple Touch Icon `180×180`, SVG favicon）を提供。
* **キャッシュ戦略（オフライン対応）:**
  * アプリ本体（HTML / JS / CSS / アイコン）およびバーコード解析 WASM（`zxing_reader.wasm`）は Workbox で事前キャッシュ（Precache）。
  * `tesseract.js` が外部 CDN（`cdn.jsdelivr.net`, `tessdata.projectnaptha.com`）から取得するコア／言語データは `CacheFirst` のランタイムキャッシュで 1 度使用後にオフライン利用可能。
* **インストール & 更新 UX:** `registerType: 'prompt'` により更新通知バナー（`PwaUpdatePrompt`）から任意タイミングで再読み込み適用でき、`beforeinstallprompt` 対応環境ではヘッダー・設定モーダルからインストール可能。
* **Vercel 設定:** `vercel.json` にて `/sw.js`, `/workbox-*.js`, `/manifest.webmanifest` に `Cache-Control: public, max-age=0, must-revalidate` を指定し、`.gitignore` を整備。

## 4. データ設計（IndexedDB / Dexie.js）

```typescript
// src/types/index.ts

export interface Group {
  id: string;           // crypto.randomUUID()
  name: string;         // グループ名
  color: string;        // ラベル色 (hex)
  order: number;        // 表示順
  createdAt: number;    // Unix timestamp (ms)
}

export type OcrStatus = 'idle' | 'pending' | 'processing' | 'done' | 'error';
export type OcrLanguage = 'jpn+eng' | 'eng';

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
  autoOcr: boolean;             // デフォルト true
  ocrLanguage: OcrLanguage;     // デフォルト 'jpn+eng'
}
```

### メモリ管理ルール
`Blob` から `URL.createObjectURL(blob)` で生成したURLは、専用カスタムフック（`useObjectUrl`）等で管理し、コンポーネントのアンマウント時やBlob変更時に必ず `URL.revokeObjectURL()` を呼び出してメモリリークを防ぐこと。

## 5. ディレクトリ構成案
```text
src/
├── db/
│   └── database.ts          # Dexieインスタンス定義、初期データ投入、TTL削除ロジック
├── hooks/
│   ├── useClipboardPaste.ts # window全体のpasteイベント監視と画像抽出
│   ├── useObjectUrl.ts      # Blob -> ObjectURL変換と安全なrevoke管理
│   ├── useOcrQueue.ts       # 単一Worker直列キューによるバックグラウンドOCR制御
│   ├── usePwaInstall.ts     # beforeinstallprompt・standalone状態の管理
│   └── useSettings.ts       # localStorageを使ったAppSettings永続化
├── utils/
│   ├── imageProcessor.ts    # Canvasによるリサイズ・サムネイル生成・PNG変換(コピー用)
│   ├── barcodeDecoder.ts    # barcode-detector (ZXing-C++ WASM) による1D/2Dバーコード・QRデコード
│   ├── ocrEngine.ts         # 差し替え可能なOCRエンジン抽象化・Canvas前処理・Tesseract.js実装
│   └── dateUtils.ts         # 相対時間（「2時間前」）や残り期限（「あと5日」）のフォーマット
├── components/
│   ├── Header.tsx           # 検索バー、ファイル追加ボタン、グリッドサイズ切替、設定ボタン
│   ├── GroupTabs.tsx        # グループ切り替えタブ、新規作成、名前変更、削除
│   ├── ImageGrid.tsx        # グリッド一覧、ドラッグ＆ドロップ受け入れ領域、空状態ガイド
│   ├── ImageCard.tsx        # サムネイル、ホバーアクション(コピー/ピン/移動/削除)、インラインメモ
│   ├── LightboxModal.tsx    # 原寸プレビュー、ズーム、キーボードナビゲーション
│   ├── SettingsModal.tsx    # 自動削除期間(TTL)設定、リサイズ設定、ストレージ使用量表示
│   ├── PwaUpdatePrompt.tsx  # Service Worker 更新通知バナー
│   └── Toast.tsx            # 操作フィードバック通知
├── types/
│   └── index.ts
├── App.tsx
└── main.tsx
```

## 6. 実装の進め方（ステップ分割）
* **Step 1（基盤構築）:** Vite + React + TS + Tailwind + Dexie + Lucide のセットアップ、型定義、DB層（初期グループ作成・TTL削除含む）、画像リサイズ・サムネイル生成ユーティリティの実装。
* **Step 2（コアUI・取り込み機能）:** ヘッダー、グループタブ管理、`Ctrl+V` / `Cmd+V` ペースト＆ドラッグ＆ドロップ取り込み、画像グリッド・カード表示の実装。
* **Step 3（再利用・管理機能）:** クリップボード再コピー（Safari対応Promise形式）、ライトボックスプレビュー、インラインメモ・検索、ピン留め、設定モーダル、トースト通知の実装と全体動作確認。
