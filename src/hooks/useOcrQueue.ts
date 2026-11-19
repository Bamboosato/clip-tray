import { useCallback, useEffect, useRef, useState } from 'react';
import { db, resetStuckOcrStatuses, updateClipOcr } from '../db/database';
import { ocrEngine } from '../utils/ocrEngine';
import type { OcrLanguage } from '../types';

export interface ActiveOcrJob {
  clipId: string;
  progress: number;
  statusLabel: string;
}

interface QueuedOcrTask {
  clipId: string;
  silent: boolean;
}

interface UseOcrQueueOptions {
  language: OcrLanguage;
  onNotify: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export function useOcrQueue({ language, onNotify }: UseOcrQueueOptions) {
  const queueRef = useRef<QueuedOcrTask[]>([]);
  const isProcessingRef = useRef(false);
  const activeClipIdRef = useRef<string | null>(null);
  const languageRef = useRef(language);
  const onNotifyRef = useRef(onNotify);
  const isMountedRef = useRef(true);

  const [activeJob, setActiveJob] = useState<ActiveOcrJob | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    onNotifyRef.current = onNotify;
  }, [onNotify]);

  useEffect(() => {
    isMountedRef.current = true;
    void resetStuckOcrStatuses();

    return () => {
      isMountedRef.current = false;
      queueRef.current = [];
      void ocrEngine.dispose();
    };
  }, []);

  const syncCounts = useCallback(() => {
    if (!isMountedRef.current) return;
    setQueuedCount(queueRef.current.length);
  }, []);

  const processNext = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      while (isMountedRef.current && queueRef.current.length > 0) {
        const nextTask = queueRef.current.shift();
        syncCounts();
        if (!nextTask) continue;

        const { clipId, silent } = nextTask;
        const clip = await db.clips.get(clipId);
        if (!clip) {
          continue;
        }

        activeClipIdRef.current = clipId;
        if (isMountedRef.current) {
          setActiveJob({
            clipId,
            progress: 0,
            statusLabel: '文字抽出準備中',
          });
        }

        await updateClipOcr(clipId, {
          ocrStatus: 'processing',
          ocrError: undefined,
        });

        try {
          const result = await ocrEngine.recognize(
            clip.imageBlob,
            languageRef.current,
            (prog) => {
              if (!isMountedRef.current) return;
              setActiveJob({
                clipId,
                progress: prog.progress,
                statusLabel: prog.label,
              });
            }
          );

          // 処理完了時点で対象クリップがまだ削除されていないか確認
          const stillExists = await db.clips.get(clipId);
          if (stillExists) {
            await updateClipOcr(clipId, {
              ocrText: result.text,
              ocrStatus: 'done',
              ocrError: undefined,
            });
          }

          if (!silent && isMountedRef.current) {
            if (result.text) {
              onNotifyRef.current('画像から文字を抽出しました', 'success');
            } else {
              onNotifyRef.current('画像から文字は検出されませんでした', 'info');
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'OCR処理中にエラーが発生しました';
          const stillExists = await db.clips.get(clipId);
          if (stillExists) {
            await updateClipOcr(clipId, {
              ocrStatus: 'error',
              ocrError: message,
            });
          }
          if (!silent && isMountedRef.current) {
            onNotifyRef.current(`文字抽出に失敗しました: ${message}`, 'error');
          }
        } finally {
          activeClipIdRef.current = null;
          if (isMountedRef.current) {
            setActiveJob(null);
          }
        }
      }
    } finally {
      isProcessingRef.current = false;
      activeClipIdRef.current = null;
      if (isMountedRef.current) {
        setActiveJob(null);
        syncCounts();
      }
    }
  }, [syncCounts]);

  const enqueueClip = useCallback(
    (
      clipId: string,
      options: { priority?: 'high' | 'normal'; silent?: boolean } = {}
    ) => {
      const { priority = 'normal', silent = false } = options;

      if (activeClipIdRef.current === clipId) {
        return;
      }

      const existingIdx = queueRef.current.findIndex((t) => t.clipId === clipId);
      if (existingIdx !== -1) {
        if (priority === 'high' && existingIdx > 0) {
          const [task] = queueRef.current.splice(existingIdx, 1);
          task.silent = silent;
          queueRef.current.unshift(task);
        }
        return;
      }

      const task: QueuedOcrTask = { clipId, silent };
      if (priority === 'high') {
        queueRef.current.unshift(task);
      } else {
        queueRef.current.push(task);
      }
      syncCounts();

      void updateClipOcr(clipId, {
        ocrStatus: 'pending',
        ocrError: undefined,
      }).then(() => {
        void processNext();
      });
    },
    [processNext, syncCounts]
  );

  const cancelClips = useCallback(
    (clipIds: string[]) => {
      if (clipIds.length === 0) return;
      const targetSet = new Set(clipIds);
      queueRef.current = queueRef.current.filter((t) => !targetSet.has(t.clipId));
      syncCounts();
    },
    [syncCounts]
  );

  return {
    activeJob,
    pendingCount: queuedCount + (activeJob ? 1 : 0),
    enqueueClip,
    cancelClips,
  };
}
