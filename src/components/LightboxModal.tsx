import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderInput,
  Loader2,
  Pencil,
  Pin,
  RotateCcw,
  ScanText,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { copyImageBlobToClipboard } from '../utils/imageProcessor';
import {
  copyEditedImageToClipboard,
  renderEditedImageToBlob,
} from '../utils/imageEditor';
import { EditorToolbar } from './EditorToolbar';
import { ImageEditorOverlay } from './ImageEditorOverlay';
import type { ActiveOcrJob } from '../hooks/useOcrQueue';
import type { ClipItem, Group } from '../types';
import type {
  CropRect,
  EditorAnnotation,
  EditorColor,
  EditorHistorySnapshot,
  EditorTool,
  StrokeWidthPreset,
  TextAnnotation,
  TextBackgroundStyle,
  TextFontSizePreset,
} from '../types/editor';

interface LightboxModalProps {
  clip: ClipItem | null;
  clips: ClipItem[];
  groups: Group[];
  activeOcrJob: ActiveOcrJob | null;
  onClose: () => void;
  onSelectClip: (clip: ClipItem) => void;
  onTogglePin: (clip: ClipItem) => Promise<void>;
  onUpdateMemo: (clipId: string, memo: string) => Promise<void>;
  onMoveGroup: (clipId: string, targetGroupId: string) => Promise<void>;
  onDelete: (clipId: string) => Promise<void>;
  onRunOcr: (clipId: string) => void;
  onUpdateOcrText: (clipId: string, ocrText: string) => Promise<void>;
  onSaveEditedAsNew: (sourceClip: ClipItem, editedBlob: Blob) => Promise<ClipItem | null>;
  onOverwriteEdited: (clipId: string, editedBlob: Blob) => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'info' | 'error') => void;
}

function isSameCropRect(a: CropRect | null, b: CropRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 1e-6 &&
    Math.abs(a.y - b.y) < 1e-6 &&
    Math.abs(a.width - b.width) < 1e-6 &&
    Math.abs(a.height - b.height) < 1e-6
  );
}

