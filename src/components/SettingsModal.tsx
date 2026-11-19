import { useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  HardDrive,
  Image as ImageIcon,
  MonitorDown,
  ScanText,
  X,
} from 'lucide-react';
import { formatBytes } from '../utils/dateUtils';
import type { AppSettings, OcrLanguage } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onChangeRetentionDays: (days: AppSettings['retentionDays']) => Promise<void>;
  onChangeMaxDimension: (maxImageDimension: number) => void;
  onChangeAutoOcr: (enabled: boolean) => void;
  onChangeOcrLanguage: (language: OcrLanguage) => void;
  totalClipsCount: number;
  pinnedClipsCount: number;
  canInstallPwa?: boolean;
  isPwaInstalled?: boolean;
  onInstallPwa?: () => void;
}

const RETENTION_OPTIONS: Array<{ label: string; value: AppSettings['retentionDays']; desc: string }> = [
  { label: '24時間', value: 1, desc: '作成から24時間後に自動削除' },
  { label: '3日', value: 3, desc: '作成から3日後に自動削除' },
  { label: '7日（標準）', value: 7, desc: '作成から7日後に自動削除' },
  { label: '30日', value: 30, desc: '作成から30日後に自動削除' },
  { label: 'オフ（無期限）', value: null, desc: '自動削除しない' },
];

const DIMENSION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '1280 px（省容量）', value: 1280 },
  { label: '1920 px（フルHD・推奨）', value: 1920 },
  { label: '2560 px（WQHD）', value: 2560 },
  { label: '3840 px（4K高精細）', value: 3840 },
];

