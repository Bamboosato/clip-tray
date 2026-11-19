import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Layers,
  Pencil,
  Pin,
  Trash2,
  X,
} from 'lucide-react';
import { DEFAULT_GROUP_COLORS } from '../db/database';
import type { FilterTab, Group } from '../types';

interface GroupTabsProps {
  groups: Group[];
  activeTab: FilterTab;
  onSelectTab: (tab: FilterTab) => void;
  totalCount: number;
  pinnedCount: number;
  countsByGroup: Record<string, number>;
  onCreateGroup: (name: string, color: string) => Promise<void>;
  onUpdateGroup: (id: string, updates: Partial<Pick<Group, 'name' | 'color'>>) => Promise<void>;
  onReorderGroups: (orderedIds: string[]) => Promise<void>;
  onRequestDeleteGroup: (group: Group) => void;
  onMoveClipToGroup?: (clipId: string, targetGroupId: string) => Promise<void>;
}

export function GroupTabs({
  groups,
  activeTab,
  onSelectTab,
  totalCount,
  pinnedCount,
  countsByGroup,
  onCreateGroup,
  onUpdateGroup,
  onReorderGroups,
  onRequestDeleteGroup,
  onMoveClipToGroup,
}: GroupTabsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_GROUP_COLORS[1]);

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');

  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  const newInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) {
      newInputRef.current?.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingGroupId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingGroupId]);

  const handleStartAdd = () => {
    const nextColor =
      DEFAULT_GROUP_COLORS[groups.length % DEFAULT_GROUP_COLORS.length] || DEFAULT_GROUP_COLORS[0];
    setNewColor(nextColor);
    setNewName('');
    setIsAdding(true);
  };

  const handleConfirmAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newName.trim()) {
      setIsAdding(false);
      return;
    }
    await onCreateGroup(newName.trim(), newColor);
    setNewName('');
    setIsAdding(false);
  };

  const handleStartEdit = (group: Group) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
    setEditingColor(group.color);
  };

  const handleConfirmEdit = async () => {
    if (!editingGroupId) return;
    const trimmed = editingName.trim();
    if (trimmed) {
      await onUpdateGroup(editingGroupId, {
        name: trimmed,
        color: editingColor,
      });
    }
    setEditingGroupId(null);
  };

  const handleMoveGroup = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= groups.length) return;
    const orderedIds = groups.map((g) => g.id);
    const [moved] = orderedIds.splice(index, 1);
    orderedIds.splice(targetIndex, 0, moved);
    await onReorderGroups(orderedIds);
  };

  const handleDragStartGroup = (e: React.DragEvent, groupId: string) => {
    setDraggedGroupId(groupId);
    e.dataTransfer.setData('application/x-cliptray-group', groupId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverTab = (e: React.DragEvent, targetGroupId: string) => {
    const types = Array.from(e.dataTransfer.types);
    if (
      types.includes('application/x-cliptray-group') ||
      types.includes('application/x-cliptray-clip')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverGroupId !== targetGroupId) {
        setDragOverGroupId(targetGroupId);
      }
    }
  };

  const handleDropOnTab = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    setDragOverGroupId(null);

    // 1. 画像カードのドロップによるグループ移動
    const clipId = e.dataTransfer.getData('application/x-cliptray-clip');
    if (clipId && onMoveClipToGroup) {
      await onMoveClipToGroup(clipId, targetGroupId);
      setDraggedGroupId(null);
      return;
    }

    // 2. グループタブ自体の並び替えドロップ
    const sourceGroupId =
      e.dataTransfer.getData('application/x-cliptray-group') || draggedGroupId;
    setDraggedGroupId(null);

    if (!sourceGroupId || sourceGroupId === targetGroupId) return;
    const orderedIds = groups.map((g) => g.id);
    const fromIndex = orderedIds.indexOf(sourceGroupId);
    const toIndex = orderedIds.indexOf(targetGroupId);
    if (fromIndex === -1 || toIndex === -1) return;

    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, sourceGroupId);
    await onReorderGroups(orderedIds);
  };

  return (
    <div className="border-b border-slate-800/80 bg-slate-900/40">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 overflow-x-auto px-4 py-2.5 sm:px-6">
        {/* すべて表示タブ */}
        <button
          type="button"
          onClick={() => onSelectTab('all')}
          className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            activeTab === 'all'
              ? 'bg-slate-800 text-white ring-1 ring-slate-700'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          <Layers className="h-3.5 w-3.5 text-indigo-400" />
          <span>すべて表示</span>
          <span className="rounded-full bg-slate-950/70 px-1.5 py-0.5 text-[11px] text-slate-300">
            {totalCount}
          </span>
        </button>

        {/* ピン留めのみタブ */}
        <button
          type="button"
          onClick={() => onSelectTab('pinned')}
          className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            activeTab === 'pinned'
              ? 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          <Pin className="h-3.5 w-3.5 text-amber-400" />
          <span>ピン留め</span>
          <span className="rounded-full bg-slate-950/70 px-1.5 py-0.5 text-[11px] text-amber-300">
            {pinnedCount}
          </span>
        </button>

        <div className="mx-1 h-5 w-px shrink-0 bg-slate-800" />

        {/* 各グループタブ */}
        {groups.map((group, idx) => {
          const isSelected = activeTab === group.id;
          const isEditing = editingGroupId === group.id;
          const count = countsByGroup[group.id] ?? 0;
          const isDragOver = dragOverGroupId === group.id;

          if (isEditing) {
            return (
              <div
                key={group.id}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/60 bg-slate-900 px-2 py-1"
              >
                {/* カラー選択ドット */}
                <div className="flex items-center gap-1">
                  {DEFAULT_GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditingColor(c)}
                      aria-label={`カラー ${c}`}
                      className={`h-3.5 w-3.5 rounded-full transition ${
                        editingColor === c ? 'scale-110 ring-2 ring-white' : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirmEdit();
                    if (e.key === 'Escape') setEditingGroupId(null);
                  }}
                  className="w-28 rounded bg-slate-950 px-2 py-0.5 text-xs text-slate-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleConfirmEdit()}
                  title="保存"
                  className="rounded p-1 text-emerald-400 hover:bg-slate-800"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingGroupId(null)}
                  title="キャンセル"
                  className="rounded p-1 text-slate-400 hover:bg-slate-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          return (
            <div
              key={group.id}
              draggable
              onDragStart={(e) => handleDragStartGroup(e, group.id)}
              onDragOver={(e) => handleDragOverTab(e, group.id)}
              onDragLeave={() => {
                if (dragOverGroupId === group.id) setDragOverGroupId(null);
              }}
              onDrop={(e) => void handleDropOnTab(e, group.id)}
              onDragEnd={() => {
                setDraggedGroupId(null);
                setDragOverGroupId(null);
              }}
              className={`group relative flex shrink-0 items-center rounded-lg text-xs font-medium transition ${
                isDragOver
                  ? 'ring-2 ring-indigo-400 bg-indigo-950/50'
                  : isSelected
                  ? 'bg-slate-800 text-white ring-1 ring-slate-700'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectTab(group.id)}
                onDoubleClick={() => handleStartEdit(group)}
                title="クリックで切替 / ダブルクリックで名前変更 / ドラッグで並び替え"
                className="inline-flex items-center gap-2 px-3 py-1.5"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <span className="max-w-[140px] truncate">{group.name}</span>
                <span className="rounded-full bg-slate-950/70 px-1.5 py-0.5 text-[11px] text-slate-300">
                  {count}
                </span>
              </button>

              {/* 選択中またはホバー時に表示されるグループ操作ボタン群 */}
              {isSelected && (
                <div className="flex items-center gap-0.5 pr-1.5">
                  {groups.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleMoveGroup(idx, -1)}
                        disabled={idx === 0}
                        title="左へ移動"
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100 disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveGroup(idx, 1)}
                        disabled={idx === groups.length - 1}
                        title="右へ移動"
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100 disabled:opacity-30"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleStartEdit(group)}
                    title="グループ名・色を編集"
                    className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestDeleteGroup(group)}
                    title="グループを削除"
                    className="rounded p-1 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* 新規グループ追加フォーム / ボタン */}
        {isAdding ? (
          <form
            onSubmit={(e) => void handleConfirmAdd(e)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/60 bg-slate-900 px-2 py-1"
          >
            <div className="flex items-center gap-1">
              {DEFAULT_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  aria-label={`カラー ${c}`}
                  className={`h-3.5 w-3.5 rounded-full transition ${
                    newColor === c ? 'scale-110 ring-2 ring-white' : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <input
              ref={newInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsAdding(false);
              }}
              placeholder="グループ名..."
              className="w-28 rounded bg-slate-950 px-2 py-0.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              title="作成"
              className="rounded p-1 text-emerald-400 hover:bg-slate-800"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              title="キャンセル"
              className="rounded p-1 text-slate-400 hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={handleStartAdd}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-slate-700/80 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:border-indigo-500/50 hover:bg-slate-900 hover:text-indigo-300"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>新規グループ</span>
          </button>
        )}
      </div>
    </div>
  );
}
