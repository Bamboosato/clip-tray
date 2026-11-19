import { useRef } from 'react';
import {
  Grid2X2,
  Grid3X3,
  LayoutGrid,
  MonitorDown,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type { AppSettings } from '../types';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  gridSize: AppSettings['gridSize'];
  onGridSizeChange: (size: AppSettings['gridSize']) => void;
  onFilesSelected: (files: File[]) => void;
  onOpenSettings: () => void;
  onClearUnpinned: () => void;
  unpinnedCountInView: number;
  activeGroupName: string;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
}

export function Header({
  searchQuery,
  onSearchChange,
  gridSize,
  onGridSizeChange,
  onFilesSelected,
  onOpenSettings,
  onClearUnpinned,
  unpinnedCountInView,
  activeGroupName,
  canInstallPwa,
  onInstallPwa,
}: HeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) {
      onFilesSelected(files);
    }
    e.target.value = '';
  };

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        {/* ブランドロゴ */}
        <div className="flex items-center gap-2.5">
          <img
            src="/favicon.svg"
            alt=""
            width={32}
            height={32}
            className="block h-8 w-8 shrink-0 rounded-lg"
          />
          <h1 className="text-base font-bold tracking-tight text-slate-100">ClipTray</h1>
        </div>

        {/* 検索バー */}
        <div className="relative order-3 w-full flex-1 sm:order-2 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="メモ・画像内テキストで検索..."
            aria-label="メモ・画像内テキストで検索"
            className="w-full rounded-lg border border-slate-800 bg-slate-900/90 py-1.5 pr-8 pl-9 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-500 focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="検索をクリア"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 右側アクション群 */}
        <div className="order-2 flex items-center gap-2 sm:order-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="画像ファイルを選択（画面上で Ctrl+V / ⌘V でも即保存）"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 active:scale-[0.99] sm:text-sm"
          >
            <Plus className="h-4 w-4" />
            <span>画像を追加</span>
          </button>

          {/* グリッドサイズ切替 */}
          <div
            className="hidden items-center rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 sm:flex"
            role="group"
            aria-label="カードサイズ切り替え"
          >
            <button
              type="button"
              onClick={() => onGridSizeChange('sm')}
              title="サイズ: 小"
              aria-pressed={gridSize === 'sm'}
              className={`rounded-md p-1.5 text-xs transition ${
                gridSize === 'sm'
                  ? 'bg-slate-800 text-indigo-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onGridSizeChange('md')}
              title="サイズ: 中"
              aria-pressed={gridSize === 'md'}
              className={`rounded-md p-1.5 text-xs transition ${
                gridSize === 'md'
                  ? 'bg-slate-800 text-indigo-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid2X2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onGridSizeChange('lg')}
              title="サイズ: 大"
              aria-pressed={gridSize === 'lg'}
              className={`rounded-md p-1.5 text-xs transition ${
                gridSize === 'lg'
                  ? 'bg-slate-800 text-indigo-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* ピン留め以外を一括削除 */}
          <button
            type="button"
            onClick={onClearUnpinned}
            disabled={unpinnedCountInView === 0}
            title={`「${activeGroupName}」のピン留め以外の画像 (${unpinnedCountInView}件) をすべて削除`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-950/30 hover:text-rose-300 disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">ピン留め以外を削除</span>
          </button>

          {/* PWAインストールボタン（対応ブラウザ・未インストール時のみ表示） */}
          {canInstallPwa && onInstallPwa && (
            <button
              type="button"
              onClick={onInstallPwa}
              title="デスクトップアプリとしてインストール"
              aria-label="デスクトップアプリとしてインストール"
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25 hover:text-white"
            >
              <MonitorDown className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">インストール</span>
            </button>
          )}

          {/* 設定ボタン */}
          <button
            type="button"
            onClick={onOpenSettings}
            title="設定"
            aria-label="設定を開く"
            className="rounded-lg border border-slate-800 bg-slate-900/80 p-2 text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
