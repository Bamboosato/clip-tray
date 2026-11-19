import { useEffect, useState } from 'react';
import { ClipboardPaste, ImagePlus, UploadCloud } from 'lucide-react';
import { ImageCard } from './ImageCard';
import type { ActiveOcrJob } from '../hooks/useOcrQueue';
import type { AppSettings, ClipItem, Group } from '../types';

interface ImageGridProps {
  clips: ClipItem[];
  groups: Group[];
  gridSize: AppSettings['gridSize'];
  showGroupBadge: boolean;
  searchQuery: string;
  activeOcrJob: ActiveOcrJob | null;
  onFilesDropped: (files: File[]) => void;
  onOpenPreview: (clip: ClipItem) => void;
  onTogglePin: (clip: ClipItem) => Promise<void>;
  onUpdateMemo: (clipId: string, memo: string) => Promise<void>;
  onMoveGroup: (clipId: string, targetGroupId: string) => Promise<void>;
  onDelete: (clipId: string) => Promise<void>;
  onRunOcr: (clipId: string) => void;
  onNotify: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export function ImageGrid({
  clips,
  groups,
  gridSize,
  showGroupBadge,
  searchQuery,
  activeOcrJob,
  onFilesDropped,
  onOpenPreview,
  onTogglePin,
  onUpdateMemo,
  onMoveGroup,
  onDelete,
  onRunOcr,
  onNotify,
}: ImageGridProps) {
  const [isDraggingFileOver, setIsDraggingFileOver] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 1分ごとに相対時間・残り期限表示を更新
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // ブラウザ画面全体への画像ファイルドラッグ＆ドロップを監視
  useEffect(() => {
    let dragCounter = 0;

    const hasFiles = (e: DragEvent): boolean => {
      if (!e.dataTransfer) return false;
      const types = Array.from(e.dataTransfer.types);
      return (
        types.includes('Files') &&
        !types.includes('application/x-cliptray-clip') &&
        !types.includes('application/x-cliptray-group')
      );
    };

    const handleDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter += 1;
      setIsDraggingFileOver(true);
    };

    const handleDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setIsDraggingFileOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = 0;
      setIsDraggingFileOver(false);

      const fileList = e.dataTransfer?.files;
      if (!fileList || fileList.length === 0) return;

      const imageFiles = Array.from(fileList).filter((file) =>
        file.type.startsWith('image/')
      );
      if (imageFiles.length > 0) {
        onFilesDropped(imageFiles);
      } else {
        onNotify('画像ファイル（PNG / JPEG / WebP等）をドロップしてください', 'error');
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onFilesDropped, onNotify]);

  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const gridTemplateClass =
    gridSize === 'sm'
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
      : gridSize === 'lg'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';

  return (
    <main className="relative mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
      {/* 画面全体ドラッグオーバー時の視覚的フィードバックオーバーレイ */}
      {isDraggingFileOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-xs">
          <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-950/40 px-10 py-12 text-center shadow-2xl">
            <UploadCloud className="h-12 w-12 animate-bounce text-indigo-400" />
            <p className="text-lg font-bold text-white">
              ここにドロップして画像を追加
            </p>
            <p className="text-xs text-indigo-200/80">
              複数ファイル同時ドロップ対応 · 自動で軽量化保存されます
            </p>
          </div>
        </div>
      )}

      {clips.length === 0 ? (
        <div className="flex min-h-[52vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/15 text-indigo-400 ring-1 ring-indigo-500/30">
            {searchQuery ? (
              <ImagePlus className="h-7 w-7" />
            ) : (
              <ClipboardPaste className="h-7 w-7" />
            )}
          </div>

          {searchQuery ? (
            <>
              <h2 className="text-base font-semibold text-slate-200">
                「{searchQuery}」に一致する画像はありません
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                別のキーワードで検索するか、検索条件をクリアしてください。
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-slate-200">
                まだスクリーンショットがありません
              </h2>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
                画面上のどこでも{' '}
                <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                  Ctrl + V
                </kbd>{' '}
                または{' '}
                <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                  ⌘ + V
                </kbd>{' '}
                を押すと、クリップボードの画像を即座にこのグループへ保存します。
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
                <span className="rounded-full bg-slate-900 px-3 py-1 ring-1 ring-slate-800">
                  画像ファイルのドラッグ＆ドロップ対応
                </span>
                <span className="rounded-full bg-slate-900 px-3 py-1 ring-1 ring-slate-800">
                  ワンクリックでPNG再コピー
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={`grid gap-4 ${gridTemplateClass}`}>
          {clips.map((clip) => (
            <ImageCard
              key={clip.id}
              clip={clip}
              groups={groups}
              currentGroup={groupMap.get(clip.groupId)}
              showGroupBadge={showGroupBadge}
              searchQuery={searchQuery}
              ocrActiveProgress={activeOcrJob?.clipId === clip.id ? activeOcrJob : null}
              onOpenPreview={onOpenPreview}
              onTogglePin={onTogglePin}
              onUpdateMemo={onUpdateMemo}
              onMoveGroup={onMoveGroup}
              onDelete={onDelete}
              onRunOcr={onRunOcr}
              onNotify={onNotify}
              nowMs={nowMs}
            />
          ))}
        </div>
      )}
    </main>
  );
}
