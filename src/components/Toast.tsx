import { useEffect, useRef } from 'react';
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const supportsPopover =
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supportsPopover) return;
    const el = containerRef.current as
      | (HTMLDivElement & { showPopover: () => void; hidePopover: () => void })
      | null;
    if (!el) return;

    try {
      if (toasts.length > 0) {
        // showModal() で開かれた <dialog> よりも Top Layer の最前面へ表示させる
        if (el.matches(':popover-open')) {
          el.hidePopover();
        }
        el.showPopover();
      } else if (el.matches(':popover-open')) {
        el.hidePopover();
      }
    } catch {
      // Popover API の状態遷移が競合した場合は通常固定配置にフォールバック
    }
  }, [toasts]);

  return (
    <div
      ref={containerRef}
      {...(supportsPopover ? ({ popover: 'manual' } as Record<string, string>) : {})}
      aria-live="polite"
      className="pointer-events-none fixed inset-auto right-4 bottom-4 z-50 m-0 flex flex-col gap-2 overflow-visible border-0 bg-transparent p-0 text-inherit"
    >
      {toasts.map((toast) => {
        const Icon =
          toast.type === 'success'
            ? CheckCircle2
            : toast.type === 'error'
            ? AlertCircle
            : Info;

        const styleClass =
          toast.type === 'success'
            ? 'border-emerald-500/40 bg-slate-900/95 text-emerald-200'
            : toast.type === 'error'
            ? 'border-rose-500/40 bg-slate-900/95 text-rose-200'
            : 'border-indigo-500/40 bg-slate-900/95 text-indigo-200';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-xl backdrop-blur-md transition ${styleClass}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="通知を閉じる"
              className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
