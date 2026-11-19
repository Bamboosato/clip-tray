import Dexie, { type Table } from 'dexie';
import type { ClipItem, Group } from '../types';

export const DEFAULT_GROUP_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#f43f5e', // Rose
  '#3b82f6', // Blue
];

export class ClipTrayDB extends Dexie {
  groups!: Table<Group, string>;
  clips!: Table<ClipItem, string>;

  constructor() {
    super('ClipTrayDatabase');
    this.version(1).stores({
      groups: 'id, name, order, createdAt',
      clips: 'id, groupId, isPinned, createdAt, expiresAt',
    });
    this.version(2).stores({
      groups: 'id, name, order, createdAt',
      clips: 'id, groupId, isPinned, createdAt, expiresAt, ocrStatus',
    });
  }
}

export const db = new ClipTrayDB();

let initPromise: Promise<Group> | null = null;

/**
 * 初回起動時にデフォルトグループ「Inbox」を1つ自動作成する。
 * React StrictMode の二重実行でも重複作成されないよう、
 * モジュールスコープの Promise ロック + Dexie トランザクション内で存在チェックを行う。
 */
export function ensureDefaultGroup(): Promise<Group> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = db
    .transaction('rw', db.groups, async () => {
      const existingGroups = await db.groups.orderBy('order').toArray();
      if (existingGroups.length > 0) {
        return existingGroups[0];
      }

      const inboxGroup: Group = {
        id: 'default-inbox',
        name: 'Inbox',
        color: DEFAULT_GROUP_COLORS[0],
        order: 0,
        createdAt: Date.now(),
      };

      await db.groups.put(inboxGroup);
      return inboxGroup;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

/**
 * 期限切れ（isPinned === false かつ expiresAt !== null && expiresAt <= now）のアイテムを自動削除する。
 */
export async function cleanupExpiredClips(now: number = Date.now()): Promise<number> {
  return db.transaction('rw', db.clips, async () => {
    const expiredIds: string[] = [];
    await db.clips
      .where('expiresAt')
      .belowOrEqual(now)
      .each((clip) => {
        if (!clip.isPinned && clip.expiresAt !== null && clip.expiresAt <= now) {
          expiredIds.push(clip.id);
        }
      });

    if (expiredIds.length > 0) {
      await db.clips.bulkDelete(expiredIds);
    }
    return expiredIds.length;
  });
}

/**
 * 既存の未ピン留めアイテムの有効期限を設定変更に合わせて一括更新する
 */
export async function updateAllClipExpirations(retentionDays: number | null): Promise<void> {
  const durationMs = retentionDays !== null ? retentionDays * 24 * 60 * 60 * 1000 : null;
  await db.transaction('rw', db.clips, async () => {
    await db.clips.toCollection().modify((clip) => {
      if (clip.isPinned) {
        clip.expiresAt = null;
      } else {
        clip.expiresAt = durationMs !== null ? clip.createdAt + durationMs : null;
      }
    });
  });
}

/**
 * 新規グループを作成する
 */
export async function createGroup(name: string, color: string): Promise<Group> {
  return db.transaction('rw', db.groups, async () => {
    const all = await db.groups.orderBy('order').toArray();
    const maxOrder = all.length > 0 ? Math.max(...all.map((g) => g.order)) : -1;
    const newGroup: Group = {
      id: crypto.randomUUID(),
      name: name.trim() || '無題のグループ',
      color,
      order: maxOrder + 1,
      createdAt: Date.now(),
    };
    await db.groups.add(newGroup);
    return newGroup;
  });
}

/**
 * グループ名またはカラーを更新する
 */
export async function updateGroup(
  id: string,
  updates: Partial<Pick<Group, 'name' | 'color' | 'order'>>
): Promise<void> {
  await db.groups.update(id, updates);
}

/**
 * グループの並び順を入れ替える
 */
export async function reorderGroups(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.groups, async () => {
    await Promise.all(
      orderedIds.map((id, index) => db.groups.update(id, { order: index }))
    );
  });
}

/**
 * グループと配下の画像をすべて削除する（最後の1グループ削除時はInboxを再作成）
 */
export async function deleteGroupAndClips(groupId: string): Promise<string> {
  return db.transaction('rw', db.groups, db.clips, async () => {
    await db.clips.where('groupId').equals(groupId).delete();
    await db.groups.delete(groupId);

    const remaining = await db.groups.orderBy('order').toArray();
    if (remaining.length === 0) {
      const inbox: Group = {
        id: 'default-inbox',
        name: 'Inbox',
        color: DEFAULT_GROUP_COLORS[0],
        order: 0,
        createdAt: Date.now(),
      };
      await db.groups.put(inbox);
      return inbox.id;
    }
    return remaining[0].id;
  });
}

/**
 * 指定範囲（または特定グループ）のピン留め以外の画像をすべて削除する
 */
export async function clearUnpinnedClips(targetGroupId?: string): Promise<number> {
  return db.transaction('rw', db.clips, async () => {
    const idsToDelete: string[] = [];
    if (targetGroupId && targetGroupId !== 'all' && targetGroupId !== 'pinned') {
      await db.clips
        .where('groupId')
        .equals(targetGroupId)
        .each((clip) => {
          if (!clip.isPinned) {
            idsToDelete.push(clip.id);
          }
        });
    } else {
      await db.clips.toCollection().each((clip) => {
        if (!clip.isPinned) {
          idsToDelete.push(clip.id);
        }
      });
    }

    if (idsToDelete.length > 0) {
      await db.clips.bulkDelete(idsToDelete);
    }
    return idsToDelete.length;
  });
}

/**
 * ページ再読み込み等により途中のまま残った OCR ステータスを 'idle' に戻す
 */
export async function resetStuckOcrStatuses(): Promise<void> {
  await db.clips
    .where('ocrStatus')
    .anyOf(['pending', 'processing'])
    .modify({ ocrStatus: 'idle' });
}

/**
 * 既存のクリップの OCR 結果・ステータスのみを安全に更新する（削除済み復活を防ぐため update を使用）
 */
export async function updateClipOcr(
  clipId: string,
  updates: Partial<Pick<ClipItem, 'ocrText' | 'ocrStatus' | 'ocrError'>>
): Promise<void> {
  await db.clips.update(clipId, updates);
}