export function LightboxModal({
  clip,
  clips,
  groups,
  activeOcrJob,
  onClose,
  onSelectClip,
  onTogglePin,
  onUpdateMemo,
  onMoveGroup,
  onDelete,
  onRunOcr,
  onUpdateOcrText,
  onSaveEditedAsNew,
  onOverwriteEdited,
  onNotify,
}: LightboxModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fullImageUrl = useObjectUrl(clip?.imageBlob);
  const [zoom, setZoom] = useState(1);
  const [memoDraft, setMemoDraft] = useState('');
  const [ocrDraft, setOcrDraft] = useState('');
  const [isOcrPanelOpen, setIsOcrPanelOpen] = useState(false);
  const [justCopiedText, setJustCopiedText] = useState(false);

  // クイック編集モード状態
  const [isEditing, setIsEditing] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>('rect');
  const [color, setColor] = useState<EditorColor>('#EF4444');
  const [strokeWidth, setStrokeWidth] = useState<StrokeWidthPreset>('medium');
  const [textFontSize, setTextFontSize] = useState<TextFontSizePreset>('md');
  const [textBackgroundStyle, setTextBackgroundStyle] =
    useState<TextBackgroundStyle>('outline');
  const [cancelTextSignal, setCancelTextSignal] = useState(0);
  const [annotations, setAnnotations] = useState<EditorAnnotation[]>([]);
  const [appliedCrop, setAppliedCrop] = useState<CropRect | null>(null);
  const [draftCrop, setDraftCrop] = useState<CropRect | null>(null);
  const [undoStack, setUndoStack] = useState<EditorHistorySnapshot[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [justCopiedEdited, setJustCopiedEdited] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [loadedImageSize, setLoadedImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const isEditingRef = useRef(isEditing);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const lastDrawToolRef = useRef<'rect' | 'arrow' | 'mosaic' | 'text'>('rect');
  const isTextInputActiveRef = useRef(false);
  const pendingTextRef = useRef<{
    editingId: string | null;
    annotation: TextAnnotation;
  } | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const resetEditState = useCallback(() => {
    setIsEditing(false);
    setActiveTool('rect');
    lastDrawToolRef.current = 'rect';
    setColor('#EF4444');
    setStrokeWidth('medium');
    setTextFontSize('md');
    setTextBackgroundStyle('outline');
    isTextInputActiveRef.current = false;
    pendingTextRef.current = null;
    setAnnotations([]);
    setAppliedCrop(null);
    setDraftCrop(null);
    setUndoStack([]);
    setIsSaving(false);
    setJustCopiedEdited(false);
    setLoadedImageSize(null);
    loadedImageRef.current = null;
  }, []);

  const enterEditMode = useCallback(() => {
    if (!clip || !fullImageUrl) return;
    setAnnotations([]);
    setAppliedCrop(null);
    setDraftCrop(null);
    setUndoStack([]);
    setActiveTool('rect');
    lastDrawToolRef.current = 'rect';
    setColor('#EF4444');
    setStrokeWidth('medium');
    setTextFontSize('md');
    setTextBackgroundStyle('outline');
    isTextInputActiveRef.current = false;
    pendingTextRef.current = null;
    setZoom(1);
    setJustCopiedEdited(false);
    setIsEditing(true);
    setLiveAnnouncement('クイック編集モードを開始しました');
  }, [clip, fullImageUrl]);

  const exitEditMode = useCallback(() => {
    resetEditState();
    setZoom(1);
    setLiveAnnouncement('編集モードを終了しました');
  }, [resetEditState]);

  // クリップ切り替え時にズーム・パネル初期開閉状態・編集状態をリセット
  useEffect(() => {
    setZoom(1);
    setJustCopiedText(false);
    resetEditState();
    setIsOcrPanelOpen(
      Boolean(clip?.ocrText?.trim()) ||
        clip?.ocrStatus === 'pending' ||
        clip?.ocrStatus === 'processing' ||
        clip?.ocrStatus === 'error'
    );
  }, [clip?.id, resetEditState]);

  // 上書き保存等で Blob が差し替わった際はキャッシュ済みの HTMLImageElement をクリア
  useEffect(() => {
    loadedImageRef.current = null;
    setLoadedImageSize(null);
  }, [clip?.imageBlob]);

  // メモ・抽出テキストの同期（バックグラウンドOCR完了時も反映）
  useEffect(() => {
    setMemoDraft(clip?.memo ?? '');
  }, [clip?.id, clip?.memo]);

  useEffect(() => {
    setOcrDraft(clip?.ocrText ?? '');
  }, [clip?.id, clip?.ocrText]);

  // ネイティブ <dialog> の showModal() / close() 同期
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (clip) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [clip]);

  // ダイアログの閉じる制御・編集中の Esc インターセプト・Safari向けバックドロップ Light-dismiss
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      resetEditState();
      onClose();
    };
    dialog.addEventListener('close', handleNativeClose);

    const handleCancel = (event: Event) => {
      if (isTextInputActiveRef.current) {
        event.preventDefault();
        setCancelTextSignal((n) => n + 1);
        return;
      }
      if (isEditingRef.current) {
        event.preventDefault();
        exitEditMode();
      }
    };
    dialog.addEventListener('cancel', handleCancel);

    const supportsClosedBy = 'closedBy' in HTMLDialogElement.prototype;
    let pressedOutside = false;

    const isOutsideDialog = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (supportsClosedBy || isEditingRef.current) {
        pressedOutside = false;
        return;
      }
      pressedOutside = isOutsideDialog(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (supportsClosedBy || isEditingRef.current) {
        pressedOutside = false;
        return;
      }
      if (pressedOutside && isOutsideDialog(event)) {
        pressedOutside = false;
        dialog.close();
      } else {
        pressedOutside = false;
      }
    };

    const handlePointerCancel = () => {
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    dialog.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      dialog.removeEventListener('close', handleNativeClose);
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
      dialog.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [exitEditMode, onClose, resetEditState]);

  const currentIndex = clip ? clips.findIndex((c) => c.id === clip.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < clips.length - 1;

  const effectiveCrop =
    activeTool === 'crop' && draftCrop ? draftCrop : appliedCrop;

  const handleSelectTool = useCallback(
    (nextTool: EditorTool) => {
      if (nextTool === activeTool) return;
      if (nextTool === 'crop') {
        if (activeTool !== 'crop') {
          lastDrawToolRef.current = activeTool;
        }
        setDraftCrop(appliedCrop);
        setActiveTool('crop');
      } else {
        lastDrawToolRef.current = nextTool;
        setDraftCrop(null);
        setActiveTool(nextTool);
      }
    },
    [activeTool, appliedCrop]
  );

  const handleAddAnnotation = useCallback(
    (annotation: EditorAnnotation) => {
      setUndoStack((prev) => [...prev, { annotations, appliedCrop }]);
      setAnnotations((prev) => [...prev, annotation]);
    },
    [annotations, appliedCrop]
  );

  const handleUpdateAnnotation = useCallback(
    (id: string, updater: (prev: EditorAnnotation) => EditorAnnotation) => {
      setUndoStack((prev) => [...prev, { annotations, appliedCrop }]);
      setAnnotations((prev) =>
        prev.map((item) => (item.id === id ? updater(item) : item))
      );
    },
    [annotations, appliedCrop]
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      setUndoStack((prev) => [...prev, { annotations, appliedCrop }]);
      setAnnotations((prev) => prev.filter((item) => item.id !== id));
    },
    [annotations, appliedCrop]
  );

  const handleEditingTextChange = useCallback((isEditingText: boolean) => {
    isTextInputActiveRef.current = isEditingText;
  }, []);

  const handlePendingTextChange = useCallback(
    (pending: { editingId: string | null; annotation: TextAnnotation } | null) => {
      pendingTextRef.current = pending;
    },
    []
  );

  const getAnnotationsForExport = useCallback((): EditorAnnotation[] => {
    const pending = pendingTextRef.current;
    if (!pending) return annotations;
    if (pending.editingId !== null) {
      return annotations.map((item) =>
        item.id === pending.editingId ? pending.annotation : item
      );
    }
    return [...annotations, pending.annotation];
  }, [annotations]);

  const handleConfirmCrop = useCallback(() => {
    if (!draftCrop || draftCrop.width <= 0 || draftCrop.height <= 0) return;
    if (!isSameCropRect(draftCrop, appliedCrop)) {
      setUndoStack((prev) => [...prev, { annotations, appliedCrop }]);
      setAppliedCrop(draftCrop);
    }
    setDraftCrop(null);
    setActiveTool(lastDrawToolRef.current);
    setLiveAnnouncement('切り抜きを確定しました');
  }, [annotations, appliedCrop, draftCrop]);

  const handleResetCrop = useCallback(() => {
    if (appliedCrop !== null) {
      setUndoStack((prev) => [...prev, { annotations, appliedCrop }]);
      setAppliedCrop(null);
    }
    setDraftCrop(null);
    setLiveAnnouncement('切り抜きをリセットしました');
  }, [annotations, appliedCrop]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    if (isTextInputActiveRef.current) {
      setCancelTextSignal((n) => n + 1);
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setAnnotations(previous.annotations);
    setAppliedCrop(previous.appliedCrop);
    setDraftCrop(activeTool === 'crop' ? previous.appliedCrop : null);
    setLiveAnnouncement('直前の操作を取り消しました');
  }, [activeTool, undoStack]);

  const handleClearAll = useCallback(() => {
    if (
      annotations.length === 0 &&
      appliedCrop === null &&
      draftCrop === null &&
      !isTextInputActiveRef.current
    ) {
      return;
    }
    if (isTextInputActiveRef.current) {
      setCancelTextSignal((n) => n + 1);
    }
    if (annotations.length > 0 || appliedCrop !== null) {
      setUndoStack((prev) => [...prev, { annotations, appliedCrop }]);
    }
    setAnnotations([]);
    setAppliedCrop(null);
    setDraftCrop(null);
    setLiveAnnouncement('すべての描画と切り抜きをクリアしました');
  }, [annotations, appliedCrop, draftCrop]);

  const handleCopyEdited = useCallback(() => {
    if (!clip) return;
    copyEditedImageToClipboard(
      clip.imageBlob,
      getAnnotationsForExport(),
      effectiveCrop,
      loadedImageRef.current
    )
      .then(() => {
        setJustCopiedEdited(true);
        setLiveAnnouncement('編集した画像をコピーしました');
        onNotify('編集した画像をコピーしました', 'success');
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = window.setTimeout(() => {
          setJustCopiedEdited(false);
        }, 1800);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'コピーに失敗しました';
        onNotify(msg, 'error');
      });
  }, [clip, effectiveCrop, getAnnotationsForExport, onNotify]);

  const handleSaveAsNew = useCallback(async () => {
    if (!clip || isSaving) return;
    setIsSaving(true);
    try {
      const editedBlob = await renderEditedImageToBlob(
        clip.imageBlob,
        getAnnotationsForExport(),
        effectiveCrop,
        'image/png',
        undefined,
        loadedImageRef.current
      );
      const created = await onSaveEditedAsNew(clip, editedBlob);
      if (created) {
        setLiveAnnouncement('編集した画像を新規保存しました');
        exitEditMode();
        onSelectClip(created);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '新規保存に失敗しました';
      onNotify(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [
    clip,
    effectiveCrop,
    exitEditMode,
    getAnnotationsForExport,
    isSaving,
    onNotify,
    onSaveEditedAsNew,
    onSelectClip,
  ]);

  const handleOverwrite = useCallback(async () => {
    if (!clip || isSaving) return;
    setIsSaving(true);
    try {
      const editedBlob = await renderEditedImageToBlob(
        clip.imageBlob,
        getAnnotationsForExport(),
        effectiveCrop,
        'image/png',
        undefined,
        loadedImageRef.current
      );
      await onOverwriteEdited(clip.id, editedBlob);
      setLiveAnnouncement('画像を上書き保存しました');
      exitEditMode();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上書き保存に失敗しました';
      onNotify(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [
    clip,
    effectiveCrop,
    exitEditMode,
    getAnnotationsForExport,
    isSaving,
    onNotify,
    onOverwriteEdited,
  ]);

  const handleImageLoaded = useCallback((img: HTMLImageElement | null) => {
    loadedImageRef.current = img;
    if (img) {
      setLoadedImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    }
  }, []);

  // キーボードナビゲーション・編集ショートカット
  useEffect(() => {
    if (!clip) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      if (isEditing) {
        // 編集モード中は左右画像切り替えを無効化
        if (!isInputFocused && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          handleUndo();
          return;
        }

        if (!isInputFocused && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          const selection = window.getSelection();
          if (selection && selection.toString().length > 0) {
            return;
          }
          e.preventDefault();
          handleCopyEdited();
          return;
        }

        if (e.key === 'Enter' && activeTool === 'crop' && draftCrop !== null) {
          const isInteractiveControl =
            activeEl instanceof HTMLButtonElement ||
            activeEl instanceof HTMLInputElement ||
            activeEl instanceof HTMLTextAreaElement ||
            activeEl instanceof HTMLSelectElement ||
            activeEl instanceof HTMLAnchorElement;
          if (!isInteractiveControl) {
            e.preventDefault();
            handleConfirmCrop();
          }
        }
        return;
      }

      if (!isInputFocused && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        enterEditMode();
        return;
      }

      if (!isInputFocused && e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onSelectClip(clips[currentIndex - 1]);
        return;
      }

      if (!isInputFocused && e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onSelectClip(clips[currentIndex + 1]);
        return;
      }

      // Ctrl + C / Cmd + C でクリップボードへ画像を再コピー（ユーザージェスチャー同期コンテキスト内）
      if (!isInputFocused && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return;
        }
        e.preventDefault();
        copyImageBlobToClipboard(clip.imageBlob)
          .then(() => {
            onNotify('クリップボードに画像をコピーしました (PNG)', 'success');
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : 'コピーに失敗しました';
            onNotify(msg, 'error');
          });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTool,
    clip,
    clips,
    currentIndex,
    draftCrop,
    enterEditMode,
    handleConfirmCrop,
    handleCopyEdited,
    handleUndo,
    hasNext,
    hasPrev,
    isEditing,
    onNotify,
    onSelectClip,
  ]);

  const handleCopy = () => {
    if (!clip) return;
    copyImageBlobToClipboard(clip.imageBlob)
      .then(() => {
        onNotify('クリップボードに画像をコピーしました (PNG)', 'success');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'コピーに失敗しました';
        onNotify(msg, 'error');
      });
  };

  const handleCopyOcrText = () => {
    const trimmed = ocrDraft.trim();
    if (!trimmed) return;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      onNotify('このブラウザはテキストのクリップボードコピーに対応していません', 'error');
      return;
    }
    navigator.clipboard
      .writeText(ocrDraft)
      .then(() => {
        setJustCopiedText(true);
        onNotify('抽出テキストをコピーしました', 'success');
        setTimeout(() => setJustCopiedText(false), 1800);
      })
      .catch(() => {
        onNotify('抽出テキストのコピーに失敗しました', 'error');
      });
  };

  const handleDownload = () => {
    if (!clip) return;
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

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((prev) => Math.min(4, Math.max(0.25, Number((prev + delta).toFixed(2)))));
  };

  const isOcrRunning =
    clip?.ocrStatus === 'pending' || clip?.ocrStatus === 'processing';
  const currentProgress =
    clip && activeOcrJob?.clipId === clip.id ? activeOcrJob : null;
  const progressValue = currentProgress?.progress ?? 0;
  const progressLabel =
    currentProgress?.statusLabel ??
    (clip?.ocrStatus === 'pending' ? '待機中' : '文字抽出中');

  const activeCropForSize = activeTool === 'crop' ? draftCrop : appliedCrop;
  const baseNatWidth = loadedImageSize?.width ?? clip?.width ?? 1;
  const baseNatHeight = loadedImageSize?.height ?? clip?.height ?? 1;
  const cropPixelSize = activeCropForSize
    ? {
        width: Math.max(1, Math.round(activeCropForSize.width * baseNatWidth)),
        height: Math.max(1, Math.round(activeCropForSize.height * baseNatHeight)),
      }
    : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: isEditing ? 'closerequest' : 'any' } as Record<string, string>)}
      className={`m-auto h-[92dvh] w-[94dvw] max-w-6xl rounded-2xl bg-slate-900 p-0 text-slate-100 open:flex open:flex-col ${
        isEditing
          ? 'border border-indigo-400/60 ring-1 ring-indigo-400/25 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.88),0_0_0_1px_rgba(129,140,248,0.28)]'
          : 'border border-slate-600/80 ring-1 ring-white/10 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.88),0_0_0_1px_rgba(148,163,184,0.18)]'
      }`}
    >
      {clip && (
        <>
          <div className="sr-only" aria-live="polite">
            {liveAnnouncement}
          </div>

          {isEditing ? (
            <>
              <h2 id={titleId} className="sr-only">
                画像のクイック編集
              </h2>
              <EditorToolbar
                activeTool={activeTool}
                onSelectTool={handleSelectTool}
                color={color}
                onSelectColor={setColor}
                strokeWidth={strokeWidth}
                onSelectStrokeWidth={setStrokeWidth}
                textFontSize={textFontSize}
                onSelectTextFontSize={setTextFontSize}
                textBackgroundStyle={textBackgroundStyle}
                onSelectTextBackgroundStyle={setTextBackgroundStyle}
                hasDraftCrop={draftCrop !== null}
                appliedCrop={appliedCrop}
                cropPixelSize={cropPixelSize}
                onConfirmCrop={handleConfirmCrop}
                onResetCrop={handleResetCrop}
                canUndo={undoStack.length > 0}
                hasChanges={
                  annotations.length > 0 ||
                  appliedCrop !== null ||
                  draftCrop !== null
                }
                onUndo={handleUndo}
                onClearAll={handleClearAll}
                zoom={zoom}
                onZoomOut={() =>
                  setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))
                }
                onZoomIn={() =>
                  setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))
                }
                onZoomReset={() => setZoom(1)}
                isSaving={isSaving}
                justCopied={justCopiedEdited}
                onCopy={handleCopyEdited}
                onSaveAsNew={() => void handleSaveAsNew()}
                onOverwrite={() => void handleOverwrite()}
                onCancel={exitEditMode}
              />
            </>
          ) : (
            /* トップツールバー（通常プレビュー） */
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 bg-slate-900 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <h2 id={titleId} className="text-xs font-semibold text-slate-200 sm:text-sm">
                  プレビュー ({currentIndex + 1} / {clips.length})
                </h2>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-slate-700">
                  {clip.width} × {clip.height} px
                </span>
                <span className="hidden text-[11px] text-slate-400 md:inline">
                  Ctrl+C / ⌘C でコピー · E で編集 · ← → キーで移動
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* ズームコントロール */}
                <div className="flex items-center rounded-lg border border-slate-700/80 bg-slate-800/90 p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))
                    }
                    title="縮小"
                    aria-label="縮小"
                    className="rounded p-1 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[46px] text-center text-xs font-medium text-slate-300">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))
                    }
                    title="拡大"
                    aria-label="拡大"
                    className="rounded p-1 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    title="100%にリセット"
                    aria-label="100%にリセット"
                    className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* クイック編集ボタン */}
                <button
                  type="button"
                  onClick={enterEditMode}
                  disabled={!fullImageUrl}
                  title="クイック編集モード (E)"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-indigo-500/50 hover:bg-slate-700 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Pencil className="h-3.5 w-3.5 text-indigo-400" />
                  <span>編集</span>
                </button>

                {/* OCRテキストパネル切り替えボタン */}
                <button
                  type="button"
                  onClick={() => setIsOcrPanelOpen((v) => !v)}
                  aria-pressed={isOcrPanelOpen}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                    isOcrPanelOpen
                      ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                      : 'border-slate-700/80 bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {isOcrRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                  ) : (
                    <ScanText className="h-3.5 w-3.5" />
                  )}
                  <span>{clip.ocrText?.trim() ? '抽出テキスト' : '文字抽出'}</span>
                </button>

                {/* コピーボタン */}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>PNGコピー</span>
                </button>

                {/* ピン留め */}
                <button
                  type="button"
                  onClick={() => void onTogglePin(clip)}
                  title={clip.isPinned ? 'ピン留め解除' : 'ピン留め'}
                  aria-label={clip.isPinned ? 'ピン留め解除' : 'ピン留め'}
                  className={`rounded-lg border p-1.5 transition ${
                    clip.isPinned
                      ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                      : 'border-slate-700/80 bg-slate-800/90 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Pin className="h-4 w-4" />
                </button>

                {/* ダウンロード */}
                <button
                  type="button"
                  onClick={handleDownload}
                  title="ダウンロード"
                  aria-label="ダウンロード"
                  className="rounded-lg border border-slate-700/80 bg-slate-800/90 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                >
                  <Download className="h-4 w-4" />
                </button>

                {/* 削除 */}
                <button
                  type="button"
                  onClick={async () => {
                    const nextClip =
                      hasNext
                        ? clips[currentIndex + 1]
                        : hasPrev
                        ? clips[currentIndex - 1]
                        : null;
                    await onDelete(clip.id);
                    if (nextClip) {
                      onSelectClip(nextClip);
                    } else {
                      onClose();
                    }
                  }}
                  title="この画像を削除"
                  aria-label="この画像を削除"
                  className="rounded-lg border border-slate-700/80 bg-slate-800/90 p-1.5 text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-950/60 hover:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                {/* 閉じるボタン */}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="プレビューを閉じる"
                  className="ml-1 rounded-lg border border-slate-700/80 bg-slate-800/90 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* メイン領域（画像ビューア / クイック編集キャンバス + OCRテキストサイドパネル） */}
          <div className="flex min-h-0 flex-1 flex-col overflow-clip lg:flex-row">
            {isEditing && fullImageUrl ? (
              <ImageEditorOverlay
                imageUrl={fullImageUrl}
                alt={clip.memo || '編集中の画像'}
                fallbackWidth={clip.width}
                fallbackHeight={clip.height}
                zoom={zoom}
                onWheelZoom={handleWheel}
                activeTool={activeTool}
                color={color}
                strokeWidth={strokeWidth}
                textFontSize={textFontSize}
                textBackgroundStyle={textBackgroundStyle}
                cancelTextSignal={cancelTextSignal}
                annotations={annotations}
                appliedCrop={appliedCrop}
                draftCrop={draftCrop}
                onDraftCropChange={setDraftCrop}
                onAddAnnotation={handleAddAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onEditingTextChange={handleEditingTextChange}
                onPendingTextChange={handlePendingTextChange}
                onImageLoaded={handleImageLoaded}
              />
            ) : (
              /* 通常画像ビューア領域 */
              <div
                onWheel={handleWheel}
                className="lightbox-stage-bg relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-4 select-none"
              >
                {hasPrev && (
                  <button
                    type="button"
                    onClick={() => onSelectClip(clips[currentIndex - 1])}
                    aria-label="前の画像"
                    className="absolute left-4 z-10 rounded-full border border-slate-700/80 bg-slate-900/90 p-2.5 text-slate-200 shadow-lg backdrop-blur-md transition hover:bg-slate-800 hover:text-white"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}

                {fullImageUrl ? (
                  <img
                    src={fullImageUrl}
                    alt={clip.memo || 'プレビュー画像'}
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'center center',
                    }}
                    className="block max-h-full max-w-full rounded-xs object-contain shadow-[0_12px_36px_rgba(0,0,0,0.65)] ring-1 ring-slate-400/30 transition-transform duration-100"
                  />
                ) : (
                  <div className="text-sm text-slate-500">読み込み中...</div>
                )}

                {hasNext && (
                  <button
                    type="button"
                    onClick={() => onSelectClip(clips[currentIndex + 1])}
                    aria-label="次の画像"
                    className="absolute right-4 z-10 rounded-full border border-slate-700/80 bg-slate-900/90 p-2.5 text-slate-200 shadow-lg backdrop-blur-md transition hover:bg-slate-800 hover:text-white"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}

            {/* OCR抽出テキスト閲覧・編集・コピーパネル（編集モード中は非表示） */}
            {!isEditing && isOcrPanelOpen && (
              <aside className="flex max-h-[40%] w-full shrink-0 flex-col border-t border-slate-700/80 bg-slate-900/95 lg:max-h-none lg:w-88 lg:border-t-0 lg:border-l">
                <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <ScanText className="h-4 w-4 text-indigo-400" />
                    <h3 className="text-xs font-semibold text-slate-200">
                      抽出テキスト (OCR)
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyOcrText}
                      disabled={!ocrDraft.trim()}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-40"
                    >
                      {justCopiedText ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span>コピー済</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>テキストをコピー</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onRunOcr(clip.id)}
                      disabled={isOcrRunning}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-600/90 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isOcrRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                      <span>{clip.ocrText?.trim() ? '再抽出' : '抽出'}</span>
                    </button>
                  </div>
                </div>

                {isOcrRunning && (
                  <div className="space-y-1.5 border-b border-slate-800 bg-indigo-950/30 px-3.5 py-2">
                    <div className="flex items-center justify-between text-[11px] text-indigo-200">
                      <span>{progressLabel}</span>
                      <span className="font-mono">{Math.round(progressValue * 100)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-clip rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-150"
                        style={{ width: `${Math.max(6, Math.round(progressValue * 100))}%` }}
                      />
                    </div>
                  </div>
                )}

                {clip.ocrStatus === 'error' && (
                  <div className="flex items-start gap-2 border-b border-rose-500/30 bg-rose-950/40 px-3.5 py-2 text-[11px] text-rose-200">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                    <div className="flex-1">
                      <p>文字抽出に失敗しました: {clip.ocrError ?? '不明なエラー'}</p>
                    </div>
                  </div>
                )}

                <div className="flex min-h-0 flex-1 flex-col p-3">
                  <textarea
                    value={ocrDraft}
                    onChange={(e) => setOcrDraft(e.target.value)}
                    onBlur={() => {
                      if (ocrDraft !== (clip.ocrText ?? '')) {
                        void onUpdateOcrText(clip.id, ocrDraft);
                      }
                    }}
                    placeholder="「抽出」ボタンを押すと画像内の文字やバーコード（JAN/EAN/Code128等）・QRコードをローカルで読み取ります。読み取ったテキストはそのまま編集・検索対象として保存されます。"
                    aria-label="抽出テキスト"
                    className="h-full min-h-[120px] w-full flex-1 resize-none rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs leading-relaxed text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    フォーカスを外すと編集内容が自動保存され、検索対象になります（{ocrDraft.length} 文字）
                  </p>
                </div>
              </aside>
            )}
          </div>

          {/* ボトムバー */}
          {isEditing ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/80 bg-slate-900/95 px-4 py-2 text-[11px] text-slate-400">
              <span>
                ドラッグで描画・クリックでテキスト配置 · Ctrl+Z / ⌘Z 元に戻す · Ctrl+C / ⌘C コピー · Enter 確定 · Esc キャンセル
              </span>
              <span className="font-mono text-slate-500">
                元画像: {clip.width} × {clip.height} px
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/80 bg-slate-900/95 px-4 py-2.5">
              <div className="flex flex-1 items-center gap-2">
                <label htmlFor="lightbox-memo" className="text-xs font-medium text-slate-400">
                  メモ:
                </label>
                <input
                  id="lightbox-memo"
                  type="text"
                  value={memoDraft}
                  onChange={(e) => setMemoDraft(e.target.value)}
                  onBlur={() => {
                    const trimmed = memoDraft.trim();
                    if (trimmed !== clip.memo) {
                      void onUpdateMemo(clip.id, trimmed);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="この画像のメモを入力（検索対象になります）..."
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {groups.length > 0 && (
                <div className="flex items-center gap-2">
                  <FolderInput className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs text-slate-400">グループ:</span>
                  <select
                    value={clip.groupId}
                    onChange={(e) => void onMoveGroup(clip.id, e.target.value)}
                    aria-label="グループ変更"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
