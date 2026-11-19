import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
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
