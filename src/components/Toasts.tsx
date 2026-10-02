import { dismissToast, useToasts } from '../lib/toast';

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 md:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-4 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-white shadow-lg animate-sheet">
          {t.message}
          {t.action && (
            <button type="button" className="font-semibold text-sky-300" onClick={() => (t.action!.run(), dismissToast(t.id))}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
