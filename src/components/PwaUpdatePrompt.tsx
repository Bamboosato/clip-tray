import { useEffect, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface PwaUpdatePromptProps {
  onOfflineReady?: () => void;
}

const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function PwaUpdatePrompt({ onOfflineReady }: PwaUpdatePromptProps) {
  const intervalRef = useRef<number | null>(null);
  const onOfflineReadyRef = useRef(onOfflineReady);

  useEffect(() => {
    onOfflineReadyRef.current = onOfflineReady;
  }, [onOfflineReady]);

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current);
        }
        intervalRef.current = window.setInterval(() => {
          void registration.update();
        }, SW_UPDATE_CHECK_INTERVAL_MS);
      }
    },
    onRegisterError(error) {
      console.warn('Service Worker の登録に失敗しました:', error);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      onOfflineReadyRef.current?.();
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-indigo-500/40 bg-slate-900/95 px-4 py-3 text-xs text-slate-100 shadow-2xl backdrop-blur-md"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
        <RefreshCw className="h-4 w-4" />
      </div>
      <div className="flex-1 space-y-1.5">
        <p className="font-semibold text-slate-100">新しいバージョンが利用可能です</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500"
          >
            今すぐ更新
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            あとで
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label="更新通知を閉じる"
        className="self-start rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
