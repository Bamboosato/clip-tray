import { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Download,
  FileText,
  FolderInput,
  Loader2,
  Maximize2,
  Pin,
  ScanText,
  Trash2,
} from 'lucide-react';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { formatRelativeTime, formatRemainingTime } from '../utils/dateUtils';
import { copyImageBlobToClipboard } from '../utils/imageProcessor';
import type { ClipItem, Group } from '../types';

interface ImageCardProps {
  clip: ClipItem;
  groups: Group[];
  currentGroup?: Group;
  showGroupBadge: boolean;
  searchQuery: string;
  ocrActiveProgress?: { progress: number; statusLabel: string } | null;
  onOpenPreview: (clip: ClipItem) => void;
  onTogglePin: (clip: ClipItem) => Promise<void>;
  onUpdateMemo: (clipId: string, memo: string) => Promise<void>;
  onMoveGroup: (clipId: string, targetGroupId: string) => Promise<void>;
  onDelete: (clipId: string) => Promise<void>;
  onRunOcr: (clipId: string) => void;
  onNotify: (message: string, type?: 'success' | 'info' | 'error') => void;
  nowMs: number;
}

interface MatchSnippet {
  before: string;
  match: string;
  after: string;
}

function buildOcrSnippet(ocrText: string | undefined, query: string): MatchSnippet | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || !ocrText) return null;

  const singleLine = ocrText.replace(/\s+/g, ' ').trim();
  const lowerText = singleLine.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return null;

  const contextBefore = 20;
  const contextAfter = 42;
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(singleLine.length, idx + trimmedQuery.length + contextAfter);

  const before = (start > 0 ? '...' : '') + singleLine.slice(start, idx);
  const match = singleLine.slice(idx, idx + trimmedQuery.length);
  const after =
    singleLine.slice(idx + trimmedQuery.length, end) + (end < singleLine.length ? '...' : '');

  return { before, match, after };
}

