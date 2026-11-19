import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { HardDrive, Loader2, ShieldCheck } from 'lucide-react';
import {
  cleanupExpiredClips,
  clearUnpinnedClips,
  createGroup,
  db,
  deleteGroupAndClips,
  ensureDefaultGroup,
  reorderGroups,
  updateAllClipExpirations,
  updateClipOcr,
  updateGroup,
} from './db/database';
import { useClipboardPaste } from './hooks/useClipboardPaste';
import { useOcrQueue } from './hooks/useOcrQueue';
import { usePwaInstall } from './hooks/usePwaInstall';
import { useSettings } from './hooks/useSettings';
import { formatBytes } from './utils/dateUtils';
import { processIncomingImage } from './utils/imageProcessor';
import { Header } from './components/Header';
import { GroupTabs } from './components/GroupTabs';
import { ImageGrid } from './components/ImageGrid';
import { LightboxModal } from './components/LightboxModal';
import { SettingsModal } from './components/SettingsModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastContainer } from './components/Toast';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import type { AppSettings, ClipItem, FilterTab, Group, ToastMessage } from './types';

export default function App() {
  const { settings, updateSettings } = useSettings();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [isClearUnpinnedConfirmOpen, setIsClearUnpinnedConfirmOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storageUsage, setStorageUsage] = useState<number | null>(null);

  // DBリアクティブ購読
  const groups = useLiveQuery(() => db.groups.orderBy('order').toArray(), [], [] as Group[]);
  const allClips = useLiveQuery(
    () => db.clips.orderBy('createdAt').reverse().toArray(),
    [],
    [] as ClipItem[]
  );

  const notify = useCallback(
    (message: string, type: 'success' | 'info' | 'error' = 'info') => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const { activeJob, pendingCount, enqueueClip, cancelClips } = useOcrQueue({
    language: settings.ocrLanguage,
    onNotify: notify,
  });

  const {
    canInstall: canInstallPwa,
    isInstalled: isPwaInstalled,
    promptInstall,
  } = usePwaInstall();

  const handleInstallPwa = useCallback(() => {
    void promptInstall().then((outcome) => {
      if (outcome === 'accepted') {
        notify('ClipTray をアプリとしてインストールしました', 'success');
      }
    });
  }, [notify, promptInstall]);

  const handleOfflineReady = useCallback(() => {
    notify('オフライン利用の準備が完了しました', 'info');
  }, [notify]);

  // ストレージ使用量の定期見積もり更新
  useEffect(() => {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      void navigator.storage.estimate().then((est) => {
        setStorageUsage(est.usage ?? null);
      });
    }
  }, [allClips.length]);

  // 初回起動時にデフォルトグループを作成し、期限切れアイテムをクリーンアップ
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const defaultGroup = await ensureDefaultGroup();
      const expiredCount = await cleanupExpiredClips();
      if (mounted) {
        setActiveTab((prev) => (prev === 'all' ? defaultGroup.id : prev));
        if (expiredCount > 0) {
          notify(`期限切れの画像を ${expiredCount} 件自動削除しました`, 'info');
        }
      }
    })();

    const interval = window.setInterval(() => {
      void cleanupExpiredClips().then((expiredCount) => {
        if (expiredCount > 0) {
          notify(`期限切れの画像を ${expiredCount} 件自動削除しました`, 'info');
        }
      });
    }, 60_000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [notify]);

  // 画像取り込み処理（ペースト / D&D / ファイル選択共通）
  const handleAddFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      let targetGroupId = activeTab;
      if (targetGroupId === 'all' || targetGroupId === 'pinned') {
        const defaultGroup = groups[0] ?? (await ensureDefaultGroup());
        targetGroupId = defaultGroup.id;
      }

      const targetGroupName =
        groups.find((g) => g.id === targetGroupId)?.name ?? 'Inbox';

      const now = Date.now();
      const expiresAt =
        settings.retentionDays !== null
          ? now + settings.retentionDays * 24 * 60 * 60 * 1000
          : null;

      let addedCount = 0;
      for (const file of files) {
        try {
          const processed = await processIncomingImage(file, settings.maxImageDimension);
          const item: ClipItem = {
            id: crypto.randomUUID(),
            groupId: targetGroupId,
            imageBlob: processed.imageBlob,
            thumbnailBlob: processed.thumbnailBlob,
            mimeType: processed.mimeType,
            width: processed.width,
            height: processed.height,
            memo: '',
            ocrText: '',
            ocrStatus: settings.autoOcr ? 'pending' : 'idle',
            isPinned: false,
            createdAt: Date.now(),
            expiresAt,
          };
          await db.clips.add(item);
          addedCount += 1;

          if (settings.autoOcr) {
            enqueueClip(item.id, { priority: 'normal', silent: true });
          }
        } catch (err) {
          console.error(err);
          notify('画像の読み込みまたは最適化に失敗しました', 'error');
        }
      }

      if (addedCount > 0) {
        notify(
          `「${targetGroupName}」に ${addedCount} 件の画像を保存しました`,
          'success'
        );
      }
    },
    [
      activeTab,
      enqueueClip,
      groups,
      notify,
      settings.autoOcr,
      settings.maxImageDimension,
      settings.retentionDays,
    ]
  );

  // Ctrl+V / Cmd+V ペースト監視（モーダルが開いていない時または常に有効、入力要素は自動除外）
  useClipboardPaste(handleAddFiles, true);

  // タブごとの件数集計
  const { countsByGroup, pinnedCount } = useMemo(() => {
    const map: Record<string, number> = {};
    let pinned = 0;
    for (const c of allClips) {
      map[c.groupId] = (map[c.groupId] ?? 0) + 1;
      if (c.isPinned) pinned += 1;
    }
    return { countsByGroup: map, pinnedCount: pinned };
  }, [allClips]);

  // フィルタリング＆ピン留め上部固定ソート（メモ + OCR抽出テキストを横断検索）
  const filteredClips = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allClips
      .filter((clip) => {
        if (activeTab === 'pinned' && !clip.isPinned) return false;
        if (activeTab !== 'all' && activeTab !== 'pinned' && clip.groupId !== activeTab) {
          return false;
        }
        if (query) {
          const memoMatch = clip.memo.toLowerCase().includes(query);
          const ocrMatch = (clip.ocrText ?? '').toLowerCase().includes(query);
          if (!memoMatch && !ocrMatch) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) {
          return a.isPinned ? -1 : 1;
        }
        return b.createdAt - a.createdAt;
      });
  }, [allClips, activeTab, searchQuery]);

  const previewClip = useMemo(
    () => (previewClipId ? allClips.find((c) => c.id === previewClipId) ?? null : null),
    [allClips, previewClipId]
  );

  const unpinnedCountInView = useMemo(
    () =>
      allClips.filter((c) => {
        if (c.isPinned) return false;
        if (activeTab === 'all' || activeTab === 'pinned') return true;
        return c.groupId === activeTab;
      }).length,
    [allClips, activeTab]
  );

  const activeGroupName = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'pinned') return '全グループ';
    return groups.find((g) => g.id === activeTab)?.name ?? '現在のグループ';
  }, [activeTab, groups]);

  const handleTogglePin = useCallback(
    async (clip: ClipItem) => {
      const nextPinned = !clip.isPinned;
      const expiresAt = nextPinned
        ? null
        : settings.retentionDays !== null
        ? clip.createdAt + settings.retentionDays * 24 * 60 * 60 * 1000
        : null;
      await db.clips.update(clip.id, { isPinned: nextPinned, expiresAt });
      notify(
        nextPinned
          ? 'ピン留めしました（自動削除の対象外になります）'
          : 'ピン留めを解除しました',
        'info'
      );
    },
    [notify, settings.retentionDays]
  );

  const handleUpdateMemo = useCallback(
    async (clipId: string, memo: string) => {
      await db.clips.update(clipId, { memo });
      notify('メモを更新しました', 'info');
    },
    [notify]
  );

  const handleRunOcr = useCallback(
    (clipId: string) => {
      enqueueClip(clipId, { priority: 'high', silent: false });
    },
    [enqueueClip]
  );

  const handleUpdateOcrText = useCallback(
    async (clipId: string, ocrText: string) => {
      await updateClipOcr(clipId, { ocrText, ocrStatus: 'done', ocrError: undefined });
      notify('抽出テキストを保存しました', 'info');
    },
    [notify]
  );

  const handleMoveGroup = useCallback(
    async (clipId: string, targetGroupId: string) => {
      await db.clips.update(clipId, { groupId: targetGroupId });
      const targetName = groups.find((g) => g.id === targetGroupId)?.name ?? '別グループ';
      notify(`「${targetName}」へ移動しました`, 'info');
    },
    [groups, notify]
  );

  const handleDeleteClip = useCallback(
    async (clipId: string) => {
      cancelClips([clipId]);
      await db.clips.delete(clipId);
      notify('画像を削除しました', 'info');
    },
    [cancelClips, notify]
  );

  const handleChangeRetentionDays = useCallback(
    async (retentionDays: AppSettings['retentionDays']) => {
      updateSettings({ retentionDays });
      await updateAllClipExpirations(retentionDays);
      const expired = await cleanupExpiredClips();
      if (expired > 0) {
        notify(`設定変更に伴い期限切れの画像 ${expired} 件を削除しました`, 'info');
      } else {
        notify('自動削除期間を更新しました', 'success');
      }
    },
    [notify, updateSettings]
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        gridSize={settings.gridSize}
        onGridSizeChange={(gridSize) => updateSettings({ gridSize })}
        onFilesSelected={(files) => void handleAddFiles(files)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onClearUnpinned={() => setIsClearUnpinnedConfirmOpen(true)}
        unpinnedCountInView={unpinnedCountInView}
        activeGroupName={activeGroupName}
        canInstallPwa={canInstallPwa}
        onInstallPwa={handleInstallPwa}
      />

      <GroupTabs
        groups={groups}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        totalCount={allClips.length}
        pinnedCount={pinnedCount}
        countsByGroup={countsByGroup}
        onCreateGroup={async (name, color) => {
          const created = await createGroup(name, color);
          setActiveTab(created.id);
          notify(`グループ「${created.name}」を作成しました`, 'success');
        }}
        onUpdateGroup={async (id, updates) => {
          await updateGroup(id, updates);
          notify('グループを更新しました', 'info');
        }}
        onReorderGroups={reorderGroups}
        onRequestDeleteGroup={(group) => setGroupToDelete(group)}
        onMoveClipToGroup={handleMoveGroup}
      />

      <ImageGrid
        clips={filteredClips}
        groups={groups}
        gridSize={settings.gridSize}
        showGroupBadge={activeTab === 'all' || activeTab === 'pinned'}
        searchQuery={searchQuery}
        activeOcrJob={activeJob}
        onFilesDropped={(files) => void handleAddFiles(files)}
        onOpenPreview={(clip) => setPreviewClipId(clip.id)}
        onTogglePin={handleTogglePin}
        onUpdateMemo={handleUpdateMemo}
        onMoveGroup={handleMoveGroup}
        onDelete={handleDeleteClip}
        onRunOcr={handleRunOcr}
        onNotify={notify}
      />

      {/* フッター: ストレージ使用量・自動削除設定・OCRキュー状態の目安表示 */}
      <footer className="border-t border-slate-900 bg-slate-950/90 px-4 py-3 text-xs text-slate-500 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              IndexedDB ローカル保存
            </span>
            <span>·</span>
            <span>
              自動削除:{' '}
              <strong className="font-medium text-slate-300">
                {settings.retentionDays === null
                  ? 'オフ（無期限）'
                  : settings.retentionDays === 1
                  ? '24時間'
                  : `${settings.retentionDays}日`}
              </strong>
            </span>
            <span>·</span>
            <span>
              自動OCR:{' '}
              <strong className="font-medium text-slate-300">
                {settings.autoOcr
                  ? `ON (${settings.ocrLanguage === 'jpn+eng' ? '日+英' : '英'})`
                  : 'OFF'}
              </strong>
            </span>

            {pendingCount > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-950/70 px-2.5 py-0.5 text-[11px] font-medium text-indigo-200 ring-1 ring-indigo-500/30">
                  <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
                  <span>
                    {activeJob
                      ? `${activeJob.statusLabel} ${Math.round(activeJob.progress * 100)}%`
                      : '文字抽出準備中'}
                    {pendingCount > 1 ? ` (残り ${pendingCount} 件)` : ''}
                  </span>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {storageUsage !== null && (
              <span className="inline-flex items-center gap-1.5 text-slate-400">
                <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
                使用容量目安: <strong className="text-slate-300">{formatBytes(storageUsage)}</strong>
              </span>
            )}
          </div>
        </div>
      </footer>

      {/* 原寸プレビュー（ライトボックス）モーダル */}
      <LightboxModal
        clip={previewClip}
        clips={filteredClips}
        groups={groups}
        activeOcrJob={activeJob}
        onClose={() => setPreviewClipId(null)}
        onSelectClip={(c) => setPreviewClipId(c.id)}
        onTogglePin={handleTogglePin}
        onUpdateMemo={handleUpdateMemo}
        onMoveGroup={handleMoveGroup}
        onDelete={handleDeleteClip}
        onRunOcr={handleRunOcr}
        onUpdateOcrText={handleUpdateOcrText}
        onNotify={notify}
      />

      {/* 設定モーダル */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onChangeRetentionDays={handleChangeRetentionDays}
        onChangeMaxDimension={(maxImageDimension) => {
          updateSettings({ maxImageDimension });
          notify(`最大画像サイズを ${maxImageDimension}px に設定しました`, 'info');
        }}
        onChangeAutoOcr={(autoOcr) => {
          updateSettings({ autoOcr });
          notify(`貼り付け時の自動OCRを ${autoOcr ? 'ON' : 'OFF'} にしました`, 'info');
        }}
        onChangeOcrLanguage={(ocrLanguage) => {
          updateSettings({ ocrLanguage });
          notify(
            `OCR言語を「${ocrLanguage === 'jpn+eng' ? '日本語 + 英語' : '英語のみ'}」に設定しました`,
            'info'
          );
        }}
        totalClipsCount={allClips.length}
        pinnedClipsCount={pinnedCount}
        canInstallPwa={canInstallPwa}
        isPwaInstalled={isPwaInstalled}
        onInstallPwa={handleInstallPwa}
      />

      {/* グループ削除の確認ダイアログ */}
      <ConfirmDialog
        isOpen={groupToDelete !== null}
        title={`グループ「${groupToDelete?.name ?? ''}」を削除しますか？`}
        description={`このグループに含まれる画像（${
          groupToDelete ? countsByGroup[groupToDelete.id] ?? 0 : 0
        }件、ピン留め含む）もすべて完全に削除されます。この操作は取り消せません。`}
        confirmLabel="グループと画像を削除"
        onCancel={() => setGroupToDelete(null)}
        onConfirm={() => {
          if (!groupToDelete) return;
          const target = groupToDelete;
          setGroupToDelete(null);
          const groupClipIds = allClips
            .filter((c) => c.groupId === target.id)
            .map((c) => c.id);
          cancelClips(groupClipIds);
          void deleteGroupAndClips(target.id).then((fallbackId) => {
            if (activeTab === target.id) {
              setActiveTab(fallbackId);
            }
            notify(`グループ「${target.name}」を削除しました`, 'info');
          });
        }}
      />

      {/* ピン留め以外一括クリアの確認ダイアログ */}
      <ConfirmDialog
        isOpen={isClearUnpinnedConfirmOpen}
        title={`「${activeGroupName}」のピン留め以外の画像を削除しますか？`}
        description={`対象となる ${unpinnedCountInView} 件の未ピン留め画像がすべて削除されます。ピン留めされた画像は保持されます。`}
        confirmLabel={`${unpinnedCountInView}件を削除`}
        onCancel={() => setIsClearUnpinnedConfirmOpen(false)}
        onConfirm={() => {
          setIsClearUnpinnedConfirmOpen(false);
          const targetIds = allClips
            .filter((c) => {
              if (c.isPinned) return false;
              if (activeTab === 'all' || activeTab === 'pinned') return true;
              return c.groupId === activeTab;
            })
            .map((c) => c.id);
          cancelClips(targetIds);
          void clearUnpinnedClips(activeTab).then((deletedCount) => {
            notify(`ピン留め以外の画像を ${deletedCount} 件削除しました`, 'info');
          });
        }}
      />

      {/* PWA更新通知プロンプト */}
      <PwaUpdatePrompt onOfflineReady={handleOfflineReady} />

      {/* トースト通知 */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
