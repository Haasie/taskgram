import { useEffect, useRef, type ReactNode } from 'react';

type Props = { open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean };

/** Bottom sheet op mobiel, gecentreerde dialoog op desktop. */
export function Modal({ open, onClose, children, label, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:pt-[12vh]" role="dialog" aria-modal aria-label={label}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <div
        ref={ref}
        className={`relative w-full ${wide ? 'sm:max-w-xl' : 'sm:max-w-sm'} max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-white dark:bg-zinc-900 shadow-2xl pb-[env(safe-area-inset-bottom)] animate-sheet`}
      >
        {children}
      </div>
    </div>
  );
}
