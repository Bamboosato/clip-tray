/**
 * 相対時間（「たった今」「5分前」「2時間前」「3日前」）をフォーマットする
 */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));

  if (diffSec < 60) {
    return 'たった今';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}分前`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}時間前`;
  }
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) {
    return `${diffDay}日前`;
  }
  const date = new Date(timestampMs);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/**
 * 削除予定日時までの残り時間をフォーマットする（「あと5日」「あと3時間」「まもなく削除」）
 */
export function formatRemainingTime(
  expiresAt: number | null,
  isPinned: boolean,
  nowMs: number = Date.now()
): { label: string; isUrgent: boolean } | null {
  if (isPinned || expiresAt === null) {
    return null;
  }

  const remainingMs = expiresAt - nowMs;
  if (remainingMs <= 0) {
    return { label: '期限切れ', isUrgent: true };
  }

  const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
  if (remainingMinutes < 60) {
    return { label: `あと${remainingMinutes}分`, isUrgent: true };
  }

  const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
  if (remainingHours < 24) {
    return { label: `あと${remainingHours}時間`, isUrgent: remainingHours <= 6 };
  }

  const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
  return { label: `あと${remainingDays}日`, isUrgent: remainingDays <= 1 };
}

/**
 * バイト数を読みやすい単位（KB / MB / GB）に変換する
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