const OCR_LANGUAGE_OPTIONS: Array<{ label: string; value: OcrLanguage; desc: string }> = [
  { label: '日本語 + 英語（標準）', value: 'jpn+eng', desc: '日本語UI・エラー文・英数字を混在認識' },
  { label: '英語のみ（高速・軽量）', value: 'eng', desc: '英数字コードや英語画面向け' },
];

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onChangeRetentionDays,
  onChangeMaxDimension,
  onChangeAutoOcr,
  onChangeOcrLanguage,
  totalClipsCount,
  pinnedClipsCount,
  canInstallPwa,
  isPwaInstalled,
  onInstallPwa,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        void navigator.storage.estimate().then((est) => {
          setStorageInfo({
            usage: est.usage ?? 0,
            quota: est.quota ?? 0,
          });
        });
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen, totalClipsCount]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      onClose();
    };
    dialog.addEventListener('close', handleNativeClose);

    const supportsClosedBy = 'closedBy' in HTMLDialogElement.prototype;
    const handleBackdropClick = (event: MouseEvent) => {
      if (supportsClosedBy) return;
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isInDialog =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isInDialog) {
        dialog.close();
      }
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      dialog.removeEventListener('close', handleNativeClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  const usagePercent =
    storageInfo && storageInfo.quota > 0
      ? Math.min(100, (storageInfo.usage / storageInfo.quota) * 100)
      : 0;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="m-auto max-h-[90dvh] w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-0 text-slate-100 shadow-2xl open:flex open:flex-col"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
        <h2 id={titleId} className="text-base font-bold text-slate-100">
          設定・ストレージ管理
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="設定を閉じる"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {/* 自動削除期間 (TTL) */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Clock className="h-4 w-4 text-indigo-400" />
            <h3>自動期限切れ削除（TTL）</h3>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            一時保存したスクリーンショットを自動的にクリーンアップします。
            <strong className="text-amber-300">ピン留めした画像</strong>は自動削除の対象外になります。
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {RETENTION_OPTIONS.map((opt) => {
              const isSelected = settings.retentionDays === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => void onChangeRetentionDays(opt.value)}
                  className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-500/15 text-white ring-1 ring-indigo-500/40'
                      : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className="mt-0.5 text-[11px] text-slate-400">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 画像内文字抽出 (OCR) */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <ScanText className="h-4 w-4 text-indigo-400" />
            <h3>画像内文字抽出（OCR）</h3>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            処理はすべてブラウザ内（Web Worker / WASM）で完結し、画像が外部サーバーに送信されることはありません。通常の文字に加えて 1D/2D バーコード（JAN / EAN / Code 128 等）および QR コードも自動でデコードします。初回のみ言語データをブラウザ内に自動キャッシュします。
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeAutoOcr(true)}
              aria-pressed={settings.autoOcr}
              className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                settings.autoOcr
                  ? 'border-indigo-500 bg-indigo-500/15 text-white ring-1 ring-indigo-500/40'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
              }`}
            >
              <span className="text-xs font-semibold">自動抽出 ON（推奨）</span>
              <span className="mt-0.5 text-[11px] text-slate-400">
                貼り付け時にバックグラウンド抽出
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeAutoOcr(false)}
              aria-pressed={!settings.autoOcr}
              className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                !settings.autoOcr
                  ? 'border-indigo-500 bg-indigo-500/15 text-white ring-1 ring-indigo-500/40'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
              }`}
            >
              <span className="text-xs font-semibold">OFF（手動のみ）</span>
              <span className="mt-0.5 text-[11px] text-slate-400">
                必要な画像のみボタンから抽出
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {OCR_LANGUAGE_OPTIONS.map((opt) => {
              const isSelected = settings.ocrLanguage === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeOcrLanguage(opt.value)}
                  className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-500/15 text-white ring-1 ring-indigo-500/40'
                      : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className="mt-0.5 text-[11px] text-slate-400">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 保存時の自動リサイズ上限 */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <ImageIcon className="h-4 w-4 text-indigo-400" />
            <h3>画像保存時の最大サイズ（長辺）</h3>
          </div>
          <p className="text-xs text-slate-400">
            取り込み時に長辺がこのサイズを超える画像はアスペクト比を維持して縮小し、WebP（品質0.85）で軽量保存します。
          </p>

          <div className="grid grid-cols-2 gap-2">
            {DIMENSION_OPTIONS.map((opt) => {
              const isSelected = settings.maxImageDimension === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeMaxDimension(opt.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-500/15 text-white ring-1 ring-indigo-500/40'
                      : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ストレージ使用量 */}
        <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              <h3>ブラウザローカルストレージ使用量 (IndexedDB)</h3>
            </div>
            {storageInfo && (
              <span className="text-xs font-mono text-slate-300">
                {formatBytes(storageInfo.usage)}
                {storageInfo.quota > 0 ? ` / ${formatBytes(storageInfo.quota)}` : ''}
              </span>
            )}
          </div>

          {storageInfo && storageInfo.quota > 0 && (
            <div className="h-2 w-full overflow-clip rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.max(1, usagePercent)}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>保存枚数: 合計 {totalClipsCount} 枚（ピン留め {pinnedClipsCount} 枚）</span>
            <span>完全ローカル保存（外部送信なし）</span>
          </div>
        </section>

        {/* デスクトップアプリ (PWA) */}
        <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <MonitorDown className="h-4 w-4 text-indigo-400" />
              <h3>デスクトップアプリ（PWA）</h3>
            </div>
            {isPwaInstalled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                <CheckCircle2 className="h-3 w-3" />
                インストール済み（スタンドアロン実行中）
              </span>
            )}
          </div>

          {!isPwaInstalled && canInstallPwa && onInstallPwa ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-relaxed text-slate-400">
                独立ウィンドウとしてタスクバー／Dock に登録し、オフラインでも利用できます。
              </p>
              <button
                type="button"
                onClick={onInstallPwa}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
              >
                <MonitorDown className="h-3.5 w-3.5" />
                <span>デスクトップアプリとしてインストール</span>
              </button>
            </div>
          ) : (
            !isPwaInstalled && (
              <p className="text-[11px] leading-relaxed text-slate-400">
                Chrome / Edge はアドレスバー右端のインストールアイコンから、macOS Safari は「ファイル → Dock に追加」で独立アプリ化できます。
              </p>
            )
          )}
        </section>
      </div>

      <div className="flex shrink-0 justify-end border-t border-slate-800 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
        >
          閉じる
        </button>
      </div>
    </dialog>
  );
}