export function ImageCard({
  clip,
  groups,
  currentGroup,
  showGroupBadge,
  searchQuery,
  ocrActiveProgress,
  onOpenPreview,
  onTogglePin,
  onUpdateMemo,
  onMoveGroup,
  onDelete,
  onRunOcr,
  onNotify,
  nowMs,
}: ImageCardProps) {
  const thumbUrl = useObjectUrl(clip.thumbnailBlob);
  const [memoDraft, setMemoDraft] = useState(clip.memo);
  const [justCopied, setJustCopied] = useState(false);

  useEffect(() => {
    setMemoDraft(clip.memo);
  }, [clip.memo]);

  /**
   * 重要: Safari / Firefox 互換のため、ユーザージェスチャー（onClick）の同期コンテキスト内で
   * copyImageBlobToClipboard(clip.imageBlob) を即座に呼び出す。
   */
  const handleCopyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyImageBlobToClipboard(clip.imageBlob)
      .then(() => {
        setJustCopied(true);
        onNotify('クリップボードに画像をコピーしました (PNG)', 'success');
        setTimeout(() => setJustCopied(false), 1800);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'コピーに失敗しました';
        onNotify(msg, 'error');
      });
  };

  const handleOcrAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    const extracted = clip.ocrText?.trim();
    if (extracted) {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        onNotify('このブラウザはテキストのクリップボードコピーに対応していません', 'error');
        return;
      }
      navigator.clipboard
        .writeText(extracted)
        .then(() => {
          onNotify('抽出テキストをコピーしました', 'success');
        })
        .catch(() => {
          onNotify('抽出テキストのコピーに失敗しました', 'error');
        });
      return;
    }

    onRunOcr(clip.id);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = URL.createObjectURL(clip.imageBlob);
    const ext = clip.mimeType === 'image/png' ? 'png' : 'webp';
    const filename = `clip-${new Date(clip.createdAt)
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.${ext}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleMemoBlur = () => {
    const trimmed = memoDraft.trim();
    if (trimmed !== clip.memo) {
      void onUpdateMemo(clip.id, trimmed);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-cliptray-clip', clip.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const remaining = formatRemainingTime(clip.expiresAt, clip.isPinned, nowMs);
  const isOcrBusy = clip.ocrStatus === 'pending' || clip.ocrStatus === 'processing';
  const hasOcrText = Boolean(clip.ocrText?.trim());
  const ocrSnippet = buildOcrSnippet(clip.ocrText, searchQuery);

  return (
    <article
      draggable
      onDragStart={handleDragStart}
      className={`group relative flex flex-col overflow-clip rounded-xl border bg-slate-900/90 transition duration-150 hover:border-slate-700 hover:shadow-lg hover:shadow-black/40 ${
        clip.isPinned
          ? 'border-amber-500/40 ring-1 ring-amber-500/20'
          : 'border-slate-800/90'
      }`}
    >
      {/* サムネイル画像領域 */}
      <div
        onClick={() => onOpenPreview(clip)}
        className="relative aspect-video w-full cursor-zoom-in overflow-clip bg-slate-950/90"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={clip.memo || '保存されたスクリーンショット'}
            loading="lazy"
            className="block h-full w-full object-contain transition duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-600">
            読み込み中...
          </div>
        )}

        {/* 左上バッジ: ピン留め・グループ名・OCR状態 */}
        <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap items-center gap-1.5">
          {clip.isPinned && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950 shadow-xs">
              <Pin className="h-2.5 w-2.5 fill-current" />
              PIN
            </span>
          )}
          {showGroupBadge && currentGroup && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-0.5 text-[11px] font-medium text-slate-200 ring-1 ring-slate-700/80 backdrop-blur-xs">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: currentGroup.color }}
              />
              <span className="max-w-[100px] truncate">{currentGroup.name}</span>
            </span>
          )}
          {clip.ocrStatus === 'processing' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-950/90 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200 ring-1 ring-indigo-500/40 backdrop-blur-xs">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {ocrActiveProgress?.statusLabel ?? '抽出中'}{' '}
              {Math.round((ocrActiveProgress?.progress ?? 0) * 100)}%
            </span>
          )}
          {clip.ocrStatus === 'pending' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 ring-1 ring-slate-700/80 backdrop-blur-xs">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-indigo-400" />
              待機中
            </span>
          )}
          {clip.ocrStatus === 'done' && hasOcrText && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-950/85 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/35 backdrop-blur-xs">
              <FileText className="h-2.5 w-2.5" />
              OCR
            </span>
          )}
        </div>

        {/* 右上: ピン留めトグル & 削除 */}
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onTogglePin(clip);
            }}
            title={clip.isPinned ? 'ピン留めを解除' : 'ピン留め（自動削除除外）'}
            className={`rounded-lg p-1.5 shadow-sm backdrop-blur-md transition ${
              clip.isPinned
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-950/80 text-slate-300 ring-1 ring-slate-700/80 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onDelete(clip.id);
            }}
            title="画像を削除"
            className="rounded-lg bg-slate-950/80 p-1.5 text-slate-300 shadow-sm ring-1 ring-slate-700/80 backdrop-blur-md transition hover:bg-rose-600 hover:text-white hover:ring-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 下部オーバーレイアクションバー（コピー・文字抽出/コピー・プレビュー・ダウンロード） */}
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={handleCopyClick}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition ${
              justCopied
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600/95 text-white hover:bg-indigo-500'
            }`}
          >
            {justCopied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>コピー完了</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>コピー</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleOcrAction}
            disabled={!hasOcrText && isOcrBusy}
            title={
              hasOcrText
                ? '抽出テキストをコピー'
                : isOcrBusy
                ? '文字抽出を実行中...'
                : '画像から文字を抽出 (OCR)'
            }
            aria-label={hasOcrText ? '抽出テキストをコピー' : '画像から文字を抽出'}
            className={`rounded-lg p-1.5 shadow-md ring-1 backdrop-blur-md transition disabled:cursor-wait disabled:opacity-60 ${
              hasOcrText
                ? 'bg-emerald-950/90 text-emerald-300 ring-emerald-500/40 hover:bg-emerald-900 hover:text-white'
                : 'bg-slate-950/85 text-slate-200 ring-slate-700/80 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {isOcrBusy && !hasOcrText ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanText className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreview(clip);
            }}
            title="原寸プレビュー"
            className="rounded-lg bg-slate-950/85 p-1.5 text-slate-200 shadow-md ring-1 ring-slate-700/80 backdrop-blur-md transition hover:bg-slate-800 hover:text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="画像をダウンロード"
            className="rounded-lg bg-slate-950/85 p-1.5 text-slate-200 shadow-md ring-1 ring-slate-700/80 backdrop-blur-md transition hover:bg-slate-800 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* カード下部: インラインメモ・OCR検索一致スニペット & メタ情報・グループ移動 */}
      <div className="flex flex-1 flex-col justify-between gap-2 p-2.5">
        <div className="space-y-1.5">
          <input
            type="text"
            value={memoDraft}
            onChange={(e) => setMemoDraft(e.target.value)}
            onBlur={handleMemoBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            placeholder="メモを入力..."
            aria-label="画像のメモ"
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-slate-200 placeholder-slate-500 transition hover:border-slate-800 focus:border-indigo-500/60 focus:bg-slate-950 focus:outline-none"
          />

          {ocrSnippet && (
            <div className="rounded-md border border-indigo-500/25 bg-indigo-950/30 px-2 py-1 text-[11px] leading-snug text-slate-300">
              <span className="mr-1 font-semibold text-indigo-300">OCR一致:</span>
              <span>{ocrSnippet.before}</span>
              <mark className="rounded bg-indigo-500/40 px-0.5 text-white">
                {ocrSnippet.match}
              </mark>
              <span>{ocrSnippet.after}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-800/60 pt-1.5 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 truncate">
            <span>
              {clip.width}×{clip.height}
            </span>
            <span>·</span>
            <span>{formatRelativeTime(clip.createdAt, nowMs)}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {remaining && (
              <span
                title="自動削除までの残り時間"
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  remaining.isUrgent
                    ? 'bg-rose-950/80 text-rose-300 ring-1 ring-rose-500/30'
                    : 'bg-slate-800/80 text-slate-400'
                }`}
              >
                <Clock className="h-2.5 w-2.5" />
                {remaining.label}
              </span>
            )}

            {/* グループ移動セレクト */}
            {groups.length > 1 && (
              <div className="relative inline-flex items-center">
                <FolderInput className="pointer-events-none absolute left-1.5 h-3 w-3 text-slate-400" />
                <select
                  value={clip.groupId}
                  onChange={(e) => void onMoveGroup(clip.id, e.target.value)}
                  aria-label="所属グループを変更"
                  title="別グループへ移動"
                  className="max-w-[96px] cursor-pointer appearance-none truncate rounded bg-slate-800/80 py-0.5 pr-2 pl-5 text-[10px] text-slate-300 transition hover:bg-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id} className="bg-slate-900 text-slate-200">
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
